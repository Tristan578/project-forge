# /sync-pull — Pull GitHub Project to Local Taskboard

Pull changes from the GitHub Project board (SpawnForge #2) into the local taskboard.

## What It Does

1. Fetches all items from the GitHub Project via `gh project item-list`
2. For tracked items: compares GitHub status with last-synced status; updates local ticket if changed
3. For untracked draft items: creates a new local ticket and adds it to the mapping
4. Saves the updated mapping to @.claude/hooks/github-project-map.json

## Behavior

- Only imports **draft items** from GitHub (not Issues or PRs that were added to the board separately)
- Strips `PF-XX:` prefix from titles when creating local tickets (local board assigns its own numbers)
- New tickets are created with `medium` priority by default — update after import if needed

## Commands

```bash
# Pull changes from GitHub
cd project-forge && python3 .claude/hooks/github_project_sync.py pull

# Check sync status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

## When to Use

- At the start of a work session (runs automatically via SessionStart hook)
- After another contributor has updated tickets on the GitHub Project board
- To verify that local state matches remote state
- After resolving sync conflicts

## Automatic Sync

This runs automatically via the **SessionStart hook** when a Claude Code session starts. You typically don't need to invoke it manually unless:
- Another contributor just made changes and you want them immediately
- You suspect sync is out of date

## Configuration

- Config: @.claude/hooks/github-sync-config.json (project IDs, field mappings)
- Mapping: @.claude/hooks/github-project-map.json (ticket <> GitHub item ID mapping)

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- Taskboard API running (`taskboard start --port 3010 --db .claude/taskboard.db`)
- GitHub Project "SpawnForge" (#2) exists with Todo/In Progress/Done columns

## Conflict Resolution

If the same ticket was changed both locally and on GitHub between syncs, the **last sync direction wins**:
- `push` overwrites GitHub with local status
- `pull` overwrites local with GitHub status

To resolve conflicts manually:
1. Run `/sync-pull` to see what GitHub thinks
2. Run `python3 .claude/hooks/github_project_sync.py status` to compare
3. Manually move tickets to the correct status using the taskboard
4. Run `/sync-push` to finalize
