# SpawnForge — Codex CLI Instructions

> **Codex does not load this file by itself.** It collects `AGENTS.md` only from the repository root down to the directory it started in, and `.codex/` is not on that path. The root `AGENTS.md` opens with a section telling a Codex session to read this file; if you are reading it, that worked. Anything that must reach Codex without that hop belongs in the root file.

## CRITICAL: No Code Without a Ticket

**Before writing ANY code, you MUST have a ticket.** This is non-negotiable and applies to every contributor and every AI tool in this repo.

### Workflow (hooks are wired — you are still responsible)

The shared enforcement scripts in `.claude/hooks/` are wired for Codex in
`.codex/hooks.json`: session start, prompt submit, before and after shell
commands and file edits, subagent start/stop, pre-compaction, and stop. That
file is **generated** from `.claude/settings.json` — never edit it; see
`docs/guides/codex-cli-support-matrix.md` for what is wired, what Codex cannot
express, and why.

**Do not assume a hook ran.** This wiring has been tested outside Codex but not
yet confirmed inside a live session, hooks run only after the one-time approval
below, and on Windows they silently do nothing if Codex was not started at the
repository root. Follow the rules in this file yourself; the hooks are a second
line, not a replacement. If you were not shown the session-start backlog, the
hooks are not running — do the manual steps under **If hooks are not running**.

**One-time setup per checkout — hooks do nothing until you do this:**

1. Start Codex **at the repository root**. On Windows the hook commands are
   paths relative to the directory Codex starts in; started anywhere else, every
   hook fails to find the adapter, Codex reports the run as failed and carries
   on — so blocking hooks do not block, and nothing says so.
2. Trust the project when Codex asks (or set `trust_level = "trusted"` for this
   path in `~/.codex/config.toml`). An untrusted project's `.codex/` layer is
   loaded but disabled.
3. Run `/hooks` and approve the listed hooks. Codex stores a hash per hook; a
   hook that is new **or whose command changed** is listed but never runs until
   it is approved again. After pulling a change to `.codex/hooks.json`, open
   `/hooks` again.
4. In a linked `git worktree`, Codex reads hooks from the **main checkout's**
   `.codex/`, not the worktree's. Test a hook change from the main checkout.

#### Requirements on PATH

`node`, `git`, `bash` (Git for Windows' bash on Windows) and `jq`, which most of
the shared scripts use to read their input. The adapter asks bash for `jq` before
it starts any script: without it **no** script is started — the ones that do not
use it included, so the gap shows at session start — a `PreToolUse` hook that
would have started one blocks, and the message names `jq` and this heading. (Left to themselves the scripts would split
two ways: the ones under `set -e` end with exit 127 and no message, the others
read nothing and pass.)

#### Before Writing Code
1. Review the backlog at http://localhost:3010
2. Pick an existing ticket OR create a new one via the API
3. Ensure the ticket passes validation (see Required Ticket Fields below)
4. Move the ticket to `in_progress`

#### Always manual under Codex
- After `git worktree add` (Codex has no worktree-created event). The script
  reads the new worktree's path from a JSON payload on stdin — run bare, it
  prints "No worktree_path in event" and does nothing. From the MAIN checkout
  (needs `jq`; `node` builds the JSON so a Windows path with backslashes is
  escaped correctly — a bare `printf` would produce invalid JSON for one):
  ```bash
  node -e 'process.stdout.write(JSON.stringify({worktree_path: process.argv[1]}))' "/absolute/path/to/the/new/worktree" | bash .claude/hooks/worktree-setup.sh
  ```
- After a compaction, re-read `.claude/rules/lessons-learned.md` and the rule
  file for the area you are in. Claude Code re-injects a digest at that point;
  Codex's post-compaction hook cannot carry text to the model.

#### If hooks are not running
```bash
bash .claude/hooks/on-session-start.sh                     # start of session: taskboard, GitHub pull, backlog
(cd web && npx eslint --max-warnings 0 <the files you edited>) # after editing files under web/
bash .claude/hooks/on-stop.sh                               # after completing work: ticket validation, GitHub push
```
(`post-edit-lint.sh` is not in that list on purpose: it takes the edited file
from a hook payload on stdin, so run by hand it lints nothing and exits 0. The
`eslint` line above is what it would have run.)

## Planning

Plan before you implement. This repository is spec-first — nothing is built
without an approved spec in `specs/` — and Codex's two planning commands are how
that discipline is kept inside a session:

- `/plan` switches to Plan mode. Use it before starting implementation on any
  ticket: produce the plan, check it against the ticket's acceptance criteria,
  and only then leave Plan mode.
- `/goal` sets or shows the goal for a long-running task. Use it for a ticket
  that spans more than one subtask, so the objective survives compaction.

These complement the ticket's own plan — every ticket carries at least three
subtasks (see **Required Ticket Fields**). The subtasks say *what* will be
delivered; `/plan` works out *how* before any file changes.

## Subagents and skills

- **Subagents** live in `.codex/agents/*.toml`, generated from
  `.claude/agents/*.md`. The five review-board seats are `code-architect`,
  `security-reviewer`, `dx-guardian`, `ux-reviewer` and `test-reviewer`
  (`test-writer` writes tests and never sits on the board). Protocol:
  `.claude/skills/review-protocol/SKILL.md`.
- **Skills** are discovered from `.agents/skills/`. The project skills there are
  byte-exact mirrors of `.claude/skills/`, regenerated by
  `node tools/agentic-sync/port.mjs --write`. Invoke one with `$skill-name` or
  browse with `/skills`.

To change an agent, a skill or a hook, edit the source under `.claude/` and
regenerate. `scripts/check-codex-port.sh` fails any PR where the two differ.

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

**Pinned versions:** Next.js 16.3.5 · React 19.3.0 · wasm-bindgen 0.2.127 · Bevy 0.18 *(wasm-bindgen must match Cargo.lock exactly)*

**Coverage thresholds (CI-enforced):** statements 85 · branches 77 · functions 80 · lines 86

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

`.claude/hooks/on-stop.sh` and `worktree-safety-commit.sh` run on Codex's `Stop` event once hooks are approved (see **Workflow** above); until then, run `bash .claude/hooks/on-stop.sh` yourself after completing work.

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
- **wasm-bindgen v0.2.127**: Must match Cargo.lock exactly
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

All hooks live in `.claude/hooks/` and are shared across Claude Code, Copilot, Gemini, Windsurf, and Codex. Under Codex they run through `.codex/hooks/run-claude-hook.mjs`, which translates Codex's hook payload into the shape these scripts read (Codex reports a file edit as `apply_patch` with the patch text and no `file_path`). The full list is in `.codex/hooks.json`; the ones you will notice:

| Script | Purpose | Codex event |
|--------|---------|-------------|
| `on-session-start.sh` | Install check + auto-start + GitHub pull + backlog | `SessionStart` |
| `on-prompt-submit.sh` | Ticket enforcement + stale reminders | `UserPromptSubmit` |
| `on-stop.sh` | Ticket validation + GitHub push | `Stop` |
| `post-edit-lint.sh` | ESLint on changed files | `PostToolUse` (`apply_patch`) |
| `block-main-commits.sh`, `check-pr-metadata.sh`, `pre-push-quality-gate.sh`, `block-deferred-fixes.sh` | Commit, PR and push policy | `PreToolUse` (`Bash`) |
| `sync-to-github.sh` | Push to GitHub Project | run by `on-stop.sh` |
| `sync-from-github.sh` | Pull from GitHub Project | run by `on-session-start.sh` |
