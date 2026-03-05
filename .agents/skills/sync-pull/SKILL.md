---
name: sync-pull
description: "Pull changes from GitHub Project board into local taskboard. Creates local tickets for new remote items and updates status for changed items. Use when you need to manually sync inbound changes from other contributors."
user-invokable: true
---

# /sync-pull — Pull GitHub Project to Local Taskboard

Pull changes from the GitHub Project board (SpawnForge #2) into the local taskboard.

## Commands

```bash
# Pull changes from GitHub
cd project-forge && python3 .claude/hooks/github_project_sync.py pull

# Check sync status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

## V2 Bidirectional Sync

Pull now handles **full ticket content** from GitHub (not just status):
- **Subtask sync**: Parses `- [ ]`/`- [x]` checkboxes from GitHub body, creates/updates local subtasks
- **Body sync**: Detects description/priority changes via bodyHash, updates local ticket
- **Re-linking**: If a mapping entry is lost, re-links tickets by ULID from `<!-- SPAWNFORGE_METADATA -->` block — no duplicates
- **Backward compat**: Still parses v1 format (`**Taskboard:** PF-N (ULID)`) for old tickets
- **New ticket import**: Extracts priority, teamId, description, and subtasks from v2 body when creating local tickets

## When to Use

- At the start of a work session (runs automatically via SessionStart hook)
- After another contributor has updated tickets on the GitHub Project board
- To verify that local state matches remote state
- After modifying subtask checkboxes directly on GitHub

## Automatic Sync

This runs automatically via the SessionStart hook when a session starts. Manual invocation is only needed when you want immediate updates mid-session.

## Prerequisites

- `gh` CLI authenticated
- Taskboard API running on port 3010
- Python 3 available
