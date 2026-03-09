---
trigger: always_on
---

# SpawnForge Taskboard Enforcement

## MANDATORY: No Code Without a Ticket

Before writing ANY code, you MUST:
1. Check the taskboard at http://localhost:3010 for existing work
2. Pick an existing ticket OR create a new one with ALL required fields
3. Move the ticket to `in_progress`
4. Only then begin implementation

This is enforced by hooks. All three contributors monitor progress via the shared GitHub Project board.

## Taskboard Setup

**Binary**: tcarac/taskboard (install via `go install github.com/tcarac/taskboard@latest`)
**Start**: `cd project-forge && taskboard start --port 3010 --db .claude/taskboard.db`
**Project ID**: `01KJEE8R1XXFF0CZT1WCSTGRDP` (prefix: PF)

The session hooks will auto-start the server if the binary is found.

## Required Ticket Fields
- **User Story**: Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive)
- **Description**: Technical context, affected files, scope (at least 20 chars beyond user story + AC)
- **Acceptance Criteria**: Given/When/Then format — **minimum 3 scenarios** (happy path, edge case, negative/error case)
- **Priority**: urgent, high, medium, low
- **Team**: Engineering (`01KJFNHZC49XG9KXRYTMYEEDTS`), PM (`01KJFNJC02QK6F5NSDND7NH5MS`), Leadership (`01KJFNK35JVPQJESS3RZM0F5HP`)
- **Subtasks**: At least 3 implementation steps (this IS the plan)

## GitHub Project Sync (v3 Architecture)
- Push: `cd project-forge && python3 .claude/hooks/github_project_sync.py push`
- Pull: `cd project-forge && python3 .claude/hooks/github_project_sync.py pull`
- Automatic via hooks (push after response, pull at session start)

### Sync Source of Truth: `github_issue_number` + `sync_repo`

These two SQLite columns are the SOLE arbiters of sync truth:

| Column | Type | Purpose |
|--------|------|---------|
| `github_issue_number` | INTEGER | Links local ticket to a specific GitHub Issue |
| `sync_repo` | TEXT | Which repo this ticket syncs to. Must be `"project-forge"` for SpawnForge |

**Rules:**
1. **NEVER match tickets by title.** Only `github_issue_number` links local <-> remote.
2. **NEVER sync tickets where `sync_repo` does not match.** Prevents data leakage between projects.
3. **Push**: `github_issue_number` exists -> UPDATE. NULL -> CREATE and immediately write back.
4. **Pull**: Match by `github_issue_number` first. New -> create with both columns set.
5. **JSON map file is a CACHE**, not truth. SQLite columns are authoritative.
6. **Auto-migration**: `_ensure_sync_columns()` adds columns on first run. Non-destructive.
7. **Project isolation**: Other projects' tickets have `sync_repo = NULL` and are never synced.

## Architecture
- Bridge isolation: Only `engine/src/bridge/` may import web_sys/js_sys
- Command-driven: All engine ops via `handle_command()` JSON
- Zero ESLint warnings enforced
- wasm-bindgen v0.2.108 pinned

## Quick Validation
```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```
