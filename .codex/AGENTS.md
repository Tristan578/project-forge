# SpawnForge — Codex CLI Instructions

## CRITICAL: No Code Without a Ticket

**Before writing ANY code, you MUST have a ticket.** This is non-negotiable and applies to every contributor and every AI tool in this repo.

### Workflow (Manual — Codex has no hooks)

Since Codex CLI does not support lifecycle hooks, you MUST manually run these steps. Other tools (Claude Code, Copilot, Gemini, Windsurf) enforce these automatically via hooks — you must self-enforce.

#### On Session Start
Run these commands before doing any work:
```bash
# 1. Ensure taskboard is running
cd project-forge && bash .claude/hooks/on-session-start.sh

# Or manually (see Canonical Project Facts for the start command):
cd project-forge && taskboard start --port 3010
```
This will auto-start the taskboard, pull GitHub Project changes, and display prioritized backlog.

#### Before Writing Code
1. Review the backlog at http://localhost:3010
2. Pick an existing ticket OR create a new one via the API
3. Ensure the ticket passes validation (see Required Ticket Fields below)
4. Move the ticket to `in_progress`

#### After Completing Work
```bash
# Validate tickets and push to GitHub
cd project-forge && bash .claude/hooks/on-stop.sh
```

#### After Editing Files
```bash
# Lint changed files
cd project-forge && bash .claude/hooks/post-edit-lint.sh
```

## Taskboard Setup

**Binary**: tcarac/taskboard (install via `go install github.com/tcarac/taskboard@latest`)

<!-- AGENTIC-SYNC:START -->
<!-- Generated from tools/agentic-sync/canonical.json by tools/agentic-sync/sync.mjs.
     Do NOT hand-edit between these markers — edit canonical.json and run
     `node tools/agentic-sync/sync.mjs --write`. CI gate: scripts/check-agentic-sync.sh. -->

### Canonical Project Facts

**Taskboard** — the single source of truth for all work:
- Project: **Project Forge** (`01KMM9ZA6SBZ7RKJZJTZS9VR4R`, prefix `PF`)
- Teams: Engineering `01KMR5E36TP59PRQA8GQEWJVM1`, PM `01KMR5E3852BWXAZ219W47CSKS`
- API: `http://localhost:3010/api` · Web UI: `http://localhost:3010`
- Start: `taskboard start --port 3010`  *(do not pass `--db` — it uses the OS-default DB)*
- These IDs are board-local; if a query 404s, rediscover with `curl -s http://localhost:3010/api/projects`

**Pinned versions:** Next.js 16.2.0 · React 19.2.4 · wasm-bindgen 0.2.108 · Bevy 0.18 *(wasm-bindgen must match Cargo.lock exactly)*

**Coverage thresholds (CI-enforced):** statements 81 · branches 71 · functions 75 · lines 82

**Quick validation:** `cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run`
<!-- AGENTIC-SYNC:END -->

## Required Ticket Fields

Every ticket MUST have ALL of these before work begins:
- **User Story**: Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive)
- **Description**: Technical context, affected files, scope (at least 20 chars beyond user story + AC)
- **Acceptance Criteria**: Given/When/Then format — **minimum 3 scenarios** (happy path, edge case, negative/error case)
- **Priority**: urgent, high, medium, low
- **Team**: Engineering or PM — use the team IDs in **Canonical Project Facts** above
- **Subtasks**: At least 3 implementation steps (the plan)

### Ticket Template

```
Title: [concise imperative action]

User Story:
As a [developer/user/admin], I want [specific goal] so that [measurable benefit].

Description:
[Technical context, affected files, root cause analysis, spec reference if applicable]

Acceptance Criteria:
- Given [precondition], When [action], Then [expected result]  (happy path)
- Given [precondition], When [action], Then [expected result]  (edge case)
- Given [precondition], When [action], Then [expected result]  (negative/error)

Priority: [urgent/high/medium/low]
Labels: [bug/feature/refactor/test/docs]
```

## GitHub Project Sync (v3 Architecture)

Tickets sync bidirectionally with GitHub Project "SpawnForge" (#2, owner: Tristan578).

```bash
# Push local changes to GitHub
cd project-forge && python3 .claude/hooks/github_project_sync.py push

# Pull GitHub changes to local
cd project-forge && python3 .claude/hooks/github_project_sync.py pull

# Full push (all tickets including done)
cd project-forge && python3 .claude/hooks/github_project_sync.py push-all

# Check sync status
cd project-forge && python3 .claude/hooks/github_project_sync.py status
```

### Sync Source of Truth: `github_issue_number` + `sync_repo`

**CRITICAL: These two SQLite columns are the SOLE arbiters of sync truth.**

| Column | Type | Purpose |
|--------|------|---------|
| `github_issue_number` | INTEGER | Links local ticket to a specific GitHub Issue. **THE definitive remote ID.** |
| `sync_repo` | TEXT | Which repository this ticket syncs to. Must be `"project-forge"` for SpawnForge. |

**Rules:**
1. **NEVER match tickets by title.** Only `github_issue_number` links local <-> remote.
2. **NEVER sync tickets where `sync_repo` does not match.** This prevents data leakage between projects sharing the same SQLite database.
3. **Push behavior**: If `github_issue_number` exists -> UPDATE the remote issue. If NULL -> CREATE a new GitHub issue and IMMEDIATELY write `github_issue_number` back to SQLite.
4. **Pull behavior**: Match by `github_issue_number` first (authoritative). If new -> create local ticket with `github_issue_number` + `sync_repo` set immediately.
5. **The JSON map file (`github-project-map.json`) is a CACHE**, not the source of truth. If the map is lost, the SQLite columns allow full reconstruction.
6. **Auto-migration**: The sync script auto-adds these columns on first run via `_ensure_sync_columns()`, so new developers get them automatically.
7. **Project isolation**: Tickets from other local projects have `sync_repo = NULL` and are NEVER visible to the sync script.

## Project Overview

SpawnForge is an AI-native 2D/3D game engine for the browser.

```
React Shell (Next.js 16, Zustand, Tailwind)  <- Editor UI + AI chat
    |  JSON events via wasm-bindgen
Bevy Editor Engine (Rust -> WASM)             <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting           <- Playing user-created games
```

## Worktree Commit Safety

When working in a git worktree (subagents, feature branches), **commit after every logical chunk of work** (each test file, each feature, each bug fix). Rate limits and crashes can kill agents at any time — uncommitted work is permanently lost. Never accumulate large uncommitted changesets.

After completing work, run `bash .claude/hooks/on-stop.sh` to trigger worktree safety commit and GitHub sync.

## CI/CD Enforcement

**All PRs must pass CI before merge.** Branch protection is enabled on `main`.

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR:
- Lint (ESLint zero warnings), TypeScript check, Web tests (vitest), MCP tests
- WASM build (WebGL2 + WebGPU), Next.js production build
- E2E UI tests (Playwright), Security audit (npm audit + cargo audit)
- CodeQL analysis (JS/TS, Python, Rust, Actions)

**Never skip CI checks.** If CI fails, fix the code — do not force-merge.

## Architecture Rules

- **Bridge isolation**: Only `engine/src/bridge/` may import web_sys/js_sys/wasm_bindgen
- **Command-driven**: All engine ops go through `handle_command()` JSON commands
- **Zero ESLint warnings**: `npx eslint --max-warnings 0`
- **wasm-bindgen v0.2.108**: Must match Cargo.lock exactly
- **No `any` types**: Strict TypeScript mode, use Zod for runtime validation
- **No secrets in code**: Use environment variables with `.env.local`

## Build Commands

```bash
# WASM engine build
powershell.exe -File ".\build_wasm.ps1"

# Web dev server
cd web && npm install && npm run dev

# Quick validation (run after every feature change)
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run

# MCP server tests
cd mcp-server && npx vitest run

# E2E tests (requires WASM build)
cd web && npx playwright test
```

## Detailed Reference

For full architecture rules, ECS patterns, and library APIs, see:
- `.claude/CLAUDE.md` — Full project constitution
- `.claude/rules/bevy-api.md` — Bevy 0.18 API patterns
- `.claude/rules/entity-snapshot.md` — ECS snapshot patterns
- `.claude/rules/web-quality.md` — ESLint & React patterns
- `.claude/rules/library-apis.md` — Third-party library APIs
- `.claude/rules/file-map.md` — Project file structure

## Hook Scripts (shared with all tools)

All hooks live in `.claude/hooks/` and are shared across Claude Code, Copilot, Gemini, Windsurf, and Codex:

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `on-session-start.sh` | Install check + auto-start + GitHub pull + backlog | Start of session |
| `on-prompt-submit.sh` | Ticket enforcement + stale reminders | Before starting work |
| `on-stop.sh` | Ticket validation + GitHub push | After completing work |
| `post-edit-lint.sh` | ESLint on changed files | After editing web/ files |
| `sync-to-github.sh` | Push to GitHub Project | After ticket changes |
| `sync-from-github.sh` | Pull from GitHub Project | Start of session |
