# Roadmap Status Audit - 2026-03-09

## Summary

Audited every phase with a non-"DONE" status label, plus spot-checked DONE phases.
Found **8 mislabeled phases** that need correction.

## Mislabeled Phases

### 2D-1 (2D Foundation): "UI ONLY" -> DONE

**Evidence:**
- `engine/src/core/sprite.rs` — `SpriteData`, `SpriteEnabled`, `SpriteAnchor`, `z_from_sorting()` ECS components
- `engine/src/core/camera_2d.rs` — `Camera2dData`, `Camera2dEnabled`, `CameraBounds`, `Managed2dCamera`
- `engine/src/core/project_type.rs` — `ProjectType` component
- `engine/src/bridge/sprite.rs` — `apply_spawn_sprite_requests()` creates real Bevy `Sprite` entities, `apply_sprite_data_updates()` syncs `SpriteData` to Bevy rendering, `sync_sprite_rendering()` handles texture/anchor/flip/size sync
- `engine/src/bridge/sprite.rs` — `apply_camera_2d_updates()` + `sync_camera_2d_rendering()` drive real `OrthographicProjection` zoom
- `engine/src/bridge/mod.rs` lines 359-382 register all sprite + camera 2D systems in the Bevy app
- `web/src/components/editor/SortingLayerPanel.tsx` — sorting layer UI
- `web/src/components/editor/SpriteInspector.tsx` — sprite inspector

**Minor gaps (non-blocking):**
- Custom sorting layers are string-matched ("Background"/"Default"/"Foreground"/"UI") rather than user-defined
- Pixel-perfect rendering sets the flag but does not snap to integer pixels in the viewport

### 2D-2 (Sprite Animation): "UI ONLY" -> DONE

**Evidence:**
- `engine/src/core/sprite.rs` — `SpriteSheetData`, `SliceMode`, `SpriteAnimatorData`, `AnimationStateMachineData`, `SpriteAnimationTimer`
- `engine/src/bridge/sprite.rs` — `apply_sprite_sheet_updates()`, `sync_sprite_sheet_atlas()` (builds `TextureAtlasLayout`), `animate_sprite_frames()` (frame timing), `evaluate_animation_state_machine()` (state transitions)
- `engine/src/bridge/mod.rs` lines 364-374 register all animation systems
- All systems are in the Update schedule, not editor-only gated

### 2D-3 (Tilemap System): "UI ONLY" -> DONE

**Evidence:**
- `engine/src/core/tilemap.rs` — `TilemapData`, `TilemapLayer`, `TilemapOrigin`, `TilemapEnabled`
- `engine/src/core/tileset.rs` — `TilesetData`, `TileMetadata`, `TileAnimation`
- `engine/src/bridge/sprite.rs` — `apply_tilemap_data_updates()`, `apply_tilemap_data_removals()`, `sync_tilemap_rendering()` (creates child `Sprite` entities with `TextureAtlas` for each tile)
- `TileEntity` marker component, `TilemapRenderState` with hash-based change detection
- Undo/redo support via `UndoableAction::TilemapChange`

### 2D-4 (2D Physics): "UI ONLY" -> DONE

**Evidence:**
- `engine/src/core/physics_2d.rs` — `Physics2dData`, `Physics2dEnabled`, `BodyType2d`, `ColliderShape2d`, `PhysicsJoint2d`, `JointType2d`
- `engine/src/core/physics_2d_sim.rs` — `Physics2dPlugin` registers `RapierPhysicsPlugin::<NoUserData>`, `RapierDebugRenderPlugin`, and systems: `manage_physics2d_lifecycle`, `sync_debug_physics2d`, `sync_gravity2d`, `manage_joint2d_lifecycle`
- `engine/src/bridge/physics.rs` — `apply_physics2d_updates()`, `apply_physics2d_toggles()`
- Real Rapier 2D integration with collider creation (`make_collider_2d`), body type conversion, gravity resource

### 2D-5 (Skeletal 2D Animation): "UI ONLY" -> DONE

**Evidence:**
- `engine/src/core/skeleton2d.rs` — `SkeletonData2d`, `Bone2dDef`, `SlotDef`, `SkinData`, `IkConstraint2d`
- `engine/src/core/skeletal_animation2d.rs` — `SkeletalAnimation2d`, `BoneKeyframe`, `SkeletalAnimPlayer2d`, `BlendEntry`
- `engine/src/core/blend_tree2d.rs` — `BlendTree2d`, `BlendTreeType2d`
- `engine/src/bridge/skeleton2d.rs` — 12 systems registered: `apply_skeleton2d_creates`, `apply_bone2d_adds/removes/updates`, `apply_skeletal_animation2d_creates/plays`, `apply_skeleton2d_skin_sets`, `apply_ik_chain2d_creates`, `apply_auto_weight_skeleton2d`, `handle_skeleton2d_query`, `render_skeleton_bones`
- Runtime systems: `advance_skeleton_animation`, `solve_ik_constraints_2d`, `apply_vertex_skinning_2d` (chained in Update)

### Phase 20 (Advanced Audio): "PARTIAL" -> DONE

**Evidence (all real implementations, not stubs):**
- `web/src/lib/audio/audioManager.ts` — `saveSnapshot()` / `loadSnapshot()` / `deleteSnapshot()` with real bus volume crossfading via Web Audio `linearRampToValueAtTime`
- `setOcclusion()` — real lowpass `BiquadFilterNode` per entity, reconnects audio graph
- `detectLoopPoints()` — real zero-crossing analysis with similarity scoring
- `setAdaptiveMusic()` — real multi-stem track with intensity-based gain crossfading
- `setAdaptiveIntensity()` — real per-stem gain ramping
- Tests in `audioManager.snapshots.test.ts` confirm implementations
- Only missing: horizontal resequencing (not critical for "DONE" status as it was a stretch goal)

### Phase 31 (LOD & Performance): "PARTIAL" -> DONE

**Evidence:**
- `engine/src/core/mesh_simplify.rs` — 783-line QEM (Garland-Heckbert) mesh simplification
- `engine/src/core/lod.rs` — `LodData`, `LodMeshes` (stores pre-generated mesh handles), `PerformanceMetrics` resource (fps, frame_time, triangles, draw_calls, entity_count, memory)
- `engine/src/bridge/performance.rs` — `apply_lod_commands()` calls `mesh_simplify::simplify_mesh()` to generate real LOD meshes, `collect_performance_metrics()` gathers real stats, `update_lod_levels()` does distance-based mesh swapping
- `web/src/stores/performanceStore.ts` — full stats store with 60-frame history, budget warnings
- `web/src/hooks/events/performanceEvents.ts` — event handlers for stats + LOD changes
- `web/src/components/editor/LodInspector.tsx` — LOD inspector UI

### Phase 4-B (AI Chat Panel): "deferred" -> DONE

**Evidence:**
- `web/src/components/chat/ChatPanel.tsx` — full chat UI with message list, suggested prompts, token counter
- `web/src/components/chat/ChatInput.tsx` — text input, image upload (via file input + base64), voice input (Web Speech API), model selection (Sonnet 4.5 / Haiku 4.5), thinking mode toggle, approval mode toggle
- `web/src/components/chat/ChatMessage.tsx` — message rendering with tool call cards
- `web/src/components/chat/EntityPicker.tsx` — entity @-mentions
- `web/src/components/chat/ToolCallCard.tsx` — tool call display with 200+ labeled commands
- `web/src/stores/chatStore.ts` — full state management: streaming, abort, model selection, thinking mode, approval mode, batch undo, message feedback, conversation save/load (localStorage), entity refs, session token tracking
- `web/src/app/api/chat/route.ts` — API route for Claude API integration
- `web/src/lib/chat/executor.ts` + `handlers/` — tool call execution pipeline

## Spot-Check of DONE Phases

All spot-checked phases have their expected files present:

| Phase | Key File Checked | Present |
|-------|-----------------|---------|
| 9-C Dialogue | `DialogueTreeEditor.tsx` | Yes |
| 15 Visual Scripting | `VisualScriptEditor.tsx` | Yes |
| 5-D Game Components | `GameComponentInspector.tsx` | Yes |
| 26 Physics Joints | `JointInspector.tsx` | Yes |
| D-2 Keyframe Animation | `AnimationClipInspector.tsx` | Yes |
| GT-1 Game Templates | `TemplateGallery.tsx` | Yes |
| 10 Export | `web/src/lib/export/` (20 files) | Yes |
| CP Cloud Publishing | `PublishDialog.tsx` | Yes |
| 19 UI Builder | `UIBuilderPanel.tsx` | Yes |
| H-1 Prefab System | `web/src/lib/prefabs/prefabStore.ts` | Yes |
| H-2 Multi-Scene | `web/src/stores/slices/sceneSlice.ts` (multi-scene) | Yes |
| ST Scene Transitions | `sceneSlice.ts` (transition config) | Yes |

No DONE phases were found to be missing their key implementation files.

## Corrective Actions

1. Update `2D-1` through `2D-5` status from "UI ONLY -- no engine integration" to "DONE"
2. Update Phase 20 status from "PARTIAL" to "DONE"
3. Update Phase 31 status from "PARTIAL" to "DONE"
4. Update Phase 4-B status from "deferred" to "DONE"
5. Update descriptions to remove stale caveats

## Minor Remaining Gaps (non-blocking, could become future tickets)

- **2D-1**: Custom user-defined sorting layers (currently 4 hardcoded layers)
- **Phase 20**: Horizontal resequencing (not implemented, was a stretch goal)
- **Phase 31**: GPU memory estimation is approximate (no direct WebGPU memory query API)
