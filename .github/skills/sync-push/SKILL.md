---
name: sync-push
description: "Push local taskboard ticket changes to GitHub Project board. Creates draft issues for new tickets and updates status for changed tickets."
argument-hint: "Optional: --all to include done tickets"
user-invokable: true
---

# /sync-push — Push Local Taskboard to GitHub Project

```bash
# Incremental push
cd project-forge && python3 .claude/hooks/github_project_sync.py push

# Full push including done tickets
cd project-forge && python3 .claude/hooks/github_project_sync.py push-all

# Check status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

Runs automatically via Stop hook. Manual use for bulk operations only.
