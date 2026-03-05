---
name: sync-pull
description: "Pull changes from GitHub Project board into local taskboard. Creates local tickets for new remote items and updates status for changed items."
user-invokable: true
---

# /sync-pull — Pull GitHub Project to Local Taskboard

```bash
# Pull changes
cd project-forge && python3 .claude/hooks/github_project_sync.py pull

# Check status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

Runs automatically via SessionStart hook. Manual use when you need immediate updates.
