# SpawnForge — Gemini CLI & Antigravity Instructions

@AGENTS.md

- Check for the presence of AGENTS.md files in the project workspace
- There may be additional AGENTS.md in sub-folders with additional specific instructions related to that part of the codebase

## Setup

- Hooks: `.gemini/settings.json` (auto-start, sync, lint, ticket enforcement)
- Skills (Gemini CLI): `.agents/skills/` — kanban, sync-push, sync-pull
- Skills (Antigravity): `.agent/skills/` — kanban, sync-push, sync-pull
- Rules (Antigravity): `.agent/rules/taskboard-sync.md`
- Full project constitution: `.claude/CLAUDE.md`
- Architecture rules: `.claude/rules/*.md`

## On Session Start

The hooks will automatically (Gemini CLI):
1. Check that tcarac/taskboard is installed (install if missing)
2. Auto-start the taskboard server if not running
3. Pull latest changes from the GitHub Project board
4. Display the backlog with prioritized work suggestions

For Antigravity (no auto-hooks), run manually:
```bash
cd project-forge && bash .claude/hooks/on-session-start.sh
```

**You MUST select or create a ticket before writing any code.**
