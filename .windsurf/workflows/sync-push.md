# Sync Push — Push Local Taskboard to GitHub Project

Push local taskboard ticket changes to the GitHub Project board.

## Steps

1. Run the sync push script:
```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py push
```

2. For a full push including all done tickets:
```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py push-all
```

3. Verify sync status:
```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```
