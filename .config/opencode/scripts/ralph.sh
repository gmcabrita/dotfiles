#!/usr/bin/env bash
set -euo pipefail

# Ralph: Autonomous PRD execution agent
# Spawns fresh opencode sessions to implement tasks from a PRD

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_TEMPLATE="$SCRIPT_DIR/prompt.md"
DEFAULT_MAX_ITERATIONS=25
SLEEP_BETWEEN_ITERATIONS=2

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
Usage: ralph [OPTIONS] [max-iterations]
       ralph [OPTIONS] <prd-file> [max-iterations]

Start or resume PRD execution with autonomous agent.

Arguments:
  prd-file         Path to prd.json (default: ./prd.json)
  max-iterations   Maximum iterations (default: $DEFAULT_MAX_ITERATIONS)

Options:
  -l, --list       List all active PRDs
  -s, --status     Show status of all or specific PRD
  -a, --archive    Archive a completed PRD
  -h, --help       Show this help

Examples:
  ralph                               Start with ./prd.json
  ralph 50                            Start with 50 max iterations
  ralph tasks/auth.prd.json           Start with specific PRD
  ralph tasks/auth.prd.json 50        Specific PRD + max iterations
  ralph -l                            List active PRDs
  ralph -s auth-system                Status of specific PRD
  ralph -a auth-system                Archive auth-system PRD

Workflow:
  1. opencode> Load the prd skill and create a PRD for [feature]
  2. opencode> Load the ralph skill and convert tasks/prd-[name].md to prd.json
  3. ./scripts/ralph.sh [max_iterations]
EOF
}

log() { echo -e "${CYAN}[ralph]${NC} $*"; }
log_success() { echo -e "${CYAN}[ralph]${NC} ${GREEN}$*${NC}"; }
log_warn() { echo -e "${CYAN}[ralph]${NC} ${YELLOW}$*${NC}"; }
log_error() { echo -e "${CYAN}[ralph]${NC} ${RED}$*${NC}" >&2; }

# Detect VCS type
detect_vcs() {
    if [[ -d ".jj" ]]; then
        echo "jj"
    elif [[ -d ".git" ]]; then
        echo "git"
    else
        echo "none"
    fi
}

# Extract prd-id from branchName (strip ralph/ prefix)
get_prd_id() {
    local prd_file="$1"
    local branch_name
    branch_name=$(jq -r '.branchName // empty' "$prd_file")
    if [[ -z "$branch_name" ]]; then
        log_error "No branchName in PRD file"
        exit 1
    fi
    echo "${branch_name#ralph/}"
}

# Get task counts from PRD
get_task_counts() {
    local prd_file="$1"
    local todo completed blocked
    todo=$(jq '[.tasks[] | select(.status == "todo")] | length' "$prd_file")
    completed=$(jq '[.tasks[] | select(.status == "completed")] | length' "$prd_file")
    blocked=$(jq '[.tasks[] | select(.status == "blocked")] | length' "$prd_file")
    echo "$todo $completed $blocked"
}

# Initialize .ralph/<prd-id>/ structure
init_ralph_dir() {
    local prd_id="$1"
    local prd_file="$2"
    local max_iterations="$3"
    local vcs_type="$4"
    local ralph_dir=".ralph/$prd_id"

    mkdir -p "$ralph_dir"

    # Copy PRD file
    cp "$prd_file" "$ralph_dir/prd.json"

    # Initialize progress.txt
    cat > "$ralph_dir/progress.txt" <<EOF
# Progress: $prd_id

## Codebase Patterns
<!-- Add discovered patterns here -->

---

EOF

    # Initialize state.json
    local session_id
    session_id=$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -d'-' -f1)
    cat > "$ralph_dir/state.json" <<EOF
{
  "prdId": "$prd_id",
  "sessionID": "$session_id",
  "iteration": 0,
  "maxIterations": $max_iterations,
  "errorCount": 0,
  "startedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "lastRunAt": null,
  "vcsType": "$vcs_type"
}
EOF

    log "Initialized $ralph_dir"
}

# Update state.json
update_state() {
    local ralph_dir="$1"
    local iteration="$2"
    local state_file="$ralph_dir/state.json"
    local tmp_file
    tmp_file=$(mktemp)

    jq --arg iter "$iteration" --arg now "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        '.iteration = ($iter | tonumber) | .lastRunAt = $now' \
        "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
}

# Build prompt with injected paths
build_prompt() {
    local prd_id="$1"
    local iteration="$2"
    local max_iterations="$3"
    local vcs_type="$4"
    local ralph_dir=".ralph/$prd_id"

    # Read template and prepend config header
    cat <<EOF
[RALPH CONFIG]
PRD: $ralph_dir/prd.json
Progress: $ralph_dir/progress.txt
Iteration: $iteration/$max_iterations
VCS: $vcs_type

$(cat "$PROMPT_TEMPLATE")
EOF
}

# List all active PRDs
cmd_list() {
    if [[ ! -d ".ralph" ]]; then
        log "No active PRDs"
        return 0
    fi

    local found=false
    for dir in .ralph/*/; do
        [[ -d "$dir" ]] || continue
        [[ "$(basename "$dir")" == "archive" ]] && continue

        local prd_id
        prd_id=$(basename "$dir")
        local state_file="$dir/state.json"
        local prd_file="$dir/prd.json"

        if [[ -f "$state_file" && -f "$prd_file" ]]; then
            found=true
            local iteration max_iterations last_run
            iteration=$(jq -r '.iteration' "$state_file")
            max_iterations=$(jq -r '.maxIterations' "$state_file")
            last_run=$(jq -r '.lastRunAt // "never"' "$state_file")

            read -r todo completed blocked <<< "$(get_task_counts "$prd_file")"
            local total=$((todo + completed + blocked))

            printf "${BLUE}%-20s${NC}  %2d/%-3d  ${GREEN}%d${NC}/${YELLOW}%d${NC}/${RED}%d${NC} tasks  last: %s\n" \
                "$prd_id" "$iteration" "$max_iterations" "$completed" "$todo" "$blocked" "$last_run"
        fi
    done

    if [[ "$found" == "false" ]]; then
        log "No active PRDs"
    fi
}

# Show status of specific or all PRDs
cmd_status() {
    local target_prd="${1:-}"

    if [[ -n "$target_prd" ]]; then
        local ralph_dir=".ralph/$target_prd"
        if [[ ! -d "$ralph_dir" ]]; then
            log_error "PRD '$target_prd' not found"
            exit 1
        fi

        local state_file="$ralph_dir/state.json"
        local prd_file="$ralph_dir/prd.json"

        echo -e "\n${BLUE}=== $target_prd ===${NC}\n"

        if [[ -f "$state_file" ]]; then
            jq '.' "$state_file"
        fi

        echo ""
        if [[ -f "$prd_file" ]]; then
            jq '.tasks[] | {id, status, description}' "$prd_file"
        fi
    else
        cmd_list
    fi
}

# Archive a PRD
cmd_archive() {
    local prd_id="$1"
    local ralph_dir=".ralph/$prd_id"

    if [[ ! -d "$ralph_dir" ]]; then
        log_error "PRD '$prd_id' not found"
        exit 1
    fi

    local archive_name
    archive_name="$(date +%Y-%m-%d)-$prd_id"
    local archive_dir=".ralph/archive/$archive_name"

    mkdir -p ".ralph/archive"
    mv "$ralph_dir" "$archive_dir"

    log_success "Archived to $archive_dir"
}

# Main execution loop
run_ralph() {
    local prd_file="$1"
    local max_iterations="${2:-$DEFAULT_MAX_ITERATIONS}"

    # Validate PRD file
    if [[ ! -f "$prd_file" ]]; then
        log_error "PRD file not found: $prd_file"
        exit 1
    fi

    # Validate prompt template
    if [[ ! -f "$PROMPT_TEMPLATE" ]]; then
        log_error "Prompt template not found: $PROMPT_TEMPLATE"
        exit 1
    fi

    # Get prd-id and detect VCS
    local prd_id vcs_type
    prd_id=$(get_prd_id "$prd_file")
    vcs_type=$(detect_vcs)

    if [[ "$vcs_type" == "none" ]]; then
        log_error "Not in a git or jj repository"
        exit 1
    fi

    local ralph_dir=".ralph/$prd_id"
    local state_file="$ralph_dir/state.json"
    local iteration session_id

    # Initialize or resume
    if [[ -d "$ralph_dir" && -f "$state_file" ]]; then
        log "Resuming $prd_id"
        iteration=$(jq -r '.iteration' "$state_file")
        max_iterations=$(jq -r '.maxIterations' "$state_file")
        session_id=$(jq -r '.sessionID' "$state_file")
        log "From iteration $iteration/$max_iterations"
    else
        log "Starting $prd_id (new)"
        init_ralph_dir "$prd_id" "$prd_file" "$max_iterations" "$vcs_type"
        iteration=0
        session_id=$(jq -r '.sessionID' "$state_file")
    fi

    log "VCS: $vcs_type"
    read -r todo completed blocked <<< "$(get_task_counts "$ralph_dir/prd.json")"
    log "Tasks: ${GREEN}$completed completed${NC}, ${YELLOW}$todo todo${NC}, ${RED}$blocked blocked${NC}"

    # Trap Ctrl+C
    trap 'log_warn "Paused at iteration $iteration. Resume with: ralph $prd_file"; exit 130' INT

    # Main loop
    while [[ $iteration -lt $max_iterations ]]; do
        ((iteration++))
        update_state "$ralph_dir" "$iteration"

        log "Iteration $iteration/$max_iterations..."

        # Build prompt
        local prompt
        prompt=$(build_prompt "$prd_id" "$iteration" "$max_iterations" "$vcs_type")

        # Run opencode
        local output
        if ! output=$(opencode run --session "$session_id" "$prompt" 2>&1); then
            log_error "opencode failed: $output"
            # Increment error count
            local tmp_file
            tmp_file=$(mktemp)
            jq '.errorCount += 1' "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
        fi

        # Check for completion
        if echo "$output" | grep -q '<promise>COMPLETE</promise>'; then
            log_success "All tasks complete!"

            read -r todo completed blocked <<< "$(get_task_counts "$ralph_dir/prd.json")"
            log "Final: ${GREEN}$completed completed${NC}, ${YELLOW}$todo todo${NC}, ${RED}$blocked blocked${NC}"

            echo -n "Archive? [y/N] "
            read -r answer
            if [[ "$answer" =~ ^[Yy]$ ]]; then
                cmd_archive "$prd_id"
            fi
            exit 0
        fi

        sleep "$SLEEP_BETWEEN_ITERATIONS"
    done

    log_warn "Max iterations ($max_iterations) reached"
    read -r todo completed blocked <<< "$(get_task_counts "$ralph_dir/prd.json")"
    log "Status: ${GREEN}$completed completed${NC}, ${YELLOW}$todo todo${NC}, ${RED}$blocked blocked${NC}"
    exit 1
}

# Check if argument is a number
is_number() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

# Parse arguments
main() {
    case "${1:-}" in
        -h|--help)
            usage
            exit 0
            ;;
        -l|--list)
            cmd_list
            exit 0
            ;;
        -s|--status)
            cmd_status "${2:-}"
            exit 0
            ;;
        -a|--archive)
            if [[ -z "${2:-}" ]]; then
                log_error "--archive requires a prd-id"
                exit 1
            fi
            cmd_archive "$2"
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
        "")
            # No args: use prd.json with default iterations
            run_ralph "prd.json" "$DEFAULT_MAX_ITERATIONS"
            ;;
        *)
            if is_number "$1"; then
                # First arg is number: use prd.json with that max
                run_ralph "prd.json" "$1"
            else
                # First arg is file path
                run_ralph "$1" "${2:-$DEFAULT_MAX_ITERATIONS}"
            fi
            ;;
    esac
}

main "$@"
