# Taskboard Enforcement Rules

## MANDATORY: Planning Before Development

**No code changes without a ticket.** This rule has no exceptions.

Before writing ANY code:
1. Ensure taskboard is running (start: `cd project-forge && taskboard start --port 3010 --db .claude/taskboard.db`)
2. Check the board for existing work
3. Pick an existing ticket OR create a new one with ALL required fields
4. Move the ticket to `in_progress`
5. Only then begin implementation

If you discover new work during development, create a separate ticket for it FIRST.

## Required Ticket Fields
- **User Story**: Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive)
- **Description**: Technical context, affected files, scope (at least 20 chars beyond user story + AC)
- **Acceptance Criteria**: Given/When/Then format — **minimum 3 scenarios** (happy path, edge case, negative/error case)
- **Priority**: urgent, high, medium, low
- **Team**: Engineering (`01KJFNHZC49XG9KXRYTMYEEDTS`), PM (`01KJFNJC02QK6F5NSDND7NH5MS`), Leadership (`01KJFNK35JVPQJESS3RZM0F5HP`)
- **Subtasks**: At least 3 implementation steps

## GitHub Project Sync

Tickets sync with GitHub Project "SpawnForge" (#2, owner: Tristan578).

```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py push   # local -> GitHub
cd project-forge && python3 .claude/hooks/github_project_sync.py pull   # GitHub -> local
cd project-forge && python3 .claude/hooks/github_project_sync.py status # show state
```

## Worktree Commit Safety

When working in a git worktree (subagents, feature branches), **commit after every logical chunk of work** (each test file, each feature, each bug fix). Rate limits and crashes can kill agents at any time — uncommitted work is permanently lost. Never accumulate large uncommitted changesets.

The stop hook auto-commits as a safety net via `worktree-safety-commit.sh`, but you MUST commit frequently yourself.

## Hook Scripts

Run these manually since Antigravity does not auto-execute hooks:
```bash
cd project-forge && bash .claude/hooks/on-session-start.sh   # session start (taskboard + GitHub pull)
cd project-forge && bash .claude/hooks/on-stop.sh             # after work (worktree safety commit + GitHub push)
cd project-forge && bash .claude/hooks/post-edit-lint.sh      # after editing web/ files (ESLint)
```
