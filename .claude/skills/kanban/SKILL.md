---
name: kanban
description: "Taskboard management skill. Use this to view, create, update, and manage tickets on the project taskboard. Enforces standard ticket format with user stories and acceptance criteria. Invoked automatically by hooks or manually via /kanban."
---

# Taskboard Management Protocol

You manage project work via the **taskboard MCP server** (22 tools). The taskboard is the single source of truth for all project work.

**Web UI:** http://localhost:3010
**Project:** Project Forge (prefix: PF, ID: `01KJEE8R1XXFF0CZT1WCSTGRDP`)

## MCP Tools Available

Use these MCP tools (provided by the `taskboard` MCP server) for all operations:

| Tool | Purpose |
|------|---------|
| `get_board` | View full Kanban board (todo/in_progress/done columns) |
| `list_tickets` | List tickets with filters (status, project) |
| `get_ticket` | Get full ticket details including subtasks |
| `create_ticket` | Create a new ticket (MUST follow template below) |
| `update_ticket` | Update title, description, priority, labels, due date |
| `move_ticket` | Transition status: `todo` → `in_progress` → `done` |
| `delete_ticket` | Remove a ticket |
| `create_subtask` | Add an implementation step to a ticket |
| `batch_create_subtasks` | Add multiple subtasks at once |
| `toggle_subtask` | Mark a subtask complete/incomplete |
| `create_project` | Create a new project (for epics/initiatives) |
| `list_projects` | List all projects |

## Mandatory Ticket Template

Every ticket MUST have ALL of these sections in its description field:

```
**User Story:**
As a [persona], I want [specific goal] so that [measurable benefit].

**Description:**
[Technical context — affected files, root cause, spec reference, scope boundaries]

**Acceptance Criteria:**
- Given [precondition], When [action], Then [expected result]
- Given [precondition], When [action], Then [expected result]
- ...
```

### Validation Rules

1. **User Story** — MUST match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive). Exact format enforced by hooks
2. **Description** — MUST include technical context (at least 20 chars beyond user story + AC sections)
3. **Acceptance Criteria** — MUST use Given/When/Then format, **minimum 3 complete scenarios**: happy path, edge case, negative/error case
4. **Priority** — MUST be set: `urgent`, `high`, `medium`, or `low`
5. **Team** — MUST be assigned: `SpawnForge PM`, `SpawnForge Engineering`, or `SpawnForge Leadership`
6. **Subtasks** — MUST have at least 3 implementation steps before work begins
7. **Labels** — SHOULD be set: `bug`, `feature`, `refactor`, `test`, `docs`, `chore`

### Team Assignment Guide

| Team | ID | Assign When |
|------|----|-------------|
| SpawnForge PM | `01KJFNJC02QK6F5NSDND7NH5MS` | Spec writing, planning, audits, documentation |
| SpawnForge Engineering | `01KJFNHZC49XG9KXRYTMYEEDTS` | Implementation, bug fixes, tests, code changes |
| SpawnForge Leadership | `01KJFNK35JVPQJESS3RZM0F5HP` | Manual tasks requiring user action (approvals, external work) |

## Workflow Protocol

### Before Starting Any Work

1. Run `get_board` to see current state
2. Check for stale in-progress tickets (update or complete them first)
3. Either pick an existing `todo` ticket OR create a new one
4. **Validate the ticket has ALL required fields:**
   - User story + acceptance criteria (content)
   - Priority set (metadata)
   - Team assigned (metadata)
   - Subtasks defined (at least 3 implementation steps)
5. Fix any validation gaps BEFORE moving to `in_progress`
6. Move the ticket to `in_progress` using `move_ticket`

### During Work

1. Toggle subtasks complete as you finish them (`toggle_subtask`)
2. Add new subtasks if you discover additional implementation steps
3. If you discover a new bug or task, create a separate ticket for it
4. If blocked, update the ticket description with the blocker
5. New tickets MUST have team, priority, and subtasks set at creation time

### After Completing Work

1. Verify ALL acceptance criteria are met
2. Toggle ALL subtasks complete
3. Move the ticket to `done` using `move_ticket`
4. Check if completing this ticket unblocks other tickets

## Staleness Rules

- A ticket in `in_progress` for >4 hours without updates is **stale**
- Before starting new work, address stale tickets first (complete or update)
- Never have more than 2 tickets in `in_progress` simultaneously

## Dependency Tracking

When creating tickets that depend on other work:
1. Note dependencies in the ticket description: "Blocked by: PF-XX"
2. Use the `blocked_by` field if the MCP tool supports it
3. When completing a ticket, check if it unblocks downstream tickets

## Common Operations

### View the board
```
Use MCP tool: get_board
```

### Create a well-formed ticket
```
Use MCP tool: create_ticket
  project: "01KJEE8R1XXFF0CZT1WCSTGRDP"
  title: "Fix X in Y"
  priority: "high"
  description: <full template with user story + description + acceptance criteria>
```

### Start working on a ticket
```
Use MCP tool: move_ticket
  id: "<ticket_id>"
  status: "in_progress"
```

### Complete a ticket
```
Use MCP tool: move_ticket
  id: "<ticket_id>"
  status: "done"
```

### Break down complex work
```
Use MCP tool: batch_create_subtasks
  ticket_id: "<ticket_id>"
  subtasks: ["Step 1: ...", "Step 2: ...", "Step 3: ..."]
```

## Priority Definitions

| Priority | Meaning | SLA |
|----------|---------|-----|
| `urgent` | Blocks all other work, production issue | Address immediately |
| `high` | Important, affects key functionality | Address this session |
| `medium` | Normal priority, planned work | Address within 2 sessions |
| `low` | Nice to have, cleanup, minor improvements | When convenient |
