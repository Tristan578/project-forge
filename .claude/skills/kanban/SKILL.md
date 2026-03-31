---
name: kanban
description: "Manage SpawnForge taskboard tickets — create, view, move, and sync to GitHub. Use when creating tickets, checking board state, syncing to GitHub before PRs, or managing the project backlog."
---

# Taskboard Management Protocol

You manage project work via the **taskboard MCP server** (22 tools). The taskboard is the single source of truth for all project work.

## Taskboard Ownership Model

**Only the orchestrator (main Claude session) manages ticket lifecycle.**

| Actor | Can Create | Can Add Subtasks | Can Update Description | Can Move Status | Can Edit Metadata |
|-------|:---:|:---:|:---:|:---:|:---:|
| Orchestrator | yes | yes | yes | yes | yes |
| Builder agents | yes (new bugs) | yes (own ticket) | no | **NO** | **NO** |
| Review agents | yes (findings) | yes | yes (add findings) | **NO** | **NO** |

If the taskboard is not running when needed:
```bash
taskboard start --port 3010 &    # NO --db flag — uses OS default path
sleep 2
# Verify board has data — 0 tickets means wrong DB path
curl -s http://taskboard.localhost:1355/api/board | python3 -c "import json,sys; c=len(json.load(sys.stdin).get('tickets',[])); print(f'{c} tickets'); exit(0 if c > 0 else 1)"
# If 0 tickets, sync from GitHub:
python3 .claude/hooks/github_project_sync.py pull
```

**CRITICAL:** NEVER pass `--db .claude/taskboard.db` — it creates an empty local copy. The OS default (`~/Library/Application Support/taskboard/`) is the source of truth.

**Web UI:** http://taskboard.localhost:1355 (fallback: http://localhost:3010)
**Project:** Project Forge (prefix: PF, ID: `01KK974VMNC16ZAW7MW1NH3T3M`)

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
| SpawnForge PM | `01KK9751P7GKQYG9TZ96XXQCFN` | Spec writing, planning, audits, documentation |
| SpawnForge Engineering | `01KK9751NZ4HM7VQM0AQ5WGME3` | Implementation, bug fixes, tests, code changes |
| SpawnForge Leadership | `01KK9751PD79RCWY462CYQ06CW` | Manual tasks requiring user action (approvals, external work) |

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
6. **Sync ticket to GitHub** — run `/sync-push` so the ticket becomes a GitHub issue. You need the GitHub issue number (`#NNNN`) to link PRs with `Closes #NNNN`.
7. Move the ticket to `in_progress` using `move_ticket`

### Before Creating Any PR

**MANDATORY** — every PR must link to a GitHub issue:
1. Run `/sync-push` to ensure your ticket exists as a GitHub issue
2. Find the GitHub issue number: `gh issue list --search "PF-XXX in:title" --limit 1`
3. Include `Closes #NNNN` (GitHub issue number, NOT `PF-XXX`) in the PR body
4. The CI work item check will **fail** if the PF-XXX ticket isn't found as a GitHub issue

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
  project: "01KK974VMNC16ZAW7MW1NH3T3M"
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

## REST API (primary access method)

The taskboard is accessed via REST API. Use the Portless URL when available, direct port as fallback.
**Base URL:** `http://taskboard.localhost:1355/api` (fallback: `http://taskboard.localhost:1355/api`)

### CRITICAL: Field name is `status`, NOT `column`

```bash
# Move ticket — field is "status", NOT "column"
curl -s -X POST "http://taskboard.localhost:1355/api/tickets/<TICKET_ID>/move" \
  -H 'Content-Type: application/json' \
  -d '{"status":"in_progress"}'   # ✅ CORRECT
  # -d '{"column":"in_progress"}' # ❌ WRONG — silently fails

# Create ticket
curl -s -X POST "http://taskboard.localhost:1355/api/tickets" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "...",
    "description": "...",
    "priority": "high",
    "projectId": "01KK974VMNC16ZAW7MW1NH3T3M",
    "teamId": "01KK9751NZ4HM7VQM0AQ5WGME3"
  }'

# Get ticket
curl -s "http://taskboard.localhost:1355/api/tickets/<TICKET_ID>"

# Get board
curl -s "http://taskboard.localhost:1355/api/board"

# Create subtask
curl -s -X POST "http://taskboard.localhost:1355/api/tickets/<TICKET_ID>/subtasks" \
  -H 'Content-Type: application/json' \
  -d '{"title": "Step 1: ..."}'

# Toggle subtask
curl -s -X POST "http://taskboard.localhost:1355/api/subtasks/<SUBTASK_ID>/toggle"
```

### API Field Reference

| Endpoint | Method | Body Fields | Notes |
|----------|--------|-------------|-------|
| `/api/tickets` | POST | `title`, `description`, `priority`, `projectId`, `teamId`, `labels` | `projectId` not `project` |
| `/api/tickets/:id/move` | POST | `status` ("todo", "in_progress", "done") | **NOT `column`** |
| `/api/tickets/:id` | PUT | `title`, `description`, `priority`, `labels`, `dueDate` | Partial update |
| `/api/tickets/:id/subtasks` | POST | `title` | Single subtask |
| `/api/subtasks/:id/toggle` | POST | (none) | Toggles complete/incomplete |
| `/api/board` | GET | (none) | Returns `{ columns: [{ name, tickets }] }` |

## Priority Definitions

| Priority | Meaning | SLA |
|----------|---------|-----|
| `urgent` | Blocks all other work, production issue | Address immediately |
| `high` | Important, affects key functionality | Address this session |
| `medium` | Normal priority, planned work | Address within 2 sessions |
| `low` | Nice to have, cleanup, minor improvements | When convenient |

## Scripts

- `bash "${CLAUDE_SKILL_DIR}/scripts/board-summary.sh"` — Fetch board state and print summary: ticket counts by status, in-progress tickets with subtask progress, recently completed, high-priority todo, and staleness warnings (>4h in in_progress)
- `bash "${CLAUDE_SKILL_DIR}/scripts/validate-ticket.sh" <TICKET_ID>` — Validate a ticket against the mandatory format: checks user story, description, Given/When/Then acceptance criteria, priority, team, and subtasks

## GitHub Sync

Sync local taskboard tickets to/from the GitHub Project board (SpawnForge #2).

### Push local tickets to GitHub (MANDATORY before creating any PR)

Every PR must link to a GitHub issue (`Closes #NNNN`). Tickets only become GitHub issues after sync-push runs.

```bash
# Incremental push (syncs todo + in_progress + recently-done)
cd /Users/tristannolan/project-forge && python3 .claude/hooks/github_project_sync.py push

# Full push (all tickets including historical done)
cd /Users/tristannolan/project-forge && python3 .claude/hooks/github_project_sync.py push-all

# Check sync status
cd /Users/tristannolan/project-forge && python3 .claude/hooks/github_project_sync.py status
```

Then find the GitHub issue number for your ticket:

```bash
gh issue list --search "PF-XXX in:title" --limit 1
```

Include `Closes #NNNN` (GitHub issue number, NOT `PF-XXX`) in every PR body. CI will fail without it.

### Pull GitHub changes to local taskboard

```bash
# Pull changes from GitHub
cd /Users/tristannolan/project-forge && python3 .claude/hooks/github_project_sync.py pull
```

This runs automatically via SessionStart hook. Pull manually when:
- Another contributor just made changes and you need them immediately
- You suspect sync is out of date

### Sync configuration

- Config: `.claude/hooks/github-sync-config.json` (project IDs, field mappings)
- Mapping: `.claude/hooks/github-project-map.json` (ticket ↔ GitHub item ID mapping)
- DB path: auto-detected — never pass `--db .claude/taskboard.db` to `taskboard start`

### Conflict resolution

If the same ticket changed locally and on GitHub:
- `push` overwrites GitHub with local status
- `pull` overwrites local with GitHub status

To resolve manually: pull → fix local status → push.
