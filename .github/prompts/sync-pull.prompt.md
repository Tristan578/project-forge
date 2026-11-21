---
agent: coding-agent
tools: ["terminal"]
description: "Pull GitHub Project changes into local taskboard"
---

Pull changes from the GitHub Project board into the local taskboard by running:

```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py pull
```

After pulling, show the sync status:

```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```
