# SpawnForge — Gemini CLI & Antigravity Instructions

@AGENTS.md

- Check for the presence of AGENTS.md files in the project workspace
- There may be additional AGENTS.md in sub-folders with additional specific instructions related to that part of the codebase

## Hardline Rules (Non-Negotiable)

These rules are enforced across ALL AI tools. Violations break the shared workflow.

1. **No code without a ticket.** Check taskboard at http://localhost:3010 first. Create or pick a ticket, move to `in_progress`, then code.
2. **Worktree commit safety.** When in a git worktree, commit after every logical chunk (each test, feature, bug fix). Rate limits and crashes kill agents — uncommitted work is permanently lost.
3. **CI must pass.** All PRs require passing CI before merge. Never skip checks or force-merge. Fix failures in code.
4. **Zero ESLint warnings.** `npx eslint --max-warnings 0` is enforced in CI. Fix warnings immediately.
5. **Bridge isolation.** Only `engine/src/bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. `core/` is pure Rust.

## Setup

- Hooks: `.gemini/settings.json` (auto-start, sync, lint, ticket enforcement)
- Skills (Gemini CLI): `.agents/skills/` — kanban, sync-push, sync-pull
- Skills (Antigravity): `.agent/skills/` — kanban, sync-push, sync-pull
- Domain skills: `.claude/skills/` — rust-engine, frontend, mcp-commands, testing, docs, design
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

## Build & Test Commands

```bash
# WASM engine build
powershell -ExecutionPolicy Bypass -File build_wasm.ps1

# Web dev server
cd web && npm install && npm run dev

# Quick validation (run after every feature change)
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run

# MCP server tests
cd mcp-server && npx vitest run

# E2E tests (requires WASM build)
cd web && npx playwright test
```

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR to main:
- Lint (ESLint zero warnings), TypeScript check, Web tests (vitest), MCP tests
- WASM build (WebGL2 + WebGPU), Next.js production build
- E2E UI tests (Playwright), Security audit (npm audit + cargo audit)
- CodeQL analysis (JS/TS, Python, Rust, Actions)

## Hook Scripts (shared across all tools)

All hooks live in `.claude/hooks/`:

| Script | Purpose | Trigger |
|--------|---------|---------|
| `on-session-start.sh` | Auto-start taskboard + GitHub pull + backlog | Session start |
| `on-prompt-submit.sh` | Ticket enforcement gate + stale reminders | Before prompt |
| `on-stop.sh` | Worktree safety commit + GitHub push | After response |
| `post-edit-lint.sh` | ESLint on changed files | After file edit |
| `worktree-safety-commit.sh` | Auto-commit uncommitted work in worktrees | Called by on-stop |

## Domain Skills

Specialized development patterns in `.claude/skills/`:

| Skill | Use When |
|-------|----------|
| `rust-engine/SKILL.md` | Writing engine/ code (ECS, commands, bridge) |
| `frontend/SKILL.md` | Writing web/ code (React, Zustand, Tailwind) |
| `mcp-commands/SKILL.md` | Adding MCP commands or chat handlers |
| `testing/SKILL.md` | Writing tests, improving coverage |
| `docs/SKILL.md` | Updating documentation, README, known-limitations |
| `design/SKILL.md` | Designing features, architecture decisions |

Read the relevant skill file before working in that domain.

## Validation Tools

Runnable scripts in `.claude/tools/`:

```bash
bash .claude/tools/validate-rust.sh check      # After engine changes
bash .claude/tools/validate-frontend.sh quick   # After frontend changes
bash .claude/tools/validate-mcp.sh full         # After MCP changes
bash .claude/tools/validate-tests.sh coverage   # Test coverage report
bash .claude/tools/validate-docs.sh             # Documentation integrity
bash .claude/tools/validate-all.sh              # Run everything
```

## Detailed Reference

- `.claude/CLAUDE.md` — Full project constitution
- `.claude/rules/bevy-api.md` — Bevy 0.18 API patterns
- `.claude/rules/entity-snapshot.md` — ECS snapshot patterns
- `.claude/rules/web-quality.md` — ESLint & React patterns
- `.claude/rules/library-apis.md` — Third-party library APIs
- `.claude/rules/file-map.md` — Project file structure
