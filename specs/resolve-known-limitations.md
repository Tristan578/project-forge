# Spec: Resolve All Known Limitations

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-14
> **Scope:** 5 items from `docs/known-limitations.md`

## User Workflow

The following journeys represent how each resolved limitation changes the game-creator experience:

**2D Joints (docs fix):** A creator building a ragdoll character in 2D adds a Revolute joint between the torso and arm. They enter Play mode — the joint constrains the bodies correctly. Previously, the known-limitations page said this was broken, causing confusion for creators who had it working. After this fix, the documentation accurately reflects the reality.

**2D Vertex Skinning:** A creator imports a character sprite sheet and wants smooth bone-deformed animation. They set up bones and skin weights in the SkeletonInspector. After entering Play mode, the character's mesh deforms smoothly with each bone movement instead of snapping between rigid attachment points. This is the difference between a cutout doll and a believable animated character.

**Audio Occlusion (graduated):** A creator builds a dungeon scene. The player walks around a corner and a monster growl becomes progressively muffled — the further behind the wall, the more occluded. Previously, the audio toggled abruptly between full clarity and maximum muffling at a fixed threshold. With graduated occlusion, the spatial audio feels natural.

**Custom WGSL Shaders:** An experienced creator writes a dissolve effect in WGSL. They paste it into the shader editor, register it to slot 1, and apply it to an enemy entity with a dissolve progress parameter. As the enemy takes damage, the progress value increases via a script and the mesh dissolves procedurally — an effect impossible with the 7 built-in presets.

**Expected outcome:** Creators who read `docs/known-limitations.md` no longer encounter stale entries for features that already work. Creators who need advanced effects (skinning, occlusion, custom shaders) can use them end-to-end without working around undocumented gaps.

---

## Executive Summary

Deep exploration of the codebase revealed that **2 of 5 "known limitations" are already fully implemented** — the documentation is stale. The remaining 3 require targeted work ranging from small (audio occlusion) to medium (vertex skinning, mega-shader). This spec covers all 5.

---

## Limitation 1: 2D Joints — NO CODE NEEDED (Docs-Only Fix)

### Finding

**2D joints are fully functional.** The `manage_joint2d_lifecycle()` system in `engine/src/core/physics_2d_sim.rs` (lines 210-304) already:
- Creates Rapier2D `ImpulseJoint` components on Edit→Play transition
- Supports all 4 joint types: Revolute (with limits/motors), Prismatic (with axis/limits/motors), Rope, Spring
- Cleans up joints on Play→Edit transition
- Full undo/redo support via `Joint2dChange` history variant

The known-limitations.md entry claiming "Rapier2D ImpulseJoint never created" is **incorrect**.

### Action Required

- Update `docs/known-limitations.md`: Move 2D Joints from "Partially implemented" to "Working"
- No code changes needed

### Acceptance Criteria

- Given the known-limitations.md is updated, When a user reads the doc, Then 2D Joints appears in the "Working" table
- Given a 2D scene with two rigid bodies and a Revolute joint, When entering Play mode, Then the joint constrains the bodies correctly

---

## Limitation 2: 2D Skeletal Animation (Vertex Skinning) — SMALL GAP

### Finding

The vertex skinning implementation is **95% complete**. All algorithms exist and are registered:
- `SkinnedMesh2d` component with bind-pose storage (core/skeleton2d.rs:113-134)
- `BoneWorldTransforms2d` cache (core/skeleton2d.rs:136-143)
- `init_skinned_meshes_2d` system creates `Mesh2d` from `AttachmentData::Mesh` (bridge/skeleton2d.rs:676-815)
- `skin_vertices_lbs` — corrected Linear Blend Skinning with bind-pose inverse (bridge/skeleton2d.rs:595-664)
- `apply_vertex_skinning_2d` — deforms mesh vertices every frame (bridge/skeleton2d.rs:844-875)
- All systems registered in correct order in bridge/mod.rs

**The gap:** No web UI or MCP command creates `AttachmentData::Mesh` with vertex data. The init system finds no mesh attachments, silently skips, and marks `SkinnedMeshInitialized` so it never retries.

### Solution

Add a command and MCP handler to create mesh attachments on skeleton skins:

#### Rust Changes (engine)

1. **New command `add_skeleton2d_mesh_attachment`** in `core/commands/sprites.rs`:
   - Payload: `{ entityId, skinName, attachmentName, vertices: [[f32;2]], uvs: [[f32;2]], triangles: [u16], weights: [{ bones: [String], weights: [f32] }] }`
   - Inserts `AttachmentData::Mesh` into the named skin's attachment map
   - Removes `SkinnedMeshInitialized` marker (forces re-init next frame)

2. **New pending request** in `core/pending/sprites.rs`:
   - `AddMeshAttachment2dRequest { entity_id, skin_name, attachment_name, mesh_data }`

3. **New bridge apply system** in `bridge/skeleton2d.rs`:
   - `apply_add_mesh_attachment_requests` — inserts attachment, removes guard marker

#### Web Changes

4. **MCP manifest** — Add `add_skeleton2d_mesh_attachment` command to both `commands.json` files

5. **Chat handler** — Add handler in `handlers2d.ts` for the new command

6. **SkeletonInspector enhancement** (optional, can defer) — Button to import mesh attachment from sprite/tileset

#### Tests

7. **Rust unit test** — Create skeleton with mesh attachment, verify `Mesh2d` spawned after `init_skinned_meshes_2d`
8. **Web handler test** — Verify command dispatch and argument validation

### Acceptance Criteria

- Given a skeleton entity with a mesh attachment (vertices + weights), When entering Play mode, Then bone animation visibly deforms the mesh
- Given the `add_skeleton2d_mesh_attachment` MCP command, When called with valid vertex/weight data, Then the attachment appears in the skin and triggers mesh initialization
- Given an entity with `SkinnedMeshInitialized` marker but no mesh, When a mesh attachment is added, Then the marker is removed and init re-runs

### Priority: High
### Effort: Medium (1-2 days)

---

## Limitation 3: LOD Mesh Decimation — NO CODE NEEDED (Docs-Only Fix)

### Finding

**Mesh decimation is fully implemented.** The engine contains a production-ready 840-line pure Rust QEM (Quadric Error Metric / Garland-Heckbert) implementation at `engine/src/core/mesh_simplify.rs` with:
- Two algorithms: QEM (quality, attribute-preserving) and Fast (position-only)
- Attribute preservation: UVs, normals, vertex colors with linear interpolation
- 30+ unit tests covering topology, attributes, edge cases
- Full command integration: `generate_lods`, `set_lod`, `set_lod_distances`, `set_simplification_backend`, `optimize_scene`
- Inspector UI with distance/ratio sliders and backend selector
- Scene persistence (LodData serialized, LodMeshes regenerated on load)

The known-limitations.md entry claiming "mesh decimation not available" is **incorrect**.

### Action Required

- Update `docs/known-limitations.md`: Mark LOD & Performance as fully working
- No code changes needed

### Acceptance Criteria

- Given the known-limitations.md is updated, When a user reads the doc, Then LOD & Performance shows as complete
- Given a mesh entity, When `generate_lods` is called, Then 3 simplified mesh variants are created and stored in `LodMeshes`

---

## Limitation 4: Audio Occlusion (Automatic Raycasting) — SMALL GAP

### Finding

The integration is **~85% complete**. What already works:
- Play-tick loop in `useScriptRunner.ts` dispatches `raycast_query` commands for each occludable audio entity (throttled at 250ms)
- `physicsEvents.ts` intercepts `RAYCAST_RESULT` with `audio_occlusion:` prefix
- Binary occlusion: hit another entity → occluded (500 Hz lowpass), no hit → unoccluded (5000 Hz)
- `audioManager.updateOcclusionAmount(entityId, amount: 0-1)` exists with exponential frequency interpolation + Q modulation

**The gap:** The raycast result handler uses only binary occlusion (`updateOcclusionState`), not the graduated `updateOcclusionAmount`. The existing `amount` method already handles smooth transitions — it just never receives a calculated amount.

### Solution

#### Web Changes Only (no Rust changes needed)

1. **`physicsEvents.ts`** — Replace binary occlusion with graduated calculation:
   ```
   amount = 1.0 - (hitDistance / totalDistance)
   ```
   - `hitDistance` = distance to obstruction (from raycast result)
   - `totalDistance` = distance from listener to source
   - Call `audioManager.updateOcclusionAmount(entityId, amount)` instead of `updateOcclusionState`
   - When `hitEntity === null` or `hitEntity === entityId`: call `updateOcclusionAmount(entityId, 0)` (fully clear)

2. **Optional enhancement** — Clamp minimum occlusion amount to 0.1 for near-grazing hits (wall edge)

3. **Update known-limitations.md** — Mark audio occlusion raycasting as integrated

#### Tests

4. **Update `physicsEvents.test.ts`** — Verify graduated amount calculation:
   - Hit at 25% distance → amount ~0.75
   - Hit at 75% distance → amount ~0.25
   - No hit → amount 0

### Acceptance Criteria

- Given an audio source behind a wall, When the listener moves, Then occlusion amount varies smoothly based on obstruction distance (not binary on/off)
- Given no obstruction between listener and source, Then occlusion amount is 0 (full clarity)
- Given a wall directly in front of the source, Then occlusion amount approaches 1.0 (maximum muffling)

### Priority: Medium
### Effort: Small (< 1 day)

---

## Limitation 5: Custom WGSL Shaders (Mega-Shader Approach) — REAL GAP

### Finding

Current state:
- 7 built-in effects work via `shader_type` uniform branching in a single WGSL file
- `CustomWgslSource` resource + template injection system exists for ONE custom shader per scene
- Visual node editor (40+ nodes) compiles to WGSL but output is limited to built-in effect mapping
- Bevy requires compile-time material type registration — cannot dynamically create new `MaterialExtension` types at runtime

**The gap is genuine:** Arbitrary user WGSL cannot be applied because each unique material type needs its own render pipeline registered at startup.

### Solution: Mega-Shader with Per-Entity Dispatch

Extend the existing architecture (which already uses branching) to support N user-defined effects:

#### Rust Changes (engine)

1. **Expand `ForgeShaderExtension` uniform block** — Add `custom_slot: u32` (0 = built-in, 1-8 = user slots) and `custom_params: [f32; 16]` for user-defined parameters

2. **New `CustomShaderRegistry` resource** — Stores up to 8 user shader functions:
   ```rust
   pub struct CustomShaderRegistry {
       slots: [Option<CustomShaderSlot>; 8],
   }
   pub struct CustomShaderSlot {
       name: String,
       wgsl_function_body: String,
       param_names: Vec<String>,
       compiled: bool,
   }
   ```

3. **Shader stitching system** — When a slot changes:
   - Validate WGSL via `naga` (already a transitive dep of wgpu)
   - Generate combined WGSL: all user functions + dispatch `switch(custom_slot)` block
   - Inject into template at `FORGE_USER_CODE_INJECTION_POINT`
   - Hot-reload shader asset handle (Bevy auto-recompiles pipeline)

4. **New commands:**
   - `register_custom_shader` — `{ slot: 0-7, name, wgslCode, paramNames }`
   - `apply_custom_shader` — `{ entityId, slot, params: { name: f32 } }`
   - `remove_custom_shader` — `{ slot }`

5. **Per-entity uniform mapping** — When `apply_custom_shader` is called, set `custom_slot = slot + 1` and pack named params into `custom_params[0..15]`

#### Web Changes

6. **Update visual node editor** — Compiler output targets `register_custom_shader` instead of built-in effect mapping

7. **Update `ShaderInspector`** — Show custom slot assignment, parameter sliders

8. **MCP manifest** — Add 3 new commands

#### WGSL Template Changes

9. **`forge_effects.wgsl`** — Add `custom_slot` dispatch after built-in effects:
   ```wgsl
   if (forge_uniforms.custom_slot > 0u) {
       switch (forge_uniforms.custom_slot) {
           case 1u: { color = custom_shader_1(color, uv, time, custom_params); }
           case 2u: { color = custom_shader_2(color, uv, time, custom_params); }
           // ... up to 8
           default: {}
       }
   }
   ```

### Constraints

- **8 concurrent custom shaders** max (expandable later)
- **Any shader change recompiles full pipeline** (~50-200ms, show loading indicator)
- **16 float parameters per shader** (expandable by using additional uniform blocks)
- **No compute shaders** (WebGL2 limitation; WebGPU-only in future)
- **naga validation** catches invalid WGSL before pipeline submit (prevents GPU crashes)

### Acceptance Criteria

- Given a user writes a custom WGSL fragment function, When they register it to a slot, Then the shader compiles and is available for application
- Given a custom shader is applied to an entity, When the scene renders, Then the custom effect is visible with correct parameters
- Given 8 custom shaders are registered, When a 9th is attempted, Then an error is returned with a clear message
- Given invalid WGSL code, When registration is attempted, Then naga validation catches the error and returns a descriptive message
- Given the visual node editor compiles a graph, When the user applies it, Then it automatically registers to the next available slot

### Priority: High
### Effort: Large (3-5 days)

---

## Performance Targets

Each limitation fix must meet these quantified targets. Work that degrades any of these metrics must be revised before merge.

### Audio Occlusion (Limitation 4)

| Metric | Target | Notes |
|--------|--------|-------|
| Occlusion update latency | < 1ms per entity per tick | Raycast result lookup is O(1) by entityId |
| Raycast dispatch throttle | 250ms minimum interval per entity | Already enforced in `useScriptRunner.ts` |
| Frequency transition smoothing | 60 fps linear interpolation | Exponential interpolation from current to target frequency over 100ms |
| Filter Q factor range | 0.1 to 5.0 | Lower Q = broader band attenuation (more natural) |
| Maximum simultaneous occluded sources | 16 entities | Limited by Web Audio API `BiquadFilterNode` count budget |
| Occlusion amount precision | 2 decimal places (0.00 to 1.00) | Distance ratio rounded to avoid floating-point jitter |

### 2D Vertex Skinning (Limitation 5)

| Metric | Target | Notes |
|--------|--------|-------|
| Skinning system per-frame time | < 2ms for 10 skinned meshes | LBS (Linear Blend Skinning) — O(vertices × bones_per_vertex) |
| Maximum vertices per skinned mesh | 2000 | Above this, warn and suggest LOD |
| Maximum bones influencing one vertex | 4 | Standard LBS limit; extra influences are discarded |
| Init time (`init_skinned_meshes_2d`) | < 5ms per mesh | Run once on first frame or after attachment change |
| Mesh attachment payload size | < 50KB JSON | Typical character sprite: ~200 vertices, 4 bones |
| Re-init after attachment change | < 16ms (one frame) | `SkinnedMeshInitialized` removal triggers re-init next frame |

### Custom WGSL Mega-Shader (Limitation 6)

| Metric | Target | Notes |
|--------|--------|-------|
| WGSL validation time (naga) | < 100ms | naga parses and validates synchronously |
| Shader recompilation time | < 300ms | Bevy recompiles GPU pipeline on shader asset change |
| Loading indicator threshold | > 50ms | Show spinner if compilation takes longer than 50ms |
| Maximum custom shader slots | 8 | Expandable later via additional uniform blocks |
| Maximum parameters per shader | 16 floats | Packed into `custom_params[16]` uniform array |
| Maximum WGSL source size | 64KB | Enforced server-side before naga validation |
| Entity shader switch latency | < 1ms | Uniform update only — no pipeline recompile |

### Docs Fixes (Limitations 1 and 3)

| Metric | Target | Notes |
|--------|--------|-------|
| Doc page load time | < 1s | No change — static markdown |
| known-limitations.md accuracy | 100% | Zero stale entries after this spec is implemented |

---

## Implementation Order

| # | Limitation | Type | Effort | Depends On |
|---|-----------|------|--------|------------|
| 1 | 2D Joints (docs fix) | Docs only | 10 min | — |
| 2 | LOD Decimation (docs fix) | Docs only | 10 min | — |
| 3 | Audio Occlusion (graduated) | Web only | < 1 day | — |
| 4 | 2D Vertex Skinning (mesh attach) | Rust + Web | 1-2 days | — |
| 5 | Custom WGSL (mega-shader) | Rust + Web + WGSL | 3-5 days | — |

All 5 are independent — no ordering dependencies. Recommended: fix docs first (1, 2), then ship audio (3), then vertex skinning (4), then mega-shader (5).

---

## Ticket Plan

### Ticket A: Update Known Limitations Documentation
- Fix 2D Joints entry (move to Working)
- Fix LOD entry (mark as complete)
- Update last-updated date
- Priority: Medium, Effort: Trivial

### Ticket B: Graduated Audio Occlusion via Raycasting
- Replace binary occlusion with distance-based graduated amount
- Update tests
- Update docs
- Priority: Medium, Effort: Small

### Ticket C: Enable 2D Vertex Skinning (Mesh Attachment Pipeline)
- Add `add_skeleton2d_mesh_attachment` command
- Add pending request + bridge apply system
- Add MCP manifest entry + chat handler
- Remove `SkinnedMeshInitialized` guard on attachment add
- Add tests
- Update docs
- Priority: High, Effort: Medium

### Ticket D: Mega-Shader for Custom WGSL Effects
- `CustomShaderRegistry` resource with 8 slots
- naga validation
- Shader stitching + hot-reload
- 3 new commands (register, apply, remove)
- Visual node editor integration
- Inspector UI updates
- MCP manifest
- Tests
- Update docs
- Priority: High, Effort: Large
