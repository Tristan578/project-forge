# Contributing to SpawnForge

This document is the single reference for new contributors. Reading time: ~15 minutes.

Resolves: PF-420

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | stable | [rustup.rs](https://rustup.rs/) |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| wasm-bindgen-cli | **0.2.108 exactly** | `cargo install wasm-bindgen-cli --version 0.2.108` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| Bash or PowerShell | — | macOS/Linux have Bash; Windows uses PowerShell |

The wasm-bindgen-cli version is pinned and must match `Cargo.lock`. Using a different version will produce a binary mismatch error at runtime.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Tristan578/project-forge.git
cd project-forge

# 2. Install web dependencies
cd web && npm install && cd ..

# 3. Build the WASM engine (skip if only touching web code)
./build_wasm.sh        # macOS / Linux
.\build_wasm.ps1       # Windows (PowerShell)
# Takes 5-10 minutes; produces 4 variants in web/public/engine-pkg-*

# 4. Start the dev server
cd web && npm run dev

# 5. Open the editor (no auth required in dev mode)
open http://localhost:3000/dev
```

For web-only changes (TypeScript, React), you can skip step 3 — the editor will still load using the WASM binaries already in `web/public/` (committed to the repo for development convenience).

---

## Architecture Overview: The Sandwich

```
MCP Server (322 commands, 37 categories)
    | JSON commands
React Shell (Next.js 16, Zustand, Tailwind)   <- Editor UI + AI chat
    | JSON events via wasm-bindgen
Bevy Engine (Rust -> WebAssembly)              <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting            <- In-browser game execution
```

Three rules flow from this architecture:

1. **Bridge isolation.** Only `engine/src/bridge/` may import `web_sys`, `js_sys`, or `wasm_bindgen`. The `engine/src/core/` module is pure Rust with zero browser dependencies. Violating this will break non-WASM builds and is caught by `check_arch.py`.

2. **Command-driven.** Every engine operation is a JSON command dispatched through `handle_command()`. The React editor and MCP server share the exact same command interface — there is no separate "AI API." Adding a feature means adding a command.

3. **Event-driven state.** Bevy systems emit events through the bridge. JS receives them via a callback, routes them through `useEngineEvents`, and they propagate to Zustand stores, which trigger React re-renders. Rust never touches the DOM.

**Rendering:** WebGPU is the primary renderer (auto-detected via `navigator.gpu`); WebGL2 is the fallback. Two WASM binaries are built per release — the frontend selects the correct one at runtime in `useEngine.ts`.

---

## Development Workflow

### 1. Get a ticket

All work requires a ticket before any code is written. The taskboard is the single source of truth.

```bash
# Start the taskboard server (auto-started by Claude Code hooks)
taskboard start --port 3010 --db .claude/taskboard.db
```

- Web UI: http://localhost:3010
- Project ID: `01KK974VMNC16ZAW7MW1NH3T3M`

Pick an existing ticket or create one. Every ticket requires a user story, acceptance criteria (Given/When/Then), priority, and team assignment. See `.claude/CLAUDE.md` for the full ticket template.

### 2. Create a branch

```
feat/pf-NNN-short-description    # new feature
fix/pf-NNN-short-description     # bug fix
test/pf-NNN-short-description    # tests only
docs/pf-NNN-short-description    # documentation only
refactor/pf-NNN-short-description
```

Example: `feat/pf-420-contributing-guide`

### 3. Write code

- Rust: all code must compile for `wasm32-unknown-unknown`. Use `cargo check --target wasm32-unknown-unknown` (not bare `cargo check`).
- TypeScript: functional React components with hooks, strict mode enabled.
- Follow the conventions in the **Code Quality** section below.

### 4. Validate before pushing

```bash
# Quick (run after every change)
cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit && npx vitest run

# Full suite
cd web && npx eslint --max-warnings 0 .
cd web && npx tsc --noEmit
cd web && npx vitest run
cd ../mcp-server && npx vitest run
python .claude/skills/arch-validator/check_arch.py
```

E2E tests require the WASM build:
```bash
cd web && npx playwright test
```

### 5. Open a pull request

```bash
git push origin feat/pf-NNN-short-description
gh pr create --title "feat: short description (PF-NNN)"
```

Include a summary of what changed, how to test it, and screenshots for visual changes. Reference the ticket number in the PR body.

---

## Testing

| Test type | Command | Count |
|-----------|---------|-------|
| Unit (web) | `cd web && npx vitest run` | 4700+ |
| Unit (MCP) | `cd mcp-server && npx vitest run` | 25+ |
| E2E | `cd web && npx playwright test` | 81 |
| Manual | See [TESTING.md](TESTING.md) | checklist |

**Writing new tests:**

- Store slices: use the `sliceTestTemplate.ts` pattern with `createSliceStore()` and `createMockDispatch()`. See `web/src/stores/slices/__tests__/` for examples.
- Script worker tests: stub `self` with a mock `postMessage`, use `vi.resetModules()` + dynamic import to reload the worker module.
- Mock paths: always use `@/lib/...` aliases in `vi.mock()`, never relative paths from `__tests__/` directories.
- New user-facing features must add cases to `TESTING.md`.

---

## Code Quality

### Zero-warning ESLint

CI enforces `npx eslint --max-warnings 0`. There is no warning budget — every warning must be fixed.

Key rules:
- **Unused variables:** prefix with `_` (e.g., `_unusedParam`). Never delete a required parameter just to suppress the warning.
- **Unused imports:** remove them.
- **Missing effect deps:** add them; wrap unstable handler references in `useCallback`.
- **No `useRef.current` during render:** use the `useState` prev-value pattern instead.
- **No `Date.now()` / `Math.random()` during render:** move to `useEffect` or `useMemo`.
- **Never add a blanket `eslint-disable`** at file level. Use `eslint-disable-next-line` on the specific line only.

### TypeScript

Strict mode is enabled. No `any` types without justification. No `.unwrap()`-style non-null assertions in production paths — handle the `undefined` case explicitly.

### Rust

- Use Rust stable. The `nightly` toolchain is not required.
- No `.unwrap()` or `.expect()` in non-test code — use `?`, `if let`, or `match`.
- All code must compile with `--target wasm32-unknown-unknown`.
- Run `cargo check --target wasm32-unknown-unknown` after every significant edit, not `cargo check` alone.
- Follow standard `rustfmt` formatting.

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) format:
```
feat: add shadow distance slider to quality preset inspector (PF-NNN)
fix: prevent camera despawn on bulk entity delete (PF-NNN)
docs: add contributing guide (PF-420)
```

---

## Key Conventions

### Adding a new engine component

Adding a new ECS component touches files across the full stack. The minimum required changes are:

**Rust (4 files):**
1. `engine/src/core/<component>.rs` — component struct + `pub mod` in `core/mod.rs`
2. `engine/src/core/pending/<domain>.rs` — request struct + queue method
3. `engine/src/core/commands/<domain>.rs` — dispatch entry + handler
4. `engine/src/bridge/<domain>.rs` — apply system + selection emit

**Web (4 files):**
5. `web/src/stores/slices/<domain>Slice.ts` — state + actions
6. `web/src/hooks/events/<domain>Events.ts` — event handler
7. `web/src/lib/chat/handlers/<domain>Handlers.ts` — tool call handler
8. `web/src/components/editor/<Inspector>.tsx` — inspector panel

**Integration (5 files):**
9. `web/src/components/editor/InspectorPanel.tsx` — import + render
10. `web/src/components/chat/ToolCallCard.tsx` — display label
11. `mcp-server/manifest/commands.json` — MCP commands
12. `web/src/data/commands.json` — exact copy of #11 (kept in sync)
13. `TESTING.md` — manual test cases

The full checklist is in `.claude/CLAUDE.md` under "New Component / Command Checklist."

### Store slices

`editorStore.ts` is a composition root only. Domain state lives in `web/src/stores/slices/`. Never add inline state to `editorStore.ts` — the architecture validator will flag it if the file grows past 200 lines.

### MCP manifest sync

`mcp-server/manifest/commands.json` and `web/src/data/commands.json` must stay identical. The Next.js build cannot import outside `web/`, so the manifest is copied. After editing either file, copy to the other.

---

## Architecture Validator

The arch validator catches structural violations before code review:

```bash
python .claude/skills/arch-validator/check_arch.py           # warnings
python .claude/skills/arch-validator/check_arch.py --strict   # exit 1 on any violation
```

It enforces 7 rules: bridge isolation, Rust file size (800 lines), TypeScript file size (500 lines), command dispatch delegation, pending module structure, store composition size, and event delegation size.

---

## Deeper Reference

| Document | Contents |
|----------|----------|
| [README.md](README.md) | Feature overview, project structure, tech stack |
| [TESTING.md](TESTING.md) | Manual test cases for all shipped features |
| [.claude/CLAUDE.md](.claude/CLAUDE.md) | Full project constitution: architecture rules, workflow rules, phase roadmap, component checklist |
| [.claude/rules/bevy-api.md](.claude/rules/bevy-api.md) | Bevy 0.18 API patterns, 0.16→0.18 migration notes |
| [.claude/rules/entity-snapshot.md](.claude/rules/entity-snapshot.md) | EntityType, EntitySnapshot, history system |
| [.claude/rules/web-quality.md](.claude/rules/web-quality.md) | ESLint rules, React patterns, Next.js constraints |
| [.claude/rules/library-apis.md](.claude/rules/library-apis.md) | csgrs, noise, serde-wasm-bindgen, terrain, texture pipeline |
| [.claude/rules/file-map.md](.claude/rules/file-map.md) | Detailed file structure for engine and web layers |
| [docs/](docs/) | User-facing feature guides and API reference |
