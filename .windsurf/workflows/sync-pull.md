# Sync Pull — Pull GitHub Project to Local Taskboard

Pull changes from the GitHub Project board into the local taskboard.

## Steps

1. Run the sync pull script:
```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py pull
```

2. Verify sync status:
```bash
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

3. Check the board for newly imported tickets:
```bash
curl -s http://localhost:3010/api/board | python3 -m json.tool
```
