# SpawnForge Constitution

## Product Vision

AI-powered "Canva for games" — web-based platform for creating 2D/3D games via natural language (Claude API) or manual editing. Games compile and run in browser. Subscription SaaS (Stripe).

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
- **Two editor binaries** + **two runtime binaries** (via `runtime` feature) in `web/public/`
- **JS auto-selects** at runtime (`useEngine.ts`)
- **MUST include `tonemapping_luts` Bevy feature** — without it, materials render pink/magenta

## Key Libraries

| Library | Version | Notes |
|---------|---------|-------|
| Bevy | 0.18 | wgpu 27, WebGPU primary |
| bevy_rapier3d | 0.33 | `default-features=false`, features: `dim3`, `async-collider`, `debug-render-3d` |
| bevy_rapier2d | 0.33 | `default-features=false`, features: `dim2`, `debug-render-2d` |
| bevy_hanabi | 0.18 | GPU particles, WebGPU only (`webgpu` feature) |
| transform-gizmo-bevy | 0.9 (local fork) | Path dep at `.transform-gizmo-fork/`, patched for Bevy 0.18 |
| bevy_panorbit_camera | 0.34 | `yaw`/`pitch`/`radius` |
| csgrs | 0.20 | CSG booleans via BSP |
| noise | 0.9 | Procedural noise for terrain |
| Zustand | 5.x | React state |
| Next.js | 16.x | React framework |
| Clerk | — | Authentication |

## Build Commands

```powershell
# Full dual WASM build (WebGL2 + WebGPU):
powershell.exe -File ".\build_wasm.ps1"
```

```bash
cd web && npm run dev                    # Dev server (--webpack, NOT Turbopack)
cd web && npm run build                  # Production build
cd web && npx eslint --max-warnings 0    # Lint (ZERO warnings enforced)
```

### Verification Suite (run after every phase)
```bash
powershell.exe -File ".\build_wasm.ps1"             # WASM build
cd web && npx eslint --max-warnings 0                # Lint
cd web && npx tsc --noEmit                           # TypeScript
cd web && npx vitest run                             # Web tests
cd mcp-server && npx vitest run                      # MCP tests
python .claude/skills/arch-validator/check_arch.py   # Arch validator
```

- Do NOT use native `cargo check`/`cargo build` without `--target wasm32-unknown-unknown`
- Local testing without DB: use `http://localhost:3000/dev` (bypasses auth)

## Cargo Features

```toml
default = []
webgl2 = ["bevy/webgl2"]                    # WebGL2 backend
webgpu = ["bevy/webgpu", "dep:bevy_hanabi"] # WebGPU backend + GPU particles
runtime = []                                 # Strips editor-only systems for export
```

- `runtime`: gates via `#[cfg(not(feature = "runtime"))]` on system *registrations* in `bridge/mod.rs`, NOT function definitions
- `webgpu`: gates `bevy_hanabi` GPU rendering. Data types always compiled

## Workflow Rules

1. **Spec-First:** Never write implementation code without an approved spec in `specs/`
2. **Test-First:** Never write logic without a failing test case
3. **No Direct DOM:** Rust sends events to React via the bridge — never touches DOM
4. **Bridge Isolation:** Only `bridge/` may import `web_sys`/`js_sys`/`wasm_bindgen`. `core/` is platform-agnostic
5. **AI-Friendly Commands:** All capabilities expressible as JSON via `handle_command()`
6. **Update TESTING.md:** Add test cases for new user-facing features
7. **Update README.md:** When completing phases, adding MCP commands, changing build process, adding libraries
8. **Keep Context Current:** Update `.claude/rules/` and `MEMORY.md` as part of every iteration:
   - **New pitfall discovered?** Add to the relevant `rules/*.md` file immediately — don't wait
   - **Phase completed?** Update the Phase Roadmap table in this file
   - **MCP commands changed?** Update count in `MEMORY.md` "Current Stats"
   - **New library or API pattern?** Add to `rules/library-apis.md` or `rules/bevy-api.md`
   - **New EntitySnapshot field or EntityType variant?** Update `rules/entity-snapshot.md`
   - **New file or structural change?** Update `rules/file-map.md`
   - **Unsure if a pattern is stable?** Log in `MEMORY.md` "Session Learnings" first, promote to rules after confirmation
9. **Taskboard-Driven:** ALL work MUST be tracked on the taskboard (MCP server: `taskboard`). See Taskboard Rules below.
10. **Worktree Commit Safety:** When working in a git worktree (subagents, feature branches), **commit after every logical chunk of work** (each test file, each feature, each bug fix). Rate limits and crashes can kill agents at any time — uncommitted work is permanently lost. Never accumulate large uncommitted changesets.

## Taskboard Rules

The taskboard is the **single source of truth** for all project work. It is an MCP server connected to Claude Code.

### Mandatory Process
1. **No work without a ticket.** Before writing ANY code, a ticket MUST exist on the taskboard.
2. **Tickets move through columns:** `todo` → `in_progress` → `done`. Move tickets as work progresses.
3. **Every ticket MUST have:**
   - A **user story** in standard format: `As a [persona], I want [goal] so that [benefit]`
   - A **description** with technical context, spec references, and scope
   - **Acceptance Criteria** in Given/When/Then (GWT) format for testability
   - **Priority** (urgent, high, medium, low)
   - **Labels** for categorization (e.g., `bug`, `feature`, `refactor`, `test`, `docs`)
4. **Subtasks** for complex tickets — break into verifiable implementation steps.
5. **Projects** group related tickets (use for epics/initiatives, NOT individual tickets).

### Ticket Template

```
Title: [concise imperative action, e.g., "Fix detectPromptInjection return type mismatch"]

User Story:
As a [developer/user/admin], I want [specific goal] so that [measurable benefit].

Description:
[Technical context, affected files, root cause analysis, spec reference if applicable]

Acceptance Criteria:
- Given [precondition], When [action], Then [expected result]
- Given [precondition], When [action], Then [expected result]
- ...

Priority: [urgent/high/medium/low]
Labels: [bug/feature/refactor/test/docs]
```

### MCP Tools Available
| Tool | Usage |
|------|-------|
| `create_project` | Create epic/initiative |
| `create_ticket` | Create work item with title, description, priority, labels |
| `move_ticket` | Transition: todo → in_progress → done |
| `update_ticket` | Edit title, description, priority, labels, due date |
| `create_subtask` / `batch_create_subtasks` | Break ticket into steps |
| `toggle_subtask` | Mark subtask complete |
| `get_board` | View full Kanban board |
| `list_tickets` | Filter tickets by status/project |

### Web UI
Taskboard web UI: `http://localhost:3010` (start with: `taskboard start --db .claude/taskboard.db`)

### Rules for Claude
- **Before starting work:** Check the board (`get_board`), pick a ticket, move to `in_progress`
- **After completing work:** Move ticket to `done`, verify acceptance criteria met
- **Discovering new work:** Create a ticket FIRST, then do the work
- **Bug found during development:** Create a bug ticket with reproduction steps in GWT format

## Code Quality (Brief)

**Zero tolerance for lint errors AND warnings.** See `.claude/rules/web-quality.md` for full ESLint rules and React patterns.

Key rules:
- `_` prefix for intentionally unused params
- No `useRef.current` during render (use `useState` prev-value pattern)
- No `Date.now()`/`Math.random()` during render
- Never blanket `eslint-disable` — use `eslint-disable-next-line` only
- Next.js cannot import outside `web/`. Keep `mcp-server/manifest/commands.json` synced to `web/src/data/commands.json`

## Phase Roadmap

| Phase | Name | Status |
|-------|------|--------|
| 1-2 | Foundation | DONE |
| 3 | Rendering & Materials | DONE |
| 4-A | MCP Server (143 commands) | DONE |
| 4-B | AI Chat Panel | deferred |
| 5-A | Play/Edit Mode | DONE |
| 5-B | Input System | DONE |
| 5-C | Physics | DONE |
| 6 | Save/Load | DONE |
| 7 | Asset Pipeline | DONE |
| 8 | Game Scripting | DONE |
| 9 | Audio | DONE |
| 10 | Export | DONE |
| 11 | Platform & Payments | DONE |
| B | Post-Processing | DONE |
| A | Audio Mixer | DONE |
| C | GPU Particles | DONE |
| D-1 | Skeletal Animation | DONE |
| F-1 | Extended Primitives | DONE |
| E-1 | Extended Materials | DONE |
| A-3 | Audio Layering | DONE |
| E-2 | Custom Shader Library | DONE |
| F-2 | CSG Boolean Ops | DONE |
| F-3 | Procedural Terrain | DONE |
| F-4 | Procedural Mesh Gen | DONE |
| D-4 | Animation Blending | DONE |
| G-1 | Help & Documentation | DONE |
| G-2 | Script Runtime & HUD | DONE |
| 12 | Polish (responsive, onboarding, perf) | DONE |
| 13 | AI Chat & Orchestration | DONE |
| 32 | Chat UX Enhancements | DONE | Entity @-mentions, command preview/approval, response feedback, batch undo |
| 35 | Quality Presets | DONE | Low/Medium/High/Ultra rendering presets (MSAA, shadows, bloom, sharpening, particles) |
| 36 | Material Library Browser | DONE | 56 presets across 9 categories, CSS sphere previews, custom material saving |
| T-1 | Test Infrastructure | DONE | 312 tests (287 web + 25 MCP), fixtures, store/executor/sceneFile/material/hierarchy/script/clipboard/search tests |
| H-1 | Prefab System | DONE | Entity templates, 8 built-in prefabs, localStorage persistence, search, import/export, 5 MCP commands |
| H-2 | Multi-Scene / Level System | DONE | Multiple named scenes per project, scene switching, duplicate, import/export, 7 MCP commands |
| T-2 | Test Coverage Expansion | DONE | 475 tests (450 web + 25 MCP), export pipeline, audio manager, chat/user stores, dndUtils |
| G-3 | Skybox & Environment Maps | DONE | Procedural cubemap presets (Studio, Sunset, Overcast, Night, Bright Day), Skybox component, IBL, 3 MCP commands |
| G-4 | Collision Events & Raycasting | DONE | Rapier CollisionEvent reading, forge.physics.onCollisionEnter/Exit, raycast API, 1 MCP command |
| 26 | Physics Joints | DONE | 6 joint types (fixed, revolute, spherical, prismatic, rope, spring), JointInspector, limits/motors, 4 MCP commands |
| 27 | Post-Processing Expansion | DONE | SSAO (WebGPU), depth of field, motion blur settings in PostProcessingSettings |
| 5-D | Pre-Built Game Components | DONE | 12 drag-and-drop behaviors (CharacterController, Health, Collectible, etc.), GameComponentInspector, 5 MCP commands |
| 14 | AI Asset Generation | DONE | 5 provider integrations (Meshy 3D/texture, ElevenLabs SFX/voice, Suno music), 9 API routes, generation store, polling hook, 5 UI dialogs, custom skybox, 8 MCP commands |
| 19 | In-Game UI Builder | DONE | 10 widget types, WYSIWYG editor, screen presets (7), data binding, play-mode renderer, export runtime, script API (forge.ui.*), 15 MCP commands |
| SEC | Security & Performance | DONE | CSP headers, WASM caching, wasm-opt pipeline, Cargo profile optimization, /dev route gate |
| OBS | Cost Observability | DONE | Tier rename (starter/hobbyist/creator/pro), 4 DB tables (tokenConfig, tierConfig, costLog, creditTransactions), cost logger, credit manager, 2 MCP commands |
| SCR | Script Library | DONE | Standalone scripts (localStorage CRUD), enhanced Script Explorer with library tab, import/export, 6 MCP commands, 18 tests |
| DOC | In-Editor Documentation | DONE | DocsPanel with BM25 search, category tree, markdown renderer, API route, help buttons on 6 inspectors, F1 shortcut |
| 4-C | Compound AI Actions | DONE | 8 compound tools (create_scene, create_level, setup_character, configure_mechanics, arrange_entities, apply_style, describe_scene, analyze_gameplay) |
| 5-E | Game Cameras | DONE | 6 camera modes (ThirdPerson, FirstPerson, SideScroller, TopDown, Fixed, Orbital), GameCameraInspector, forge.camera script API, 4 MCP commands |
| ST | Scene Transitions | DONE | CSS overlay transitions (fade, wipe, instant), forge.scene.load/restart/getCurrent/getAll script API, startSceneTransition async action, 2 MCP commands |
| GT-1 | Game Templates | DONE | 5 starter templates (platformer, runner, shooter, puzzle, explorer), TemplateGallery, lazy-loaded data, 3 MCP commands |
| D-2 | Keyframe Animation | DONE | AnimationClip system (Rust ECS), position/rotation/scale/color keyframes, easing modes, AnimationClipInspector, 8 MCP commands |
| 9-C | Dialogue System | DONE | DialogueTree editor, 5 node types (text/choice/condition/action/end), runtime overlay with typewriter, forge.dialogue script API, conditions & actions, 8 MCP commands, 44 tests |
| SEC-2 | Script Sandbox Hardening | DONE | Global shadowing, command whitelist, per-frame command limit, infinite loop watchdog, rate limiter, export closure fix |
| MC | Mobile Game Player | DONE | Virtual joystick + buttons overlay, 5 touch presets, safe area CSS, auto quality reduction, PWA viewport, forge.input.isTouchDevice()/vibrate(), SceneSettings UI |
| OBS-2 | Admin Economics Dashboard | DONE | /admin/economics page, cost analytics, per-user stats, token/tier config editors, API routes |
| CP | Cloud Publishing | DONE | Publish to shareable URLs, publishStore, PublishDialog, slug validation, tier-based limits, 4 API routes, 4 MCP commands |
| 15 | Visual Scripting | DONE | React Flow node graph editor, 73 node types (10 categories), graph-to-TypeScript compiler, CustomNode/NodePalette/NodeInspector, Code/Graph tabs, 5 MCP commands, 15 compiler tests |
| E2E | Playwright E2E Tests | DONE | 81 E2E tests (11 spec files), EditorPage POM, smoke/CSS/entity-CRUD/inspector/layout/chat/settings/mixer/modals/export/script tests, WASM readiness hook |
| 2D-1 | 2D Foundation | UI ONLY — no engine integration | ProjectType (2D/3D), SpriteData ECS component, Camera2dData, sorting layers, SpriteInspector, Camera2dInspector, SortingLayerPanel, useProjectType hook, 8 MCP commands |
| 2D-2 | Sprite Animation | UI ONLY — no engine integration | SpriteSheetData, SpriteAnimClip, SpriteAnimatorData, AnimationStateMachine, SpriteAnimationInspector, state transitions, forge.sprite script API, 6 MCP commands |
| 2D-4 | 2D Physics | UI ONLY — no engine integration | Physics2dData/Physics2dEnabled ECS, 6 collider shapes, 4 joint types, one-way platforms, surface velocity, Physics2dInspector, forge.physics2d script API, 8 MCP commands |
| 2D-3 | Tilemap System | UI ONLY — no engine integration | TilesetData/TilemapData ECS, multi-layer tiles, TilesetPanel, TilemapInspector, TilemapToolbar, TilemapLayerPanel, tilemap editor tools, forge.tilemap script API, 10 MCP commands |
| 2D-5 | Skeletal 2D Animation | UI ONLY — no engine integration | SkeletonData2d/SkeletalAnimation2d/BlendTree2d ECS, bone hierarchy, skins, IK constraints, SkeletonInspector, forge.skeleton2d script API, 11 MCP commands |
| 20 | Advanced Audio | PARTIAL — basic audio done, adaptive/occlusion stubs | Spatial audio, bus mixer, reverb zones work; adaptive music snapshots, occlusion, horizontal re-sequencing are console-log stubs, 6 MCP commands |
| 24 | Editor Collaboration | REMOVED (PF-142) | Stubs removed — no networking backend existed. Will rebuild from scratch when real-time sync is prioritized |
| 25 | Multiplayer Networking | REMOVED (PF-141) | Stubs removed — no networking backend existed. Will rebuild from scratch when multiplayer is prioritized |
| 31 | LOD & Performance | PARTIAL — UI + metrics stubs | LodData ECS component, LOD inspector, performance budget UI; bridge drains queues but does not generate mesh LODs or collect real perf stats, 6 MCP commands |

## New Component / Command Checklist

When adding a **new ECS component**, update these domain-scoped files:

### Rust Engine (4 files)
1. `engine/src/core/<component>.rs` — Component struct + marker (add `pub mod` in `core/mod.rs`)
2. `engine/src/core/pending/<domain>.rs` — Request structs + queue methods + bridge fns
3. `engine/src/core/commands/<domain>.rs` — Dispatch entry + handler function
4. `engine/src/bridge/<domain>.rs` — Apply system + selection emit (register in `bridge/mod.rs` SelectionPlugin::build())

### Rust Engine (supporting, if needed)
5. `engine/src/core/history.rs` — `UndoableAction` variant + `EntitySnapshot` field
6. `engine/src/core/entity_factory.rs` — delete/duplicate/undo/redo + `spawn_from_snapshot`
7. `engine/src/core/engine_mode.rs` — `snapshot_scene` (separate query param)
8. `engine/src/bridge/events.rs` — Emit function(s)
9. `engine/src/bridge/query.rs` — Query handler (if component has query support)

### Web Layer (4 files)
9. `web/src/stores/slices/<domain>Slice.ts` — State + actions (+ re-export from `slices/index.ts`)
10. `web/src/hooks/events/<domain>Events.ts` — Event handler(s)
11. `web/src/lib/chat/handlers/<domain>Handlers.ts` — Tool call handler(s) (partial migration; unmigrated tools fall through to `executor.legacy.ts`)
12. `web/src/components/editor/<Inspector>.tsx` — Inspector panel

### Integration (5 files)
13. `web/src/components/editor/InspectorPanel.tsx` — Import + render
14. `web/src/components/chat/ToolCallCard.tsx` — Display labels
15. `mcp-server/manifest/commands.json` — MCP commands
16. `web/src/data/commands.json` — **COPY of #15** (keep in sync)
17. `TESTING.md` — Manual test cases

## Detailed Reference (in `.claude/rules/`)

| File | Contents |
|------|----------|
| `rules/bevy-api.md` | Bevy 0.16 migration, ECS limits, library-specific APIs (rapier, hanabi, panorbit) |
| `rules/entity-snapshot.md` | EntityType, EntitySnapshot exhaustiveness, history, selection events |
| `rules/web-quality.md` | ESLint rules, React patterns, Next.js constraints, README update guide |
| `rules/library-apis.md` | csgrs, noise, serde-wasm-bindgen, terrain, texture pipeline, particles |
| `rules/file-map.md` | Engine structure, web structure, communication pattern |

## Agent Skills
- `/planner` — Architect flow, creates specs in `specs/`
- `/builder` — Implements specs into code
- `/cycle` — Plan -> Build -> Verify loop
- Arch Validator: `python .claude/skills/arch-validator/check_arch.py`
