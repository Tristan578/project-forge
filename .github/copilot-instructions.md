# SpawnForge — Copilot Instructions

## Project Overview

SpawnForge is a browser-based, AI-native 2D/3D game engine. It is a polyglot monorepo:

- **engine/** — Rust (Bevy 0.16) compiled to WebAssembly via wasm-bindgen. Pure game logic in `engine/src/core/`, JS interop bridge in `engine/src/bridge/`.
- **web/** — TypeScript/React (Next.js 16) editor frontend. State via Zustand store slices. Strict TypeScript, zero ESLint warnings.
- **mcp-server/** — TypeScript MCP server exposing engine commands as AI-callable tools via WebSocket.

## Build & Test Commands

Always run `npm ci` (not `npm install`) in CI contexts. Use `npm install` only for local development.

```bash
# Web — lint, typecheck, unit tests (run from web/)
cd web && npm install
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
- Strict mode. Never use `any`. Avoid `as` casts — use Zod schemas for runtime validation.
- All chat handler arguments MUST be validated with Zod schemas before use.
- Use named exports. Prefer `const` over `let`. Never use `var`.
- Tailwind CSS for all styling. No inline styles or CSS modules.

## Security

- All chat input passes through `sanitizeChatInput()` in `web/src/lib/chat/sanitizer.ts`. Never bypass.
- API keys encrypted with AES-256-GCM in `web/src/lib/encryption.ts`. Never log or expose.
- All API routes require auth via `web/src/lib/auth/api-auth.ts`.
- Never commit secrets. Use `.env.local` (gitignored).

## Testing Patterns

- Web tests: `foo.ts` → `foo.test.ts` alongside source. Use `describe`/`it`/`expect`. Mock WASM bridge with `vi.mock()`.
- Store slice tests: Use `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`.
- MCP tests: Test command manifests, search, tool registration.

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every PR to main:
- Lint (ESLint), TypeScript check, Web tests (vitest), MCP tests, WASM build (WebGL2 + WebGPU), Next.js production build, E2E UI tests (Playwright), Security audit (npm audit + cargo audit).

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
