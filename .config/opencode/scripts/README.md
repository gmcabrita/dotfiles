# Ralph User Guide

Ralph is an autonomous PRD execution agent. It takes a structured requirements document and implements tasks one at a time, committing after each completed task.

## Quick Start

```bash
# 1. Create a PRD (in opencode)
> Load the prd skill and create a PRD for user authentication

# 2. Convert to Ralph format (in opencode)
> Load the ralph skill and convert tasks/prd-user-auth.md to prd.json

# 3. Run Ralph
./scripts/ralph.sh
```

## Workflow

### Step 1: Create PRD

Load the `prd` skill in opencode and describe your feature:

```
> Load the prd skill and create a PRD for [your feature]
```

The skill will:

- Ask clarifying questions about problem, scope, users, dependencies
- Explore your codebase to understand patterns
- Generate a markdown PRD at `tasks/prd-<feature-name>.md`

### Step 2: Review PRD

Review the generated PRD before proceeding:

- **Problem Statement**: Does it capture the real pain points?
- **Goals**: Are P0/P1/P2 priorities correct?
- **Non-Goals**: Anything missing that should be excluded?
- **User Stories**: Do they cover all requirements?
- **Acceptance Criteria**: Are they testable?
- **Implementation Phases**: Is the ordering logical?
- **Key Decisions**: Do you agree with the rationale?

### Step 3: Convert to JSON

Load the `ralph` skill to convert the markdown PRD:

```
> Load the ralph skill and convert tasks/prd-<name>.md to prd.json
```

This creates `prd.json` in your project root with tasks structured for autonomous execution.

### Step 4: Run Ralph

```bash
./scripts/ralph.sh              # Default: 25 iterations
./scripts/ralph.sh 50           # Custom max iterations
./scripts/ralph.sh path.json    # Specific PRD file
```

Ralph will:

- Create/switch to the feature branch
- Pick the highest priority `todo` task
- Implement following the exact steps
- Verify against acceptance criteria
- Commit changes
- Update progress file
- Repeat until all tasks complete or max iterations reached

### Step 5: Monitor Progress

```bash
ralph -l                  # List all active PRDs
ralph -s                  # Status of all PRDs
ralph -s <prd-id>         # Detailed status of specific PRD
```

Check `.ralph/<prd-id>/progress.txt` for detailed logs.

### Step 6: Handle Blocked Tasks

If Ralph marks a task as `blocked`:

1. Check `blockedReason` in the PRD
2. Provide clarification or fix the blocker
3. Reset status to `todo`
4. Resume Ralph

### Step 7: Archive

When complete:

```bash
ralph -a <prd-id>
```

Archives to `.ralph/archive/<date>-<prd-id>/`

## CLI Reference

```
Usage: ralph [OPTIONS] [max-iterations]
       ralph [OPTIONS] <prd-file> [max-iterations]

Arguments:
  prd-file         Path to prd.json (default: ./prd.json)
  max-iterations   Maximum iterations (default: 25)

Options:
  -l, --list       List all active PRDs
  -s, --status     Show status of all or specific PRD
  -a, --archive    Archive a completed PRD
  -h, --help       Show this help
```

## File Structure

```
your-project/
├── prd.json                    # Current PRD being executed
├── tasks/
│   └── prd-<feature>.md        # Source PRD markdown
└── .ralph/
    ├── <prd-id>/
    │   ├── prd.json            # Copy of PRD (updated by Ralph)
    │   ├── progress.txt        # Execution log
    │   └── state.json          # Iteration state
    └── archive/
        └── <date>-<prd-id>/    # Archived PRDs
```

## PRD Markdown Structure

The `/prd` skill generates markdown with this structure:

```markdown
# PRD: <Feature Name>

**Status:** Draft
**Date:** YYYY-MM-DD
**Scope:** Brief description

## Problem Statement

- Current Behavior
- Pain Points (table)
- Why This Solution?

## Goals

| Priority | Goal |
| P0 | Must-have |
| P1 | Should-have |
| P2 | Nice-to-have |

### Non-Goals (v1)

- Explicitly out of scope

## Design

- Overview
- Data Model
- Key Decisions (table with rationale)

## Interface Specifications (if applicable)

- CLI: usage, args, options, behavior, example output
- API: endpoints, request/response schemas, errors
- UI: props, states, behavior

## User Stories

### US-001: Title [category]

- As a / I want / So that
- Acceptance Criteria
- Technical Notes

## Implementation Phases

### Phase 1: Name

- [ ] Tasks

## Testing Strategy

## Open Questions
```

## PRD JSON Schema

```json
{
  "branchName": "<feature-name>",
  "tasks": [
    {
      "id": "T-001",
      "priority": 1,
      "category": "<flexible>",
      "description": "What to implement",
      "references": ["src/path/to/file.ts"],
      "steps": ["Step 1", "Step 2"],
      "acceptanceCriteria": ["Criterion 1"],
      "status": "todo",
      "blockedReason": null
    }
  ]
}
```

### Field Rules

| Field                | Mutability | Description                          |
| -------------------- | ---------- | ------------------------------------ |
| `id`                 | READ-ONLY  | Unique task ID (T-001, T-002...)     |
| `priority`           | READ-ONLY  | Execution order (1 = first)          |
| `category`           | READ-ONLY  | Task category (flexible per project) |
| `description`        | READ-ONLY  | One-line summary                     |
| `references`         | READ-ONLY  | Relevant file paths                  |
| `steps`              | READ-ONLY  | Implementation steps                 |
| `acceptanceCriteria` | READ-ONLY  | Verification criteria                |
| `status`             | MUTABLE    | `todo` → `completed` \| `blocked`    |
| `blockedReason`      | MUTABLE    | Why task is blocked (if applicable)  |

## Categories

Categories are flexible. Use what fits your codebase:

- **Common**: `db`, `api`, `ui`, `test`, `docs`, `config`
- **Domain**: `auth`, `payments`, `search`, `notifications`
- **Package**: `cli`, `sdk`, `plugin`, `core`
- **Ops**: `infra`, `ci`, `deploy`, `monitoring`
- **Quality**: `perf`, `security`, `a11y`, `refactor`

## Default Acceptance Criteria

Ralph always verifies these (in addition to task-specific criteria):

- Code compiles without type errors
- Linting passes
- Formatting passes
- Related tests pass

## Tips

### Writing Good Steps

- One action per step
- Be specific: "Add email field to User type" not "Update types"
- Include file paths
- Order by dependency

### Writing Good Acceptance Criteria

- Make them testable
- Include edge cases
- Be specific about expected behavior

### Handling Large Features

- Break into multiple PRDs if > 10 tasks
- Create dependencies between PRDs
- Run sequentially

### Resuming After Interruption

Ralph preserves state on Ctrl+C. Just run again:

```bash
./scripts/ralph.sh
```

### VCS Support

Ralph auto-detects and supports:

**jj (stacked bookmarks):**

```
main
└── feature/t-001  ← bookmark per task
    └── feature/t-002
        └── feature/t-003
```

Each task gets its own bookmark, enabling stacked PRs.

**git (single branch):**

```
feature-name
├── T-001 commit
├── T-002 commit
└── T-003 commit
```

All tasks commit to one branch.

## Troubleshooting

### "No branchName in PRD file"

Your `prd.json` is missing the `branchName` field.

### "Not in a git or jj repository"

Run Ralph from within a version-controlled project.

### Task stuck in loop

Check if acceptance criteria are too strict or ambiguous. Mark as blocked if needed.

### Max iterations reached

Increase limit or check for blocked tasks:

```bash
./scripts/ralph.sh 100
```
