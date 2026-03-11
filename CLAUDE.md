# SpawnForge — Claude Code Instructions

## Project Overview

SpawnForge is an AI-native 2D/3D game engine for the browser. Architecture: React shell (Next.js) → Bevy engine (Rust/WASM) → WebGPU/WebGL2 rendering. All engine operations are JSON commands through `handle_command()`.

## Build Commands

### WASM Engine (required for E2E tests and dev server)
```bash
# From project root:
powershell -ExecutionPolicy Bypass -File build_wasm.ps1
```
- Produces 4 variants in `web/public/engine-pkg-*`
- Takes ~5-10 minutes
- Requires: Rust stable, wasm32-unknown-unknown target, wasm-bindgen-cli v0.2.108

### Web Frontend
```bash
cd web && npm install && npm run dev
```

## Test Commands

### Quick validation (run after every feature change)
```bash
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run
```

### Full suite
```bash
# Lint
cd web && npx eslint --max-warnings 0 .

# TypeScript
cd web && npx tsc --noEmit

# Unit tests (2211+)
cd web && npx vitest run

# Unit tests with coverage
cd web && npx vitest run --coverage

# MCP server tests
cd mcp-server && npx vitest run

# E2E tests (requires WASM build)
cd web && npx playwright test
```

## Key Architecture Rules

- **Bridge isolation**: Only `engine/src/bridge/` may import web_sys/js_sys/wasm_bindgen. `core/` is pure Rust.
- **Command-driven**: All engine ops go through `handle_command()` JSON commands.
- **Event-driven**: Bevy → bridge → JS callback → Zustand store → React re-render.
- **wasm-bindgen version**: Must be 0.2.108 (pinned to match Cargo.lock).

## Test Conventions

- Store slices: Use `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`
- Script worker tests: Stub `self` with mock `postMessage`, use `vi.resetModules()` + dynamic import
- Vitest config: `web/vitest.config.ts`, environment: node
- Playwright config: `web/playwright.config.ts`, 4 shards in CI

## Taskboard

- API: http://localhost:3010/api
- Project ID: 01KK974VMNC16ZAW7MW1NH3T3M
- Always create a ticket before starting work
