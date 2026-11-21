# SpawnForge Constitution

<!-- Compact: When summarizing context, preserve: architecture, cargo features, workflow rules, code quality. Drop: library version details, rendering strategy details. -->

## Product Vision

AI-powered "Canva for games" — web-based 2D/3D game creation via natural language or manual editing. Browser-compiled games. Subscription SaaS (Stripe).

## Core Architecture ("The Sandwich")

```
React Shell (Next.js 16, Zustand, Tailwind)  <- Editor UI + AI chat
    |  JSON events via wasm-bindgen
Bevy Editor Engine (Rust -> WASM)             <- Scene editing, rendering
    |
Game Runtime + TypeScript Scripting           <- Playing user-created games
```

## Rendering Strategy

- **Primary: WebGPU** (Bevy 0.18, wgpu 27) — auto-detected via `navigator.gpu`
- **Fallback: WebGL2** — for browsers without WebGPU
- **4 binaries**: 2 editor + 2 runtime (WebGPU/WebGL2), JS auto-selects at runtime
- **MUST include `tonemapping_luts`** Bevy feature — without it, materials render pink/magenta

## Build Rules

Commands live in the root `CLAUDE.md` → Build Commands / Test Commands.

- Do NOT use `cargo check`/`cargo build` without `--target wasm32-unknown-unknown`
- **neon-http:** `db.transaction()` throws. Use `getNeonSql()` -> `neonSql.transaction([...statements])`
- **Server Component auth:** Use `safeAuth()` from `@/lib/auth/safe-auth.ts`, not `auth()` directly

## Cargo Features

Declared in `engine/Cargo.toml` (`webgl2`, `webgpu`, `runtime`; `default = []`). What is NOT in that file:

- `runtime`: gates via `#[cfg(not(feature = "runtime"))]` on system *registrations*, NOT function definitions
- `webgpu`: gates `bevy_hanabi` GPU rendering. Data types always compiled

## Workflow Rules

1. **Spec-First:** Never implement without an approved spec in `specs/`
2. **Test-First:** Never write logic without a failing test case
3. **Bridge Isolation:** Only `bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`
4. **Taskboard-Driven:** ALL work tracked on taskboard. Use `/kanban` skill.
5. **Worktree Commit Safety:** Commit after every logical chunk. Uncommitted work is permanently lost.
6. **Keep Context Current:** Update `.claude/rules/` and `MEMORY.md` as part of every iteration

## Code Quality

**Zero tolerance for lint errors AND warnings.** See `.claude/rules/web-quality.md` for details.

Key: `_` prefix for unused params, no `useRef.current` during render, no blanket `eslint-disable`, keep `mcp-server/manifest/commands.json` synced to BOTH copies (`web/src/data/commands.json` and `apps/docs/data/commands.json` — one per deploy root).

## On-Demand Skills (invoke when needed)

- `/component-checklist` — Files to update when adding new ECS components/commands
- `/review-protocol` — 5 specialized reviewers, agent inventory, dispatch rules
- `/claude-platform-reference` — Skills inventory, hooks, MCP servers, validation tools

## Detailed Reference (in `.claude/rules/`)

| File | Contents |
|------|----------|
| `rules/bevy-api.md` | Bevy 0.18 API, 0.16->0.18 migration, ECS limits, library APIs |
| `rules/entity-snapshot.md` | EntityType, EntitySnapshot, history, selection events |
| `rules/web-quality.md` | ESLint rules, React patterns, Next.js constraints |
| `rules/library-apis.md` | csgrs, noise, terrain, texture pipeline, particles |
| `rules/file-map.md` | Engine + web structure, communication pattern |
| `rules/gotchas.md` | Index of the four gotchas files below (always loaded; the bodies are not) |
| `rules/gotchas-build-ci.md` | Build/CI, lockfiles, self-defense gates, npm audit, RSC boundary, bundle size |
| `rules/gotchas-web.md` | Database, API & security, WASM/CDN, UI & frontend |
| `rules/gotchas-engine.md` | Engine & game loop: command wire, route_domain, component carry, physics |
| `rules/gotchas-ops.md` | Claude Code config, deploy/service infrastructure, enforcement hooks |
| `rules/agent-operations.md` | Agent SOPs, testing, committing, PR creation |
| `rules/hook-testing.md` | Conventions for the bash suites under `.claude/hooks/__tests__/` |

Every file except `gotchas.md` carries `paths:` frontmatter and loads only in sessions that
touch its area; `Read` one directly if you need it outside those paths.
