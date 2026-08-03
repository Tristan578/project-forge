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
| Node.js | 24 | [nodejs.org](https://nodejs.org/) |
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
taskboard start --port 3010
```

- Web UI: http://localhost:3010
- Project ID: `01KMM9ZA6SBZ7RKJZJTZS9VR4R`

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
13. `apps/docs/data/commands.json` — exact copy of #11 (kept in sync)
14. `TESTING.md` — manual test cases

The full checklist is in `.claude/CLAUDE.md` under "New Component / Command Checklist."

### Store slices

`editorStore.ts` is a composition root only. Domain state lives in `web/src/stores/slices/`. Never add inline state to `editorStore.ts` — the architecture validator will flag it if the file grows past 200 lines.

### MCP manifest sync

THREE copies of the manifest must stay byte-identical:

| Path | Role |
|------|------|
| `mcp-server/manifest/commands.json` | canonical source — edit this one |
| `web/src/data/commands.json` | copy for the `web/` deploy root |
| `apps/docs/data/commands.json` | copy for the `apps/docs/` deploy root |

A Next.js build cannot import above its Vercel `rootDirectory`, so each deploy root needs its own copy — `apps/docs` deploys with `rootDirectory: apps/docs`, and anything above that path resolves locally but is absent on Vercel. After editing the source, copy it to BOTH destinations:

```bash
cp mcp-server/manifest/commands.json web/src/data/commands.json
cp mcp-server/manifest/commands.json apps/docs/data/commands.json
```

Verify with `bash .claude/tools/validate-mcp.sh sync`. `apps/docs/scripts/check-manifest-sync.ts` enforces this in CI against both copies.

---

## Architecture Validator

The arch validator catches structural violations before code review:

```bash
python .claude/skills/arch-validator/check_arch.py           # warnings
python .claude/skills/arch-validator/check_arch.py --strict   # exit 1 on any violation
```

It enforces 7 rules: bridge isolation, Rust file size (800 lines), TypeScript file size (500 lines), command dispatch delegation, pending module structure, store composition size, and event delegation size.

---

## Maintaining onboarding facts (maintainers)

Onboarding facts — the taskboard project/team IDs, the taskboard start command,
the coverage thresholds, the pinned tool versions — appear in *many*
contributor-facing files so that a contributor on **any** assistant (Claude,
Codex, Gemini, Copilot, Cursor, Windsurf, Antigravity) gets the same answer. When
one of those facts changes (most often: the taskboard IDs get rotated, or the
board's start command changes), update it in this order so the two CI gates stay
green and no surface drifts.

### 1. Edit the canonical source

`tools/agentic-sync/canonical.json` is the single source of truth for the synced
facts. Change the value there — e.g. under `facts.taskboard` (`projectId`, the
`teams` map, `startCommand`, `apiBaseUrl`) or `facts.coverageThresholds`.

> The taskboard has exactly two teams — **Engineering** and **PM**. There is no
> "Leadership" team; never reintroduce one.

### 2. Regenerate the synced targets

```bash
node tools/agentic-sync/sync.mjs --write
```

This rewrites the marker-delimited `<!-- AGENTIC-SYNC:START -->…END -->` block in
the **four** generated targets — `AGENTS.md`, `.github/copilot-instructions.md`,
`.codex/AGENTS.md`, and `.cursorrules` — from `canonical.json`. Never hand-edit
the text *inside* those markers; the generator owns it and CI re-checks it
(`node tools/agentic-sync/sync.mjs --check`).

### 3. Hand-update the surfaces the generator can't reach

The generator only manages the marker block in those four files. The same fact
embedded **outside** a marker block — inline in a `curl` example, a markdown table
row, a code fence, or a non-target provider file — must be grep-replaced by hand:

```bash
# Find every place the OLD id / command still appears, then fix each:
grep -rnI --exclude-dir=.git --exclude-dir=node_modules '<OLD_VALUE>' .
```

Typical hand-edit homes (the project ID in particular recurs in `curl` examples):

- Provider rule/skill dirs: `.windsurf/`, `.agent/`, `.agents/`,
  `.github/instructions/`, `.github/skills/` (e.g. `kanban/SKILL.md`),
  `.codex/skills/` (e.g. `kanban/SKILL.md`), and `.claude/` skills/rules.
- Repo docs: `README.md`, this file (`CONTRIBUTING.md`), and `docs/`.

> **`GEMINI.md` needs no hand-edit for the synced facts.** It pulls them in with
> an `@AGENTS.md` import directive rather than copying them, so regenerating
> `AGENTS.md` in step 2 propagates to Gemini automatically. That import is exactly
> why `GEMINI.md` is *not* a fifth `sync.mjs` target — there is nothing inside it
> to keep in sync. Only hand-edit `GEMINI.md` if you change its prose pointers.

### 4. Let the gates catch what you missed

Two required CI gates enforce this so a missed surface fails the PR instead of
silently onboarding the next contributor against a broken board:

- **`agentic-sync`** — re-runs `sync.mjs --check`; fails if any of the four
  generated targets drifts from `canonical.json`. Fix: re-run step 2 and commit.
- **`taskboard-onboarding-guard`** (`scripts/check-taskboard-onboarding-hygiene.sh`)
  — greps the **whole tree** and fails on a known-dead taskboard ULID *or* a
  taskboard start command carrying the forbidden `--db` flag (which points the
  board at a throwaway local `.claude/taskboard.db` copy and shows zero tickets —
  always use `taskboard start --port 3010`, letting it use the OS-default DB
  path). Both gates are wired into the required **CI Success** aggregate.

### Allowlisted homes for retired IDs

A retired ID may legitimately survive in exactly two places, and nowhere else:

1. `docs/reviews/2026-06-02-agentic-toolkit-parity-review.md` — the parity review
   that documents the rotation, quoting the dead IDs as its finding.
2. `legacyProjectIds` in `.claude/hooks/github-sync-config.json` — the
   intentional old→new project-id mapping. Only a dead **project** id is allowed
   there; a dead **team** id has no legacy home and still trips the guard.

---

## Deeper Reference

| Document | Contents |
|----------|----------|
| [README.md](README.md) | Feature overview, project structure, tech stack |
| [TESTING.md](TESTING.md) | Manual test cases for all shipped features |
| [.claude/CLAUDE.md](.claude/CLAUDE.md) | Full project constitution: architecture rules, workflow rules, phase roadmap, component checklist |
| [.claude/SANDBOX.md](.claude/SANDBOX.md) | Agent permission posture: what is auto-approved, the two off-limits config files (and why), how a human changes them |
| [.claude/rules/bevy-api.md](.claude/rules/bevy-api.md) | Bevy 0.18 API patterns, 0.16→0.18 migration notes |
| [.claude/rules/entity-snapshot.md](.claude/rules/entity-snapshot.md) | EntityType, EntitySnapshot, history system |
| [.claude/rules/web-quality.md](.claude/rules/web-quality.md) | ESLint rules, React patterns, Next.js constraints |
| [.claude/rules/library-apis.md](.claude/rules/library-apis.md) | csgrs, noise, serde-wasm-bindgen, terrain, texture pipeline |
| [.claude/rules/file-map.md](.claude/rules/file-map.md) | Detailed file structure for engine and web layers |
| [docs/](docs/) | User-facing feature guides and API reference |
