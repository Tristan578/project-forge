# SpawnForge — Agent Instructions (Cross-Tool)

This file is read by Gemini CLI, GitHub Copilot, Google Antigravity, OpenAI Codex CLI, and other AI coding tools. For Claude Code, see `.claude/CLAUDE.md`.

## MANDATORY: Planning Before Development

**No code changes without a ticket.** This is enforced by hooks on all AI tools.

Before writing ANY code, you MUST:
1. Check the taskboard for existing work (review session startup suggestions)
2. Either pick an existing ticket OR create a new one with ALL required fields
3. Move the ticket to `in_progress`
4. Only then begin implementation

If you are asked to write code and no ticket exists, **create the ticket first**. This is not optional — it ensures all three contributors can monitor progress through the shared GitHub Project board.

## Taskboard Setup

The taskboard (tcarac/taskboard) is the single source of truth for all project work.

### Installation
```bash
# Option 1: Go install
go install github.com/tcarac/taskboard@latest

# Option 2: Download binary from releases
# https://github.com/tcarac/taskboard/releases
# Place in: ../taskboard/, ~/.local/bin/, /usr/local/bin/, or PATH
```

### Starting the Server
```bash
cd project-forge
taskboard start --port 3010 --db .claude/taskboard.db
```

The session start hook will auto-start the server if the binary is found. If it fails, start manually.

- **Web UI**: http://localhost:3010
- **API**: http://localhost:3010/api
- **Project ID**: `01KK974VMNC16ZAW7MW1NH3T3M` (prefix: PF)

### Required Ticket Fields
Every ticket MUST have ALL of these before work begins:
- **User Story**: Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive)
- **Description**: Technical context, affected files, scope (at least 20 chars beyond user story + AC)
- **Acceptance Criteria**: Given/When/Then format — **minimum 3 scenarios** (happy path, edge case, negative/error case)
- **Priority**: urgent, high, medium, low
- **Team**: Engineering (`01KK9751NZ4HM7VQM0AQ5WGME3`), PM (`01KK9751P7GKQYG9TZ96XXQCFN`), or Leadership (`01KK9751PD79RCWY462CYQ06CW`)
- **Subtasks**: At least 3 implementation steps (the plan)

### Workflow
1. **Session start**: Taskboard auto-starts, GitHub sync pulls, backlog is displayed
2. **Pick work**: Resume in-progress tickets first, then highest priority todo
3. **Create ticket if needed**: Fill ALL required fields — this IS the planning step
4. **Move to in_progress**: Only after ticket is fully documented
5. **Toggle subtasks**: As you complete each implementation step
6. **Move to done**: After ALL acceptance criteria are verified
7. **Session end**: Changes auto-push to GitHub Project

## GitHub Project Sync (v3 Architecture)

Tickets sync bidirectionally with GitHub Project "SpawnForge" (#2, owner: Tristan578).

- **Automatic push**: After each response via Stop hook
- **Automatic pull**: At session start via SessionStart hook
- **Manual sync**: `python3 .claude/hooks/github_project_sync.py push|pull|status`

All three contributors see the same board on GitHub regardless of which AI tool they use.

### Sync Source of Truth: `github_issue_number` + `sync_repo`

**CRITICAL: These two SQLite columns are the SOLE arbiters of sync truth.**

| Column | Type | Purpose |
|--------|------|---------|
| `github_issue_number` | INTEGER | Links local ticket to a specific GitHub Issue. **THE definitive remote ID.** |
| `sync_repo` | TEXT | Which repository this ticket syncs to. Must be `"project-forge"` for SpawnForge. |

**Rules:**
1. **NEVER match tickets by title.** Only `github_issue_number` links local ↔ remote.
2. **NEVER sync tickets where `sync_repo` does not match.** This prevents data leakage between projects sharing the same SQLite database.
3. **Push behavior**: If `github_issue_number` exists → UPDATE the remote issue. If NULL → CREATE a new GitHub issue and IMMEDIATELY write `github_issue_number` back to SQLite.
4. **Pull behavior**: Match by `github_issue_number` first (authoritative). If new → create local ticket with `github_issue_number` + `sync_repo` set immediately.
5. **The JSON map file (`github-project-map.json`) is a CACHE**, not the source of truth. If the map is lost, the SQLite columns allow full reconstruction.
6. **Auto-migration**: The sync script auto-adds these columns on first run, so new developers get them automatically.
7. **Project isolation**: Tickets from other local projects (e.g., Ember) have `sync_repo = NULL` and are NEVER visible to the sync script.

## Architecture Overview

SpawnForge is an AI-native 2D/3D game engine for the browser.

```
React Shell (Next.js 16, Zustand, Tailwind)  <- Editor UI + AI chat
    |  JSON events via wasm-bindgen
Bevy Editor Engine (Rust -> WASM)             <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting           <- Playing user-created games
```

### Key Rules
- **Bridge isolation**: Only `engine/src/bridge/` may import web_sys/js_sys/wasm_bindgen
- **Command-driven**: All engine ops go through `handle_command()` JSON commands
- **Zero ESLint warnings**: `npx eslint --max-warnings 0`
- **wasm-bindgen v0.2.108**: Must match Cargo.lock exactly
- **Worktree commit safety**: When in a git worktree, commit after every logical chunk. Rate limits/crashes kill agents — uncommitted work is permanently lost
- **CI enforcement**: All PRs must pass CI before merge. Never skip checks or force-merge

## Build Commands

```bash
# WASM engine build
powershell.exe -File ".\build_wasm.ps1"

# Web dev server
cd web && npm install && npm run dev

# Quick validation
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

## Hook Scripts (shared across all tools)

All hooks live in `.claude/hooks/` and are called by each tool's config:

| Script | Purpose | Trigger |
|--------|---------|---------|
| `on-session-start.sh` | Install check + auto-start + GitHub pull + backlog | Session start |
| `on-prompt-submit.sh` | Ticket enforcement gate + stale reminders | Before prompt |
| `on-stop.sh` | Worktree safety commit + ticket validation + GitHub push | After response |
| `worktree-safety-commit.sh` | Auto-commit uncommitted work in worktrees | Called by on-stop |
| `post-edit-lint.sh` | ESLint on changed files | After file edit |
| `sync-to-github.sh` | Push local changes to GitHub Project | Called by on-stop |
| `sync-from-github.sh` | Pull GitHub changes to local | Called by on-session-start |

**Tool hook support**: Claude Code, Copilot, Gemini CLI, and Windsurf run these automatically via their hook configs. Codex CLI and Antigravity do not support hooks — developers must run the scripts manually (see `.codex/AGENTS.md` or `.agent/rules/taskboard-sync.md`).

**Antigravity config**: `.agent/rules/` (project rules + taskboard enforcement) + `.agent/skills/` (kanban, sync-push, sync-pull). See `.agent/rules/project.md` for full architecture and coding standards.

**Skills directory note**: Gemini CLI and Copilot read `.agents/skills/` (plural). Antigravity reads `.agent/skills/` (singular). Both contain the same skills.

## Domain Skills

Specialized development patterns live in `.claude/skills/`. Read the relevant skill before working in that domain:

| Skill | Path | Use When |
|-------|------|----------|
| Rust Engine | `.claude/skills/rust-engine/SKILL.md` | Writing engine/ code (ECS, commands, bridge, pending queues) |
| Frontend | `.claude/skills/frontend/SKILL.md` | Writing web/ code (React 19, Zustand 5, Tailwind 4, Next.js 16) |
| MCP Commands | `.claude/skills/mcp-commands/SKILL.md` | Adding MCP commands, chat handlers, AI parity |
| Testing | `.claude/skills/testing/SKILL.md` | Writing tests, improving coverage (target: 100%) |
| Documentation | `.claude/skills/docs/SKILL.md` | Updating docs, README, known-limitations |
| Design | `.claude/skills/design/SKILL.md` | Designing features, architecture decisions |
| Developer Experience | `.claude/skills/developer-experience/SKILL.md` | DX audits, DoQ/DoD, onboarding, cross-IDE consistency |

## Validation Tools

Runnable scripts in `.claude/tools/` — run these after making changes:

```bash
bash .claude/tools/validate-rust.sh check      # Architecture boundaries + bridge isolation
bash .claude/tools/validate-frontend.sh quick   # ESLint + TypeScript + vitest
bash .claude/tools/validate-mcp.sh full         # Manifest sync + MCP tests + parity audit
bash .claude/tools/validate-tests.sh coverage   # Test coverage report
bash .claude/tools/validate-docs.sh             # Documentation integrity check
bash .claude/tools/dx-audit.sh                  # DX audit (cross-IDE, docs, tools)
bash .claude/tools/validate-all.sh              # Run all validators
```
