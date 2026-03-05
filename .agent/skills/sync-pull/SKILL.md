---
name: sync-pull
description: "Pull changes from GitHub Project board into local taskboard. Syncs subtasks, description, priority, and re-links tickets by ULID metadata."
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

Pull handles **full ticket content** from GitHub (not just status):
- **Subtask sync**: Parses `- [ ]`/`- [x]` checkboxes from GitHub body, creates/updates local subtasks
- **Body sync**: Detects description/priority changes via bodyHash, updates local ticket
- **Re-linking**: If a mapping entry is lost, re-links tickets by ULID from `<!-- SPAWNFORGE_METADATA -->` block — no duplicates
- **Backward compat**: Still parses v1 format (`**Taskboard:** PF-N (ULID)`) for old tickets

## When to Use

- At the start of every work session
- After another contributor has updated tickets on GitHub
- After modifying subtask checkboxes directly on GitHub

## Prerequisites

- `gh` CLI authenticated
- Taskboard API running on port 3010
- Python 3 available
