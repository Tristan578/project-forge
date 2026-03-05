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
- **Team**: Engineering (`01KJFNHZC49XG9KXRYTMYEEDTS`), PM (`01KJFNJC02QK6F5NSDND7NH5MS`), Leadership (`01KJFNK35JVPQJESS3RZM0F5HP`)
- **Subtasks**: At least 3 implementation steps

## GitHub Project Sync

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

## On Session Start

The hooks automatically:
1. Check taskboard binary is installed
2. Auto-start server if not running
3. Pull from GitHub Project
4. Display backlog with prioritized suggestions

**Always review the suggestions and pick work from the board.**
