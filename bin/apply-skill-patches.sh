#!/usr/bin/env bash
# Reapplies local changes to third-party skills after `skills update` replaces
# them with upstream copies. Each patch in patches/skills/ uses paths relative
# to the repository root (for example a/.agents/skills/<skill>/...).
#
# Each patch file is named <skill>.patch and starts with an "Intent:" header
# that git apply ignores. The header tells a reader (or an agent) what the
# change must achieve, so it can be redone when upstream code moves.
#
# A patch that is already applied is skipped. A patch that no longer applies
# (upstream changed the patched lines) fails the run and prints a one-line
# pi command that asks an agent to refresh the patch.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PATCH_DIR="$REPO_ROOT/patches/skills"

cd "$REPO_ROOT"

# Prints a pi command that refreshes one failed patch. The prompt must stay
# free of single quotes because it is wrapped in single quotes.
print_fix_command() {
  local name="$1" skill="$2"
  local source skill_path
  source=$(jq -r --arg s "$skill" '.skills[$s].source // "unknown"' skills-lock.json)
  skill_path=$(jq -r --arg s "$skill" '.skills[$s].skillPath // "unknown"' skills-lock.json)
  echo "Fix with:" >&2
  echo "pi 'The patch $name no longer applies to .agents/skills/$skill after skills update. Read the Intent header in the patch. Redo that change in the current .agents/skills/$skill files. Then regenerate the patch: clone the upstream GitHub repo $source, find the pristine skill next to $skill_path, and write a unified diff from pristine to local with repo-root paths (a/.agents/skills/$skill/... and b/.agents/skills/$skill/...). Keep the Intent header at the top. Run ./bin/apply-skill-patches.sh and confirm it prints Already applied for this patch.'" >&2
}

status=0
for patch in "$PATCH_DIR"/*.patch; do
  [[ -e "$patch" ]] || continue
  name="${patch#"$REPO_ROOT"/}"

  if git apply --reverse --check "$patch" 2>/dev/null; then
    echo "Already applied: $name"
  elif git apply --check "$patch" 2>/dev/null; then
    git apply "$patch"
    echo "Applied: $name"
  else
    echo "Patch does not apply, refresh it against upstream: $name" >&2
    print_fix_command "$name" "$(basename "$patch" .patch)"
    status=1
  fi
done
exit "$status"
