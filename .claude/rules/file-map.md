# Project File Map

## Engine Structure (`engine/src/`)

### `bridge/` — JS Interop (ONLY module that touches `web_sys`/`js_sys`/`wasm_bindgen`)
- `mod.rs` — `#[wasm_bindgen]` exports + `SelectionPlugin::build()` orchestrator (~450 lines). References domain module systems via module paths
- `events.rs` — `emit_event()` + ~20 typed emit functions. Thread-local `RefCell` storage
- `core_systems.rs` — Selection, picking, mode changes, transforms, rename, snap, quality presets, scene graph/history emit
- `material.rs` — Material/light emit, environment, skybox, post-processing, shader apply/sync
- `physics.rs` — 3D + 2D physics, collisions, raycasts, joints, forces, debug toggle
- `audio.rs` — Audio updates/removals/playback, bus CRUD, reverb zones
- `query.rs` — Query request processing (main, terrain, quality, reverb zone, joints)
- `animation.rs` — GLTF animation registration, playback, state polling
- `particles.rs` — Particle apply/toggle/removal/preset, Hanabi GPU sync (webgpu)
- `scene_io.rs` — Scene export/load, new scene, GLTF import, texture load, asset placement
- `procedural.rs` — CSG boolean ops, extrude, lathe
- `mesh_ops.rs` — Array entity, combine meshes, prefab instantiation
- `scripts.rs` — Script updates/removals, input bindings, play tick
- `game.rs` — Game component CRUD, game camera, camera shake
- `skeleton2d.rs` — 2D skeletal animation: bones, skins, IK, keyframes, auto-weight

### `core/` — Pure Rust, Platform-Agnostic (NO browser deps)

#### `core/commands/` — Command dispatch (split into domain modules)
| File | Purpose |
|------|---------|
| `mod.rs` | `dispatch()` chain, `CommandResponse`, `CommandResult`, shared helpers, and `fn route_domain` — the routing table consulted BEFORE any domain module, so a name it omits is unreachable however correct its arm (`_ => 255` → `Err("Unknown command")`). Its `#[cfg(test)] mod route_domain_parity` compares the router's index against each domain's own `pub fn dispatch` arms, which is the only way to catch a name routed to the WRONG domain (PF-1178 — see `rules/gotchas.md` → Engine & Game Loop) |
| `transform.rs` | Spawn, delete, duplicate, rename, reparent, camera, gizmo, snap, input |
| `material.rs` | Material, light, ambient, environment, post-processing, skybox, shaders |
| `physics.rs` | Physics 3D, joints, physics 2D, forces, raycasts |
| `audio.rs` | Audio, buses, reverb zones |
| `animation.rs` | Animation playback, speed, loop, blend |
| `particles.rs` | Particle system, presets, playback |
| `procedural.rs` | CSG, terrain, extrude, lathe, array, combine, prefab, quality |
| `scene.rs` | Scene export/load, GLTF import, textures, assets, scripts |
| `game.rs` | Game components, game camera |
| `sprites.rs` | Project type, sprites, camera 2D, skeleton 2D |

#### `core/pending/` — Thread-local command queue (split into domain modules)
| File | Purpose |
|------|---------|
| `mod.rs` | `PendingCommands` struct (fields only), `EntityType`, `with_pending` helper, re-exports |
| `transform.rs` | Transform, rename, spawn, delete, duplicate, selection, camera, snap requests |
| `material.rs` | Material, lighting, environment, post-processing, shader, skybox requests |
| `physics.rs` | Physics 3D, 2D, joints, forces, raycasts requests |
| `audio.rs` | Script, audio, bus, reverb zone requests |
| `animation.rs` | Animation, animation clips, skeleton 2D requests |
| `particles.rs` | Particle system requests |
| `procedural.rs` | CSG, terrain, extrude, lathe, array, combine requests |
| `game.rs` | Game component, game camera, input binding requests |
| `sprites.rs` | Sprite, 2D camera, project type requests |
| `scene.rs` | Scene, assets, prefab, quality requests |
| `query.rs` | `QueryRequest` enum |

#### Other core files
| File | Purpose |
|------|---------|
| `csg.rs` | CSG booleans via `csgrs`. `CsgMeshData`, `CsgOperation` enum |
| `terrain.rs` | Procedural terrain. `TerrainData`/`TerrainMeshData`/`TerrainEnabled` |
| `procedural_mesh.rs` | Extrude, lathe, combine. `ProceduralMeshData`/`ProceduralOp` |
| `entity_factory.rs` | Spawn/delete/duplicate with undo. `EntitySnapshot`, `spawn_from_snapshot` |
| `json_guard.rs` | Depth + container-count bounds on every `Value` reaching the parser, checked iteratively. Counts containers only, so bulk scalar data (a full-size tilemap) passes. Applied at `commands::dispatch`, `dispatch_batch`, `build_game_component`. Mirrored in TS by `lib/engine/commandPayloadGuard.ts` (PF-1149) |
| `history.rs` | `UndoableAction` (29 variants), `HistoryStack`, `EntitySnapshot` |
| `entity_id.rs` | `EntityId`, `EntityName`, `EntityVisible` |
| `gizmo.rs` | Transform gizmo. `GizmoTarget` + `group_targets=true` |
| `camera.rs` | `bevy_panorbit_camera`. `yaw`/`pitch`/`radius` |
| `material.rs` | `MaterialData` synced to `StandardMaterial` via `MeshMaterial3d` |
| `lighting.rs` | `LightData` (Point/Directional/Spot) |
| `environment.rs` | `EnvironmentSettings` (ClearColor + `DistanceFog`) |
| `engine_mode.rs` | `EngineMode` (Edit/Play/Paused), `EditorSystemSet`, `PlaySystemSet`, snapshot/restore (3D + 2D physics) |
| `input.rs` | `InputMap`/`InputState`, `InputPreset`, `capture_input` |
| `physics.rs` | `PhysicsData`/`PhysicsEnabled`, `manage_physics_lifecycle` |
| `audio.rs` | `AudioData`/`AudioEnabled` (metadata — playback is JS-side) |
| `scripting.rs` | `ScriptData` (metadata — execution is JS-side Web Worker) |
| `post_processing.rs` | `PostProcessingSettings` (Bloom, ChromAb, ColorGrade, Sharpen) |
| `particles.rs` | `ParticleData`/`ParticleEnabled`, 9 presets |
| `asset_manager.rs` | `AssetRef`, `AssetRegistry`, `TextureHandleMap` |
| `scene_file.rs` | `SceneName`, `.forge` format serialization |

## Web Structure (`web/src/`)

### Stores
- `editorStore.ts` — Composition root: creates store from domain slices (~134 lines)
- `stores/slices/` — Domain state slices (20 domain slices: selection, sceneGraph, transform, material, lighting, sceneLight, physics, audio, animation, particle, script, game, sprite, history, scene, asset, bridge, editMode, localization, orchestrator + types/index)
- `chatStore.ts` — `rightPanelTab`, chat messages, token balance
- `userStore.ts` — Tier, token balance, permissions (`canUseAI`, `canUseMCP`, `canPublish`)

### Editor Components (`components/editor/`)
EditorLayout, SceneHierarchy, InspectorPanel, MaterialInspector, LightInspector, PhysicsInspector, AudioInspector, ParticleInspector, TerrainInspector, AudioMixerPanel, SceneSettings, InputBindingsPanel, ScriptEditorPanel, PlayControls, SceneToolbar, ExportDialog, AssetPanel, Sidebar, CanvasArea, ContextMenu, Vec3Input, AnimationInspector, DrawerPanel, MobileToolbar, WelcomeModal, KeyboardShortcutsPanel

### Layout Components (`components/layout/`)
- `ViewportLock.tsx` — `h-dvh overflow-hidden` wrapper applied by `app/editor/layout.tsx` and `app/dev/layout.tsx`. The editor's full-viewport scroll lock lives here, scoped to those route segments; it must NEVER move back to a global `html`/`body` rule (PF-1017 — see `rules/gotchas.md` → UI & Frontend)

### Marketing Components (`components/marketing/`)
- `LandingPage.tsx` — the `/` landing page body (`'use cache'` + `cacheLife('days')`), rendered by `app/page.tsx`
- `AiShowcaseSection.tsx`, `Breadcrumbs.tsx`

### Key Hooks
- `useEngine.ts` — WASM loading singleton (WebGPU detect, fallback)
- `useEngineEvents.ts` — Event delegation hub (~85 lines), delegates to `hooks/events/` domain handlers
- `hooks/events/` — Domain event handlers (10 files: transform, material, physics, audio, animation, game, sprite, particle, editMode, performance + index/types)
- `useResponsiveLayout.ts` — Layout mode from viewport breakpoints (compact/condensed/full)
- `useViewport.ts` — Canvas dimensions, DPR, breakpoint detection
- `useVirtualList.ts` — Lightweight virtual scrolling hook

### Libraries (`lib/`)
- `chat/executor.ts` — Handler registry dispatcher, delegates to `chat/handlers/` (all handlers fully migrated)
- `chat/handlers/` — 29 domain tool handler files (transform, material, entity, physics, audio, audioEntity, animation, sprite, shader, scene, script, query, export, asset, compound, generation, gameplay, economy, dialogue, cutscene, localization, idea, world, uiBuilder, pixelArt, editMode, performance, security, leaderboard + types/helpers)
- `chat/context.ts` — Scene context for AI
- `cutscene/` — rAF playback. `player.ts` builds one command per keyframe and dispatches it; `dispatch.ts` is the routing seam that sends browser-only commands (`start_dialogue` → `dialogueStore`) to their real handler instead of the engine, injected at the `play_cutscene` call site. `__tests__/dispatch.test.ts` pins that every command a track can emit is routed by something (PF-1140 — see `rules/gotchas.md` → Engine & Game Loop)
- `game/gameCameraPayload.ts` — The ONLY place the authoring camera vocabulary (`followDistance`, `followHeight`, …) and the engine's flat wire vocabulary (`offset`, `damping`, `eyeHeight`, …) meet. Owns both directions (`buildSetGameCameraPayload` / `parseGameCameraWire`) plus `ENGINE_CAMERA_DEFAULTS`, the mirror of `GameCameraMode::from_flat`'s per-variant defaults (pinned against the Rust source by its test — PF-1126). Imports from `@/stores/slices/types` must stay `import type`: this module is reachable from an API route, and a value-import of `@/stores/` breaks `next build` (see `rules/gotchas.md` → the RSC-boundary entry)
- `game-creation/` — The idea→GDD→playable-scene pipeline. `pipelineRunner.ts` walks a plan; `executors/` holds one module per step (`sceneCreateExecutor`, `cameraSetupExecutor`, `autoPolishExecutor`, `verifyExecutor`, …) reached through a barrel that an API route imports, so NOTHING here may take a value import on `@/stores` or `@/hooks/useEngine` (`__tests__/serverSafeImports.test.ts` scans for it — see `rules/gotchas.md` → the RSC-boundary entry). Five shared modules exist because the same logic was written more than once and the copies drifted:
  - `cameraResolution.ts` — `normalizeCameraMode` (GDD spellings → engine modes, project-type-aware fallback), `cameraModeNeedsTarget` (the five modes that are INERT without a target entity — the engine wraps their arms in `if let Some(target_t)`), `looksLikeCameraName` (the one heuristic `camera_setup`, `auto_polish` and `verify_all_scenes` all use, so verification cannot disagree with discovery), `filterCameraNumerics` + `classifyCameraConfigKeys` (GDD config → engine params, reporting rather than silently dropping what has no mapping — an unrecognized key, a value the engine cannot take, and a duplicate spelling each get their own reason, so a translator bug and a typo are distinguishable; the unit-converting entries are PF-1134). Range policy lives in `CAMERA_VALUE_POLICIES` and is applied through the narrowing `isSendableCameraValue`, never a post-check `as number` — PF-1166, whose sign policy the engine now HARD-REJECTS, so a refused value would otherwise take the whole full-replace `set_game_camera` command with it
  - `stepWarnings.ts` — `collectStepWarnings`, which is why a partially-applied step is visible at all: an executor's `warning`/`warnings` output used to be computed and then discarded by `onStepComplete`, so a step that half-worked still got a green tick and nothing else (PF-1125)
  - `entityShape.ts` — `resolveEntityShape` (role + `primitive:<shape>` appearance + project type → the `spawn_entity` entityType), `SPAWNABLE_SHAPES`, `ROLE_TO_ENTITY_TYPE`, and `COLLIDER_FOR_SHAPE`, the mesh→collider pairing. It is shared rather than private to `entitySetupExecutor` because `physics_enable` has to derive a collider from the SAME answer the spawn used — two copies drift into a capsule player floating inside a cuboid collider (PF-1213)
  - `physicsRoles.ts` — `physicsProfileForRole`, the table deciding what physical body each spawned role gets. Two engine facts are encoded there and neither is visible from the field names: Rapier's default `ActiveCollisionTypes` omits KINEMATIC↔FIXED and FIXED↔FIXED, so **every pair must have a dynamic side and the player is `dynamic`**; and a pickup must be a `Sensor` or contact punts the collectible across the level. `undefined` for an unknown role is deliberate — the caller skips it loudly rather than granting a silent cuboid (PF-1213)
  - `executors/engineDispatch.ts` — `engineEntityId` (mirrors the engine's `is_valid_override_id`; a rejected id is silently replaced by a random UUID, so every later step bound to the planned id resolves to nothing), `waitForEngineFrame`, and `sendCommands`. `waitForEngineFrame` is load-bearing, not defensive: Bevy flushes `Commands` only at an EXPLICIT ordering edge, and the 3D `apply_physics_updates` / `apply_physics_toggles` pair is registered updates-first and unchained — a `toggle_physics` and its `update_physics` patch in the same frame lose the patch with nothing but a `tracing::warn!`
  - `executors/physicsEnableExecutor.ts` — the `physics_enable` step (PF-1213). Nothing in the pipeline had ever dispatched `toggle_physics`, so no spawned entity carried `PhysicsEnabled`, no Rapier collider existed, `runtime.active_collisions` stayed empty and collectible pickup / score / `game_win` were unreachable in every generated game. Planned twice — `planBuilder` Phase 2.5 over the blueprint cast, and a second step from `systems/world.ts` for geometry ids that exist only there — and always BEFORE `physics_profile`, `character_setup`, `game_component`, `verify_all_scenes` and Play
- `physics/physics2dPayload.ts` — The ONLY place the browser and engine 2D physics vocabularies meet, in both directions (`buildSetPhysics2dPayload` / `buildUpdatePhysics2dPayload` / `parsePhysics2dWire`). Payloads are built key-by-key from an allowlist rather than spread-and-annotated — `{ ...input } satisfies T` is inert, because excess-property checking never applies to spread properties. The allowlist itself IS annotated, and load-bearingly so: it is an object carrying `satisfies Record<keyof Physics2dData, true>`, which is the only thing proving the TS field list complete (exported as `PHYSICS2D_PATCH_KEYS`; the object behind it is module-private). Also owns `defaultPhysics2dData()` and both enum variant tables, pinned against `engine/src/core/physics_2d.rs` textually by its test (PF-1167). `physics/updatePhysicsPayload.ts` is the 3D counterpart
- `engine/commandPayloadGuard.ts` — Depth + container-count bounds enforced at all three dispatch chokepoints (`editorStore`'s dispatcher wrappers, `useEngine.sendCommand`/`sendCommandBatch`, and `useScriptRunner.dispatchCommand`, the one that carries user-script payloads), the last points where a payload is still a JS object. The engine's own guard cannot cover the wasm path: `serde_wasm_bindgen` builds the `Value` recursively before any Rust runs. Numbers are pinned against `engine/src/core/json_guard.rs` by its test, and `__tests__/dispatchChokepoints.test.ts` fails if a fourth path into `handle_command` appears unaccounted for (PF-1149). Must stay free of `@/stores` / `@/hooks` value-imports
- `scripting/` — Web Worker sandbox, forge.* API types, templates
- `audio/` — Web Audio API manager (spatial, per-entity nodes)
- `export/` — Export pipeline (scriptBundler, assetPackager, gameTemplate)
- `projects/` — Cloud project CRUD, tier-based limits
- `auth/` — Clerk helpers, user DB sync
- `tokens/` — Token balance/deduction
- `keys/` — BYOK key resolution, AES-256-GCM encryption
- `db/` — Drizzle + Neon client, DB schema
- `monitoring/` — Sentry wiring shared by all three runtime configs. `sentryConfig.ts` owns the scrubbers (`scrubSentryEvent` / `scrubSentryLog` / `scrubSentryMetric` — three independent pipelines, all three must stay wired) plus fingerprinting; `sentry-server.ts` owns `sentryLogger`; `generationMetrics.ts` owns the `/api/generate/*` business metrics and the `GENERATION_OUTCOMES` vocabulary (PF-1053 — values must dodge Sentry's server-side value scrubber)

### MCP Server (`mcp-server/`)
- `manifest/commands.json` — 351 commands across 41 categories (measured: `bash .claude/tools/validate-mcp.sh sync`)
- `src/manifest.test.ts` — Schema validation (update `validCategories` when adding categories)
- `src/docs/` — Doc loader, BM25 search, MCP resource/tool registration

## Design System (`packages/ui/`)

Published as `@spawnforge/ui`. The one allowed cross-package import in `next.config.ts` (`transpilePackages`).

### `packages/ui/src/tokens/` — Design tokens (single source of truth)
- `colors.ts` — Semantic color palette per theme (`ember`, `ice`, `leaf`, `rust`, `mech`, `light`, `dark`)
- `spacing.ts` — 4px-grid spacing scale
- `radius.ts` — Border radius constants
- `typography.ts` — Font size, weight, line-height scale
- `z-index.ts` — `Z_INDEX` object (e.g. `Z_INDEX.effects = 5`)
- `themes.ts` — `ThemeName` union type and theme metadata
- `theme.css` — CSS custom properties for all theme tokens
- `index.ts` — Re-exports all tokens

### `packages/ui/src/primitives/` — Unstyled base components
Headless building blocks: `Accordion`, `Avatar`, `Badge`, `Button`, `Card`, `Checkbox`, `Dialog`, `Input`, `Label`, `Popover`, `Progress`, `ScrollArea`, `Select`, `Separator`, `Skeleton`, `Switch`, `Tabs`, `Textarea`, `Toast`, `Tooltip`.
Each has a co-located `__tests__/` directory.

### `packages/ui/src/effects/` — Theme ambient visual effects
- `ThemeAmbient.tsx` — Effect router: reads `data-sf-theme` + `data-sf-effects` from `document.documentElement` via `MutationObserver`, lazily renders the matching effect component. Dark theme → no effect. Must be imported with `next/dynamic({ ssr: false })`.
- `EmberGlow.tsx`, `IceFrost.tsx`, `LeafDrift.tsx`, `RustGears.tsx`, `MechScanlines.tsx`, `LightRays.tsx` — Individual CSS-animation effect components
- `effects.css` — Keyframe animations shared by all effects
- `__tests__/ThemeAmbient.test.tsx` — Unit tests (jsdom environment, MutationObserver simulation)

### `packages/ui/src/hooks/` — Shared React hooks
- `useTheme.ts` — Reads/writes `data-sf-theme` on `document.documentElement`
- `useDialogA11y.ts` — Focus trap + aria helpers for modal dialogs
- `__tests__/` — Unit tests per hook

### `packages/ui/src/utils/` — Utility functions
- `cn.ts` — `cn()` helper: `clsx` + `tailwind-merge` for conditional class names
- `__tests__/` — Unit tests

### `packages/ui/src/composites/` — Higher-order composed components (built from primitives + tokens)
- `internal.ts` — Internal-only composite exports
- `index.ts` — Public surface of the package

## Documentation Site (`apps/docs/`)

Fumadocs-based docs site for the SpawnForge platform API and MCP command reference. Clerk-gated (auth required). Deployed to `docs.spawnforge.ai` via CD pipeline (`deploy-docs` job). Vercel project: `spawnforge-docs`, `rootDirectory: apps/docs`.

### `apps/docs/` — Root files
- `proxy.ts` — Clerk auth gate. Wraps `clerkMiddleware` defensively — if Clerk throws, requests pass through. Without `CLERK_SECRET_KEY`, all access is allowed (dev/CI).
- `app/layout.tsx` — Root layout with `ClerkProvider`, `force-dynamic` export
- `app/sign-in/[[...sign-in]]/page.tsx` — Clerk `<SignIn>` component. MUST have `'use client'` directive.

### `apps/docs/components/` — Docs-site React components
- `CommandFilter.tsx` — Accessible faceted filter for the MCP command index. Accepts `categories`, `scopes`, `totalCommands`, optional `visibleCount` + `onFilterChange`. Uses `role="group"`, native checkboxes, and `aria-live="polite"` status region.

### `apps/docs/lib/` — Shared docs-site utilities
- `commands.ts` — `readCommandsManifest()`: reads `apps/docs/data/commands.json` (override with `MANIFEST_PATH`), returns `{ categories, scopes, publicCount }` for public commands only. Scope prefixes extracted via `/^([a-z_]+)_/` regex. **The path must stay inside the deploy root** — `rootDirectory: apps/docs`, so anything above `apps/docs/` resolves locally and is absent on Vercel (PF-1019). An unreadable manifest THROWS; it must never degrade to a zero-command build.

### `apps/docs/scripts/` — Build-time Node scripts
- `check-manifest-sync.ts` — Asserts the canonical `mcp-server/manifest/commands.json` matches BOTH copies: `web/src/data/commands.json` and `apps/docs/data/commands.json`. THREE copies exist; adding a fourth without registering it here is how the docs copy silently drifted (PF-1019)
- `ci-gate-check.ts` — CI gate: fails if public command count drops below threshold
- `generate-mcp-docs.ts` — Generates MDX pages from the MCP command manifest
- `__tests__/` — Vitest unit tests for each script (environment: node)

### `apps/docs/content/` — MDX documentation content
### `apps/docs/public/` — Static assets

**vitest config:** `apps/docs/vitest.config.ts` — includes `scripts/__tests__/**/*.test.ts` and `components/__tests__/**/*.test.tsx` and `lib/__tests__/**/*.test.ts` (environment: node for scripts, jsdom for components).

## Design Workbench (`apps/design/`)

Storybook-based catalogue for `@spawnforge/ui` components and effects. Uses Vite (not Next.js) — bundled with `@vitejs/plugin-react`.

### `apps/design/` — Root files
- `vite.config.ts` — Vite config for the design workbench (added `@vitejs/plugin-react`)
- `scripts/sync-vendored-ui.sh` — Copies built `@spawnforge/ui` output into `apps/design/vendored/` for Storybook consumption without a monorepo build step

### `apps/design/stories/` — Story files
- `effects/` — Stories for each theme ambient effect (EmberGlow, IceFrost, etc.)
- `primitives/` — Stories for each primitive component (Button, Input, etc.)

## Communication Pattern

**JS -> Rust:** `editorStore` slice action -> `dispatchCommand()` -> `handle_command()` -> `commands::dispatch()` chain -> domain `dispatch()` -> `pending/` queue -> Bevy drains next frame

**Rust -> JS:** Bevy system -> `emit_event()` -> JS callback -> `useEngineEvents` -> domain event handler -> Zustand `set()` -> React re-render

**Audio/Scripts:** Rust stores metadata (`AudioData`, `ScriptData`) as ECS components. JS handles execution (Web Worker for scripts, Web Audio API for audio)

**Particles:** `ParticleData`/`ParticleEnabled` always compiled. WebGPU: `bevy_hanabi` GPU rendering. WebGL2: data stored, not rendered
