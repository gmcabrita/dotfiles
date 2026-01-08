# Ralph Skill

Convert markdown PRDs to Ralph-executable JSON format.

## Workflow

1. User requests: "Load the ralph skill and convert tasks/prd-<name>.md to prd.json"
2. Read the markdown PRD
3. Extract user stories from all phases
4. Convert to tasks ordered by phase then priority
5. Output `prd.json` in project root

## Input Format

Expects markdown PRD from `/prd` skill with structure:

```markdown
# PRD: <Feature Name>

**Status:** Draft
**Date:** YYYY-MM-DD
**Scope:** ...

## Problem Statement

...

## Goals

| Priority | Goal |
...

## User Stories

### US-001: <Title> [category]

**As a** ...
**I want** ...
**So that** ...

#### Acceptance Criteria

- [ ] Criterion 1

#### Technical Notes

- File references

## Implementation Phases

### Phase 1: <Name>

- [ ] Task related to US-001
- [ ] Task related to US-002

### Phase 2: <Name>

...
```

## Output Format

Generate `prd.json`:

```json
{
  "branchName": "<feature-name>",
  "tasks": [
    {
      "id": "T-001",
      "priority": 1,
      "category": "api",
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

## Conversion Rules

### Priority Assignment

1. **Phase ordering**: Phase 1 tasks before Phase 2, etc.
2. **Within phase**: Follow story order (US-001 before US-002)
3. **Dependencies**: Tasks that others depend on come first

### Story → Task Mapping

| PRD Field                  | JSON Field           |
| -------------------------- | -------------------- |
| US-XXX                     | id: "T-XXX"          |
| Derived from phase + order | priority: 1, 2, 3... |
| [category] tag             | category             |
| Story title                | description          |
| Technical Notes files      | references           |
| Technical Notes + criteria | steps (derived)      |
| Acceptance Criteria        | acceptanceCriteria   |

### Using Implementation Phases

If PRD has `## Implementation Phases`:

- Map phase tasks to user stories
- Order tasks by phase first, then story order within phase
- Phase boundaries inform priority grouping

If PRD has no phases:

- Order by story number (US-001, US-002...)

### Deriving Steps

Convert acceptance criteria and technical notes into imperative steps:

**From PRD:**

```markdown
#### Acceptance Criteria

- [ ] Upload accepts jpg, png, webp (max 5MB)
- [ ] Image resized to 256x256

#### Technical Notes

- Use S3 client in `src/lib/aws.ts`
- Store URL in `users.avatarUrl`
```

**To JSON:**

```json
"steps": [
  "Create upload endpoint accepting multipart/form-data",
  "Validate file type (jpg, png, webp) and size (max 5MB)",
  "Resize image to 256x256 using sharp",
  "Upload to S3 using client from src/lib/aws.ts",
  "Store URL in users.avatarUrl column"
],
"acceptanceCriteria": [
  "Upload accepts jpg, png, webp (max 5MB)",
  "Image resized to 256x256"
]
```

### Categories

Categories are **flexible** - preserve whatever tag is used in the PRD:

- `[db]` → `"db"`
- `[auth]` → `"auth"`
- `[payments]` → `"payments"`
- etc.

If no tag, infer an appropriate category from content and codebase structure.

### Using Key Decisions

Reference the `## Key Decisions` table when deriving steps. The rationale helps inform implementation approach.

### Using Interface Specifications

If the PRD has `## Interface Specifications`:

- **CLI**: Use USAGE syntax, args, options, and example output to derive exact implementation
- **API**: Use request/response schemas and error codes as acceptance criteria
- **UI**: Use props, states, and behavior as implementation steps

Interface specs are highly prescriptive - follow them exactly.

### Using Non-Goals

Respect `## Non-Goals` - if a task seems to touch a non-goal area, note it in the task description or mark for human review.

## Field Rules

All fields in output are **READ-ONLY** for Ralph except:

- `status`: starts as `"todo"`, Ralph sets to `"completed"` or `"blocked"`
- `blockedReason`: starts as `null`, Ralph sets if blocked

## Branch Name

Derive from PRD title or filename:

- `# PRD: User Authentication` → `"branchName": "user-authentication"`
- `tasks/prd-user-auth.md` → `"branchName": "user-auth"`

## After Conversion

Tell the user:

```
Converted to prd.json

Branch: <feature-name>
Tasks: X total across Y phases
  Phase 1: N tasks
  Phase 2: N tasks

Categories: api (3), db (2), ui (1)

To run Ralph:
  ./scripts/ralph.sh [max_iterations]

Default: 25 iterations. Ctrl+C to pause (state preserved).
```

## Example Full Conversion

### Input: tasks/prd-favorites.md

```markdown
# PRD: User Favorites

**Status:** Draft
**Date:** 2026-01-08
**Scope:** Add ability for users to favorite items

---

## Problem Statement

### Current Behavior

Users have no way to save items for later.

### Pain Points

| Problem        | Impact                                |
| -------------- | ------------------------------------- |
| No favorites   | Users lose track of interesting items |
| No persistence | Must re-find items each session       |

---

## Goals

| Priority | Goal                                |
| -------- | ----------------------------------- |
| P0       | Users can favorite/unfavorite items |
| P0       | Favorites persist across sessions   |
| P1       | View all favorites in one place     |

### Non-Goals (v1)

- Favorite folders/organization
- Sharing favorites with others

---

## User Stories

### US-001: Create favorites table [db]

**As a** developer
**I want** a favorites table
**So that** user favorites can be stored

#### Acceptance Criteria

- [ ] Table has userId, itemId, createdAt
- [ ] Unique constraint on (userId, itemId)

#### Technical Notes

- Add to `src/db/schema.ts`
- Generate migration with drizzle-kit

### US-002: Add favorite endpoint [api]

**As a** user
**I want** to favorite an item
**So that** I can find it later

#### Acceptance Criteria

- [ ] POST /api/favorites returns 201
- [ ] Duplicate returns 409

#### Technical Notes

- Create `src/routes/favorites.ts`
- Use auth middleware

---

## Implementation Phases

### Phase 1: Backend

- [ ] US-001: Create database table
- [ ] US-002: Implement API endpoint

### Phase 2: Frontend

- [ ] Add favorite button to item cards
- [ ] Create favorites page
```

### Output: prd.json

```json
{
  "branchName": "user-favorites",
  "tasks": [
    {
      "id": "T-001",
      "priority": 1,
      "category": "db",
      "description": "Create favorites table",
      "references": ["src/db/schema.ts"],
      "steps": [
        "Add favorites table to src/db/schema.ts",
        "Include userId, itemId, createdAt columns",
        "Add unique constraint on (userId, itemId)",
        "Generate migration with drizzle-kit",
        "Run migration"
      ],
      "acceptanceCriteria": [
        "Table has userId, itemId, createdAt",
        "Unique constraint on (userId, itemId)"
      ],
      "status": "todo",
      "blockedReason": null
    },
    {
      "id": "T-002",
      "priority": 2,
      "category": "api",
      "description": "Add favorite endpoint",
      "references": ["src/routes/favorites.ts"],
      "steps": [
        "Create src/routes/favorites.ts",
        "Implement POST /api/favorites endpoint",
        "Add auth middleware",
        "Return 201 on success",
        "Return 409 if already favorited"
      ],
      "acceptanceCriteria": ["POST /api/favorites returns 201", "Duplicate returns 409"],
      "status": "todo",
      "blockedReason": null
    }
  ]
}
```
