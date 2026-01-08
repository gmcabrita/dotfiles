# PRD Creation Skill

Create detailed Product Requirements Documents through interactive clarification.

## Workflow

1. User requests: "Load the prd skill and create a PRD for [feature]"
2. **Ask clarifying questions** to understand scope
3. **Explore codebase** to understand patterns
4. Generate markdown PRD to `tasks/prd-<feature-name>.md`

## Clarifying Questions

Before creating the PRD, ask about:

- **Problem**: What pain point does this solve?
- **Scope**: What's in/out of scope?
- **Users**: Who uses this feature?
- **Dependencies**: External services, APIs, packages needed?
- **Existing code**: Build on existing patterns or greenfield?
- **Priority**: MVP vs full implementation?
- **Testing**: Unit, integration, e2e requirements?

Keep questions concise. 3-5 max per round.

## Output Format

Save to `tasks/prd-<feature-name>.md`:

```markdown
# PRD: <Feature Name>

**Status:** Draft
**Date:** <YYYY-MM-DD>
**Scope:** <Brief scope description>

---

## Problem Statement

### Current Behavior

Describe how things work today (or don't).

### Pain Points

| Problem | Impact                    |
| ------- | ------------------------- |
| Issue 1 | How it affects users/devs |
| Issue 2 | How it affects users/devs |

### Why This Solution?

Brief justification for the chosen approach.

---

## Goals

| Priority | Goal                                     |
| -------- | ---------------------------------------- |
| P0       | Must-have for initial release            |
| P0       | Another critical requirement             |
| P1       | Important but can follow initial release |
| P2       | Nice to have                             |

### Non-Goals (v1)

- What this PRD explicitly does NOT cover
- Deferred features
- Out of scope items

---

## Design

### Overview

High-level approach and architecture.

### Data Model
```

Schemas, structures, file formats if applicable.

```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Question 1 | What we chose | Why |
| Question 2 | What we chose | Why |

---

## Interface Specifications

<!-- Include sections relevant to your feature -->

### CLI Interface (if applicable)

#### `command-name [args...]`

Brief description.

```

USAGE:
command-name [OPTIONS] [ARGS]

ARGS:
<arg> Description

OPTIONS:
-f, --flag Description
-o, --option Description
-h, --help Print help

```

**Behavior:**
- No args → Default behavior
- With args → Specific behavior
- `--flag` → Flag behavior

**Output:**
```

$ command-name arg1
Success message or output format

````

### API Endpoints (if applicable)

#### `POST /api/resource`

Brief description.

**Request:**
```json
{
  "field": "value"
}
````

**Response (201):**

```json
{
  "id": "123",
  "field": "value"
}
```

**Errors:**
| Status | Condition |
|--------|-----------|
| 400 | Invalid input |
| 401 | Not authenticated |
| 409 | Resource exists |

### UI Components (if applicable)

#### ComponentName

Brief description and purpose.

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary'` | `'primary'` | Visual style |
| `onClick` | `() => void` | - | Click handler |

**States:**

- Default
- Hover
- Loading
- Disabled
- Error

**Behavior:**

- Click → What happens
- Keyboard → Accessibility behavior

---

## User Stories

### US-001: <Story Title> [category]

**As a** <user type>
**I want** <action>
**So that** <benefit>

#### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

#### Technical Notes

- Implementation hints
- File references: `src/path/to/file.ts`

### US-002: <Story Title> [category]

...

---

## Implementation Phases

### Phase 1: <Name>

- [ ] Task 1
- [ ] Task 2

### Phase 2: <Name>

- [ ] Task 3
- [ ] Task 4

---

## Testing Strategy

### Unit Tests

- What to unit test

### Integration Tests

- What to integration test

### E2E Tests (if applicable)

- End-to-end scenarios

---

## Open Questions

- Unresolved decisions needing input
- Areas requiring clarification

````

## Section Guidelines

### Problem Statement
- Explain the "why" before the "what"
- Use tables for pain points (scannable)
- Include current behavior so readers understand the gap

### Goals with Priority
- **P0**: Blocking - must ship with feature
- **P1**: Important - should ship soon after
- **P2**: Nice to have - future consideration

### Non-Goals
Explicitly state what's out of scope to prevent scope creep.

### Key Decisions
Capture important architectural choices and WHY. Future readers (including Ralph) benefit from understanding rationale.

### Implementation Phases
Group related work into logical phases. Each phase should be independently deployable if possible.

### Interface Specifications
Document user-facing interfaces in detail. Ralph uses these as implementation specs.

**CLI interfaces** should include:
- Usage syntax with args and options
- Behavior for each flag/arg combination
- Example output (success and error cases)
- Interactive prompts if any

**API endpoints** should include:
- HTTP method and path
- Request body schema
- Response schemas (success + error codes)
- Authentication requirements

**UI components** should include:
- Props with types and defaults
- Visual states (hover, loading, disabled, error)
- Behavior on interaction
- Accessibility considerations

## Categories

Tag stories with a category for Ralph conversion. Categories are **flexible** - choose what fits the codebase.

**Common categories:**
- `[db]`, `[api]`, `[ui]`, `[test]`, `[docs]`, `[config]`

**Project-specific examples:**
- `[auth]`, `[payments]`, `[search]` - domain modules
- `[cli]`, `[sdk]`, `[plugin]` - package types
- `[infra]`, `[ci]`, `[deploy]` - ops concerns
- `[perf]`, `[security]`, `[a11y]` - cross-cutting

Explore the codebase to discover natural groupings (folder structure, module names, existing conventions).

## Writing Good User Stories

### Atomic
One story = one deployable unit of value.

### Ordered by Phase
Group into implementation phases. Within phases, order by dependency.

### Testable
Every acceptance criterion must be verifiable.

### Example

```markdown
### US-001: User can upload profile picture [api]
**As a** registered user
**I want** to upload a profile picture
**So that** other users can identify me

#### Acceptance Criteria
- [ ] Upload accepts jpg, png, webp (max 5MB)
- [ ] Image resized to 256x256
- [ ] Old picture deleted on replacement
- [ ] Fallback to initials if no picture

#### Technical Notes
- Use existing S3 client in `src/lib/aws.ts`
- Store URL in `users.avatarUrl` column
- Reference: `src/components/Avatar.tsx` for display
````

## After PRD Creation

Tell the user:

```
PRD saved to tasks/prd-<name>.md

Next steps:
1. Review and refine the PRD
2. Load the ralph skill to convert to prd.json
3. Run: ./scripts/ralph.sh [max_iterations]
```
