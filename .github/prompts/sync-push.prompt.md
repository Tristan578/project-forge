---
agent: coding-agent
tools: ["terminal"]
description: "Push local taskboard changes to GitHub Project board"
---

Push local taskboard ticket changes to the GitHub Project board by running:

```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py push
```

If the user specified `--all`, use `push-all` instead of `push`.

After pushing, show the sync status:

```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```
