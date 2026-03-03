# SpawnForge — Windsurf Global Rules

## Project Overview

SpawnForge is an AI-native 2D/3D game engine for the browser. Architecture: React shell (Next.js 16) → Bevy engine (Rust/WASM) → WebGPU/WebGL2 rendering. All engine operations are JSON commands through `handle_command()`.

## Core Architecture ("The Sandwich")

```
React Shell (Next.js 16, Zustand, Tailwind)  <- Editor UI + AI chat
    |  JSON events via wasm-bindgen
Bevy Editor Engine (Rust -> WASM)             <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting           <- Playing user-created games
```

## Key Libraries

| Library | Version | Notes |
|---------|---------|-------|
| Bevy | 0.18 | wgpu 27, WebGPU primary |
| bevy_rapier3d/2d | 0.33 | `default-features=false` |
| bevy_hanabi | 0.18 | GPU particles, WebGPU only |
| transform-gizmo-bevy | 0.9 | Local fork at `.transform-gizmo-fork/` |
| bevy_panorbit_camera | 0.34 | `yaw`/`pitch`/`radius` |
| Zustand | 5.x | React state |
| Next.js | 16.x | React framework |
| Clerk | — | Authentication |

## Architecture Principles

- **Command-driven design**: Every engine operation is a JSON command. The UI, MCP server, and external agents all use the same `handle_command()` code path. Never create a UI-only shortcut that bypasses the command system.
- **Bridge isolation**: Only `engine/src/bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. `core/` is pure Rust, platform-agnostic.
- **Event-driven**: Bevy → bridge → JS callback → Zustand store → React re-render.
- **Store slices (Zustand)**: Each concern gets its own slice. Use selectors to prevent unnecessary re-renders. Do not prop-drill — consume stores directly.
- **wasm-bindgen version**: Must be 0.2.108 (pinned to match Cargo.lock).

## Build Commands

### WASM Engine (required for E2E tests)
```bash
# Full dual WASM build (WebGL2 + WebGPU):
powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```
- Produces 4 variants in `web/public/engine-pkg-*`
- Takes ~5-10 minutes
- Requires: Rust stable, wasm32-unknown-unknown target, wasm-bindgen-cli v0.2.108

### Web Frontend
```bash
cd web && npm install && npm run dev    # Dev (uses --webpack)
cd web && npm run build                 # Production build (Turbopack)
```

## Test Commands

### Quick validation (run after every feature change)
```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

### Full suite
```bash
cd web && npx eslint --max-warnings 0          # Lint (ZERO warnings)
cd web && npx tsc --noEmit                      # TypeScript
cd web && npx vitest run                        # Unit tests (2200+)
cd web && npx vitest run --coverage             # With coverage
cd mcp-server && npx vitest run                 # MCP server tests
cd web && npx playwright test                   # E2E (requires WASM build)
```

## Code Quality

**Zero tolerance for lint errors AND warnings.** CI runs `npx eslint --max-warnings 0`.

### TypeScript
- Strict mode. Never use `any` type. Avoid `as` casts — use Zod schemas.
- All chat handler arguments MUST be validated with Zod schemas.
- Use named exports. One component/function per file for React components.
- Prefer `const` over `let`. Never use `var`.
- `_` prefix for intentionally unused params.

### Rust
- Target: `wasm32-unknown-unknown`. Never use `std::fs`, `std::net`, or other non-WASM APIs.
- All `unsafe` blocks MUST have a `// SAFETY:` comment.
- Use `serde` with `serde_wasm_bindgen` for JS ↔ Rust serialization.
- Prefer `Result<T, E>` over panics.

### CSS/Styling
- Tailwind CSS for all styling. No inline styles or CSS modules.

## Security Rules

- All user/AI chat input passes through `sanitizeChatInput()`.
- Provider API keys encrypted with AES-256-GCM in `web/src/lib/encryption.ts`.
- All API routes must validate session via `api-auth.ts`.
- Never commit API keys, tokens, or credentials.

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml` for PRs, `cd.yml` for main):
- **lint**: ESLint zero warnings
- **typecheck**: `tsc --noEmit`
- **test-web**: Vitest with coverage
- **test-mcp**: MCP server tests
- **build-wasm**: Dual build (WebGL2 + WebGPU) + binary size check (35MB threshold)
- **build-nextjs**: Production build
- **test-e2e-ui**: Playwright UI-only tests
- **security**: cargo audit + npm audit
- **deploy**: Vercel (CD only, after all checks pass)

## Cargo Features

```toml
default = []
webgl2 = ["bevy/webgl2"]                    # WebGL2 backend
webgpu = ["bevy/webgpu", "dep:bevy_hanabi"] # WebGPU backend + GPU particles
runtime = []                                 # Strips editor-only systems for export
```

## Next.js Constraints

- **Import boundary:** Production builds CANNOT import outside `web/`.
- **MCP manifest dual location:** Source at `mcp-server/manifest/commands.json`, copy at `web/src/data/commands.json` — keep in sync.
- **Turbopack:** Dev uses `--webpack` flag. Build uses Turbopack (default).
- **Root layout force-dynamic:** Prevents prerender failures when Clerk keys are missing in CI.
