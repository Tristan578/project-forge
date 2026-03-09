# SpawnForge — Gemini CLI Project Rules

## Hardline Rules (Non-Negotiable)

These rules are enforced across ALL AI tools. Violations break the shared workflow.

1. **No code without a ticket.** Check taskboard at http://localhost:3010 first. Create or pick a ticket, move to `in_progress`, then code. See `taskboard-sync.md` for full details.
2. **Worktree commit safety.** When in a git worktree, commit after every logical chunk (each test, feature, bug fix). Rate limits and crashes kill agents — uncommitted work is permanently lost. Never accumulate large uncommitted changesets.
3. **CI must pass.** All PRs require passing CI before merge. Never skip checks or force-merge. Fix failures in code.
4. **Zero ESLint warnings.** `npx eslint --max-warnings 0` is enforced in CI. Fix warnings immediately.
5. **Bridge isolation.** Only `engine/src/bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. `core/` is pure Rust.

## Hook Scripts (Auto-Executed)

Hooks in `.gemini/settings.json` auto-execute:
- **SessionStart**: Starts taskboard, pulls GitHub sync, displays backlog
- **UserPromptSubmit**: Ticket enforcement gate
- **Stop**: Worktree safety commit + GitHub push
- **PostToolUse (Edit/Write)**: ESLint on changed files

## Project Overview

SpawnForge is an AI-native 2D/3D game engine for the browser.

```
React Shell (Next.js 16, Zustand, Tailwind)  <- Editor UI + AI chat
    |  JSON events via wasm-bindgen
Bevy Editor Engine (Rust -> WASM)             <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting           <- Playing user-created games
```

## Architecture Rules

- **Command-driven**: All engine ops go through `handle_command()` JSON commands. Never create UI-only shortcuts that bypass the command system.
- **Event-driven**: Bevy -> bridge -> JS callback -> Zustand store -> React re-render.
- **Store slices**: Each Zustand concern gets its own slice. Use selectors.
- **WASM calls**: Only `web/src/hooks/useEngine.ts` may make direct WASM calls.
- **wasm-bindgen v0.2.108**: Must match Cargo.lock exactly.

## Build & Test Commands

```bash
# WASM engine build (WebGL2 + WebGPU)
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

## Coding Standards

### TypeScript (web/, mcp-server/)
- Strict mode. Never use `any`. Avoid `as` casts.
- Use named exports. Prefer `const` over `let`. Never use `var`.
- `_` prefix for intentionally unused params.
- Tailwind CSS for all styling. No inline styles or CSS modules.

### Rust (engine/)
- Target: `wasm32-unknown-unknown`. Never use `std::fs`, `std::net`, or other non-WASM APIs.
- All `unsafe` blocks MUST have a `// SAFETY:` comment.
- Use `serde` with `serde_wasm_bindgen` for JS <-> Rust serialization.
- Prefer `Result<T, E>` over panics.

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR to main:
- Lint (ESLint zero warnings), TypeScript check, Web tests (vitest), MCP tests
- WASM build (WebGL2 + WebGPU), Next.js production build
- E2E UI tests (Playwright), Security audit (npm audit + cargo audit)
- CodeQL analysis (JS/TS, Python, Rust, Actions)

## Security

- All chat input passes through `sanitizeChatInput()` in `web/src/lib/chat/sanitizer.ts`
- API keys encrypted with AES-256-GCM in `web/src/lib/encryption.ts`
- All API routes require auth via `web/src/lib/auth/api-auth.ts`
- Never commit secrets. Use `.env.local` (gitignored)

## Detailed Reference

- `.claude/CLAUDE.md` — Full project constitution
- `.claude/rules/bevy-api.md` — Bevy 0.18 API patterns
- `.claude/rules/entity-snapshot.md` — ECS snapshot patterns
- `.claude/rules/web-quality.md` — ESLint & React patterns
- `.claude/rules/library-apis.md` — Third-party library APIs
- `.claude/rules/file-map.md` — Project file structure
- `AGENTS.md` — Cross-tool instructions (taskboard, sync, hooks)
