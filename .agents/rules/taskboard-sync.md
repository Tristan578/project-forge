# Taskboard Enforcement Rules

## MANDATORY: Planning Before Development

**No code changes without a ticket.** This rule has no exceptions.

Before writing ANY code:
1. Ensure taskboard is running (auto-started by hooks, or: `taskboard start --port 3010 --db .claude/taskboard.db`)
2. Check the board for existing work
3. Pick an existing ticket OR create a new one with ALL required fields
4. Move the ticket to `in_progress`
5. Only then begin implementation

If you discover new work during development, create a separate ticket for it FIRST.

## Taskboard Installation

Binary: tcarac/taskboard
```bash
go install github.com/tcarac/taskboard@latest
```
Or download from: https://github.com/tcarac/taskboard/releases

Place in: `../taskboard/`, `~/.local/bin/`, `/usr/local/bin/`, or PATH.

## Required Ticket Fields
- **User Story**: Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive)
- **Description**: Technical context, affected files, scope (at least 20 chars beyond user story + AC)
- **Acceptance Criteria**: Given/When/Then format — **minimum 3 scenarios** (happy path, edge case, negative/error case)
- **Priority**: urgent, high, medium, low
- **Team**: Engineering (`01KK9751NZ4HM7VQM0AQ5WGME3`), PM (`01KK9751P7GKQYG9TZ96XXQCFN`), Leadership (`01KK9751PD79RCWY462CYQ06CW`)
- **Subtasks**: At least 3 implementation steps

## GitHub Project Sync (v3 Architecture)

Tickets sync with GitHub Project "SpawnForge" (#2, owner: Tristan578).

### Automatic (via hooks)
- Session start: pulls from GitHub
- After response: pushes to GitHub

### Manual
```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py push   # local -> GitHub
cd project-forge && python3 .claude/hooks/github_project_sync.py pull   # GitHub -> local
cd project-forge && python3 .claude/hooks/github_project_sync.py status # show state
```

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

## On Session Start

The hooks automatically:
1. Check taskboard binary is installed
2. Auto-start server if not running
3. Pull from GitHub Project
4. Display backlog with prioritized suggestions

**Always review the suggestions and pick work from the board.**

## Worktree Commit Safety

When working in a git worktree (subagents, feature branches), **commit after every logical chunk of work** (each test file, each feature, each bug fix). Rate limits and crashes can kill agents at any time — uncommitted work is permanently lost. Never accumulate large uncommitted changesets.

The stop hook auto-commits as a safety net via `worktree-safety-commit.sh`, but you MUST commit frequently yourself.
