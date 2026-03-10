# SpawnForge — Copilot Instructions

## Project Overview

SpawnForge is a browser-based, AI-native 2D/3D game engine. It is a polyglot monorepo:

- **engine/** — Rust (Bevy 0.18) compiled to WebAssembly via wasm-bindgen. Pure game logic in `engine/src/core/`, JS interop bridge in `engine/src/bridge/`.
- **web/** — TypeScript/React (Next.js 16) editor frontend. State via Zustand store slices. Strict TypeScript, zero ESLint warnings.
- **mcp-server/** — TypeScript MCP server exposing engine commands as AI-callable tools via WebSocket.

## Build & Test Commands

```bash
# Web — install deps, lint, typecheck, unit tests (run from web/)
cd web && npm install  # use npm ci in CI environments
npx eslint --max-warnings 0 .
npx tsc --noEmit
npx vitest run

# MCP server tests (run from mcp-server/)
cd mcp-server && npm install
npx vitest run

# WASM engine build (requires Rust stable + wasm32-unknown-unknown target + wasm-bindgen-cli 0.2.108)
cd engine && cargo build --target wasm32-unknown-unknown --release --features webgl2
cd engine && cargo build --target wasm32-unknown-unknown --release --features webgpu
```

## Architecture Rules

- **Bridge isolation**: Only `engine/src/bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. `core/` is pure Rust.
- **Command-driven**: All engine operations go through `handle_command()` JSON commands. Never create UI-only shortcuts that bypass the command system.
- **Event-driven**: Bevy → bridge → JS callback → Zustand store → React re-render.
- **Store slices**: Each Zustand concern gets its own slice. Use selectors to prevent unnecessary re-renders.
- **WASM calls**: Only `web/src/hooks/useEngine.ts` may make direct WASM calls.

## Coding Standards

### Rust (engine/)
- Target: `wasm32-unknown-unknown`. Never use `std::fs`, `std::net`, or other non-WASM APIs.
- All `unsafe` blocks MUST have a `// SAFETY:` comment.
- Use `serde` with `serde_wasm_bindgen` for JS ↔ Rust serialization.
- Prefer `Result<T, E>` over panics. Feature flags: `webgl2` and `webgpu`.

### TypeScript (web/, mcp-server/)
- Strict mode. Never use `any`. Avoid `as` casts.
- All chat handler arguments MUST be validated before use (manual validation — Zod is not installed).
- Use named exports. Prefer `const` over `let`. Never use `var`.
- Tailwind CSS for all styling. No inline styles or CSS modules.

## MANDATORY: Taskboard-Driven Development

**No code changes without a ticket.** This is enforced by hooks on all AI tools.

Before writing ANY code:
1. Check the taskboard at http://localhost:3010 (API: http://localhost:3010/api)
2. Pick an existing ticket OR create a new one with ALL required fields
3. Move the ticket to `in_progress`

Required ticket fields: User Story, Description (20+ chars), Acceptance Criteria (3+ Given/When/Then scenarios), Priority, Team (Engineering: `01KK9751NZ4HM7VQM0AQ5WGME3`), Subtasks (3+).

Project ID: `01KK974VMNC16ZAW7MW1NH3T3M`

See `AGENTS.md` for full taskboard setup, workflow, and GitHub Project sync details.

### Sync Architecture (Non-Negotiable)
- `github_issue_number` (SQLite column) is the SOLE link between local tickets and GitHub Issues. NEVER match by title.
- `sync_repo` (SQLite column) controls which repo a ticket syncs to. Only `sync_repo = 'project-forge'` tickets are synced.
- The JSON map file is a cache. SQLite columns are authoritative.
- Tickets from other local projects are NEVER synced (they have `sync_repo = NULL`).

## Security

- All chat input passes through `sanitizeChatInput()` in `web/src/lib/chat/sanitizer.ts`. Never bypass.
- API keys encrypted with AES-256-GCM in `web/src/lib/encryption.ts`. Never log or expose.
- All API routes require auth via `web/src/lib/auth/api-auth.ts`.
- Never commit secrets. Use `.env.local` (gitignored).
- **Worktree safety:** When working in a git worktree, commit after every logical chunk of work. Agent processes can be terminated at any time — uncommitted work is permanently lost. The stop hook (`.claude/hooks/on-stop.sh`) auto-commits as a safety net, but agents MUST commit frequently themselves.

## CI/CD Enforcement

**All PRs must pass CI before merge.** Branch protection is enabled on `main`.

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR:
- Lint (ESLint zero warnings), TypeScript check, Web tests (vitest), MCP tests
- WASM build (WebGL2 + WebGPU), Next.js production build
- E2E UI tests (Playwright), Security audit (npm audit + cargo audit)
- CodeQL analysis (JS/TS, Python, Rust, Actions)

**Never skip CI checks.** If CI fails, fix the code — do not force-merge.

## Testing Patterns

- Web tests: `foo.ts` → `foo.test.ts` alongside source. Use `describe`/`it`/`expect`. Mock WASM bridge with `vi.mock()`.
- Store slice tests: Use `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`.
- MCP tests: Test command manifests, search, tool registration.

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR to main:
- Lint (ESLint), TypeScript check, Web tests (vitest), MCP tests, WASM build (WebGL2 + WebGPU), Next.js production build, E2E UI tests (Playwright), Security audit (npm audit + cargo audit).

## Hook Scripts (shared across all tools)

All hooks live in `.claude/hooks/` and are shared across all AI tools:

| Script | Purpose | Trigger |
|--------|---------|---------|
| `on-session-start.sh` | Auto-start taskboard + GitHub pull + backlog display | Session start |
| `on-prompt-submit.sh` | Ticket enforcement gate + stale reminders | Before prompt |
| `on-stop.sh` | Worktree safety commit + GitHub push | After response |
| `post-edit-lint.sh` | ESLint on changed files | After file edit |
| `worktree-safety-commit.sh` | Auto-commit uncommitted work in worktrees | Called by on-stop |

## Key File Locations

| Area | Path |
|------|------|
| Engine core | `engine/src/core/` |
| Engine bridge | `engine/src/bridge/` |
| Web pages/routes | `web/src/app/` |
| React components | `web/src/components/` |
| Zustand stores | `web/src/stores/` |
| Chat system | `web/src/lib/chat/` |
| Chat handlers | `web/src/lib/chat/handlers/` |
| WASM lifecycle | `web/src/hooks/useEngine.ts` |
| MCP server | `mcp-server/src/` |
| CI/CD | `.github/workflows/ci.yml` |
| Shared hooks | `.claude/hooks/` |
| Full constitution | `.claude/CLAUDE.md` |
| Cross-tool instructions | `AGENTS.md` |

## Detailed Reference

For full architecture rules, ECS patterns, and library APIs, see:
- `.claude/CLAUDE.md` — Full project constitution
- `.claude/rules/bevy-api.md` — Bevy 0.18 API patterns
- `.claude/rules/entity-snapshot.md` — ECS snapshot patterns
- `.claude/rules/web-quality.md` — ESLint & React patterns
- `.claude/rules/library-apis.md` — Third-party library APIs
- `.claude/rules/file-map.md` — Project file structure
