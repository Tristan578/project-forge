# PF-133: Integrate Mesh Decimation for Automatic LOD Generation

**Date:** 2026-03-09
**Status:** Draft
**Ticket:** PF-133

---

## Problem Statement

The LOD system (Phase 31) has all the plumbing in place -- `LodData`/`LodMeshes` ECS components, distance-based LOD switching in `update_lod_levels`, a `generate_lods` command, and a web-side `LodInspector`. However, the actual mesh simplification currently uses a hand-rolled 783-line QEM (Garland-Heckbert) implementation in `engine/src/core/mesh_simplify.rs` that has several limitations:

1. **UV destruction**: Simplified meshes get trivial planar-projected UVs (`[p[0]*0.5+0.5, p[2]*0.5+0.5]`), destroying original texture mapping.
2. **No attribute interpolation**: Normals are recomputed flat; vertex colors, tangents, and other attributes are discarded.
3. **No topology awareness**: No seam preservation, no boundary locking, no attribute-weighted error metrics.
4. **No vertex cache optimization**: Simplified meshes have arbitrary index order, missing GPU cache-friendly reordering.
5. **Performance**: Pure Rust QEM with `BinaryHeap` + `HashSet` per-collapse is adequate but not optimal for large meshes.

The `docs/known-limitations.md` explicitly calls out that `generate_lods` and `optimize_scene` require a mesh decimation library not yet integrated.

## Research Summary: Library Options

### Option A: `meshopt` crate (gwihlidal/meshopt-rs) -- FFI wrapper around C++ meshoptimizer

- **Pros**: Industry-standard quality (Unreal, Unity use meshoptimizer), seam preservation, attribute-aware simplification, vertex cache optimization, overdraw optimization, vertex fetch optimization -- all in one crate.
- **Cons**: Links to C++ via `cc` build crate. Building C++ for `wasm32-unknown-unknown` is fragile -- requires clang with WASM target support and historically has had version-specific breakages. The `cc` crate does support it, but it adds a C++ toolchain requirement to the build.
- **WASM verdict**: **Feasible but brittle.** The `cc` crate can compile C++ to WASM when `clang` with WASM support is available (which `build_wasm.ps1` already requires for `csgrs` via `parry3d`/`nalgebra`). However, meshoptimizer's C++ code is self-contained (no stdlib deps beyond `<assert.h>`, `<math.h>`, `<string.h>`, `<float.h>`), making it a good candidate for WASM cross-compilation.

### Option B: `meshopt-rs` crate (yzsolt/meshopt-rs) -- Pure Rust port of meshoptimizer

- **Pros**: Pure Rust, no FFI, would compile to WASM trivially.
- **Cons**: Explicitly states WASM support is "planned but missing." 10-50% slower than C++ original. Not all v1.0 features ported. Low maintenance activity. The "missing WASM support" note likely refers to WASM-specific optimizations (SIMD), not compilation -- pure Rust should compile fine to `wasm32-unknown-unknown`.
- **WASM verdict**: **Should work.** Pure Rust compiles to WASM. The "missing WASM" note in the README refers to WASM SIMD optimizations, not compilation compatibility.

### Option C: `baby_shark` crate -- Pure Rust geometry processing

- **Pros**: Pure Rust, has incremental edge decimation with adaptive error bounding.
- **Cons**: General-purpose geometry library, not optimized for game engine LOD. Uses half-edge data structure which requires converting to/from Bevy's index buffer format. No vertex cache optimization. Low adoption.
- **WASM verdict**: **Works.** Pure Rust, no FFI.

### Option D: Improve existing QEM implementation (no new dependency)

- **Pros**: Zero new dependencies, full control, no WASM compatibility risk.
- **Cons**: Significant engineering effort to match meshoptimizer quality. UV interpolation, seam detection, boundary preservation, and vertex cache optimization are each non-trivial features.

## Recommended Approach: Hybrid (Option B primary, Option D fallback)

**Use `meshopt-rs` (yzsolt, pure Rust port) as the primary simplification backend**, with the existing QEM as a fallback. Rationale:

1. Pure Rust guarantees WASM compilation without toolchain complexity.
2. meshoptimizer's simplification algorithm is topology-aware and seam-preserving.
3. The crate also provides vertex cache optimization and overdraw optimization -- bonus features.
4. If `meshopt-rs` proves too slow or buggy at aggressive ratios, the existing QEM serves as fallback.
5. The abstraction layer we build makes it trivial to swap in Option A (`meshopt` FFI) later if C++ WASM builds become more reliable.

**Key risk**: `meshopt-rs` may not preserve UVs/normals through simplification either (meshoptimizer operates on index buffers referencing existing vertices, which inherently preserves attributes). This is actually a **major advantage** over the current QEM -- meshoptimizer's `simplify()` returns a new index buffer referencing original vertices, so all attributes (UVs, normals, colors, tangents) are preserved automatically.

---

## Architecture

### New Abstraction: `MeshSimplifier` trait

```
engine/src/core/mesh_simplify.rs  (existing, will be refactored)
```

Introduce a `MeshSimplifier` trait so the LOD system is decoupled from any specific algorithm:

```rust
pub trait MeshSimplifier {
    fn simplify(&self, mesh: &Mesh, target_ratio: f32) -> Mesh;
    fn name(&self) -> &'static str;
}
```

Two implementations:
- `MeshoptSimplifier` -- delegates to `meshopt-rs` crate
- `QemSimplifier` -- wraps the existing QEM code (renamed from `simplify_mesh`)

A `SimplificationBackend` resource selects which implementation to use at runtime.

### Data Flow (unchanged at bridge/command level)

```
LodInspector "Generate LOD Meshes" button
  -> dispatchToEngine('generate_lods', { entityId })
  -> handle_command -> pending.generate_lods_requests
  -> apply_lod_commands (bridge/performance.rs)
     -> SimplificationBackend::simplify(mesh, ratio)  // <-- NEW dispatch point
     -> meshes.add(simplified) -> LodMeshes.levels[i]
```

### Auto-LOD on GLTF Import

New opt-in field on `LodData` (`auto_generate: true`) triggers `regenerate_missing_lod_meshes` to generate LODs when a mesh entity appears without `LodMeshes`. This system already exists and works -- it just needs the better simplifier.

### Files Changed

| File | Change |
|------|--------|
| `engine/Cargo.toml` | Add `meshopt-rs` dependency |
| `engine/src/core/mesh_simplify.rs` | Add `MeshSimplifier` trait, `MeshoptSimplifier`, rename existing code to `QemSimplifier` |
| `engine/src/core/lod.rs` | Add `SimplificationBackend` resource |
| `engine/src/bridge/performance.rs` | Use `SimplificationBackend` resource instead of direct `mesh_simplify::simplify_mesh` call |
| `engine/src/bridge/mod.rs` | Register `SimplificationBackend` as resource |
| `engine/src/core/commands/procedural.rs` | Add `set_simplification_backend` command |
| `engine/src/core/pending/performance.rs` | Add `SetSimplificationBackendRequest` |
| `web/src/components/editor/LodInspector.tsx` | Add backend selector dropdown |
| `web/src/stores/slices/types.ts` | Add `simplificationBackend` field to store types |

---

## Implementation Plan

### Step 1: Add `meshopt-rs` dependency and verify WASM compilation

**Goal**: Confirm that `meshopt-rs` compiles for `wasm32-unknown-unknown` before writing any integration code.

**Files**:
- `engine/Cargo.toml`

**Tasks**:
1. Add dependency: `meshopt-rs = "0.2"` (check latest version on crates.io; the crate name on crates.io may be `meshopt-rs` or `meshopt_rs`).
2. Add a trivial usage in a test to force compilation.
3. Run `cargo check --target wasm32-unknown-unknown` from the engine directory to verify it compiles.

**Verification**:
```bash
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
```

**Commit point**: "chore: add meshopt-rs dependency and verify WASM compilation"

**Edge cases**:
- If `meshopt-rs` pulls in a `std` dependency that does not compile on WASM (e.g., `std::time`), we may need to pin a version or fork.
- If the crate name on crates.io differs from the GitHub repo name, adjust accordingly. Check `https://crates.io/crates/meshopt-rs`.
- If `meshopt-rs` does NOT compile for wasm32, fall back to Option D (improve existing QEM) and skip Steps 2-4, proceeding directly to Step 5.

---

### Step 2: Introduce `MeshSimplifier` trait and refactor existing QEM

**Goal**: Create the abstraction layer without changing behavior. All existing tests must still pass.

**Files**:
- `engine/src/core/mesh_simplify.rs`
- `engine/src/core/lod.rs`

**Tasks**:

1. In `mesh_simplify.rs`, define:
```rust
/// Trait abstracting mesh simplification algorithms.
pub trait MeshSimplifier: Send + Sync {
    /// Simplify the mesh to approximately `target_ratio` of its original triangle count.
    /// Returns a new mesh. If simplification is not possible, returns a clone.
    fn simplify(&self, mesh: &Mesh, target_ratio: f32) -> Mesh;

    /// Human-readable name for logging/UI.
    fn name(&self) -> &'static str;
}
```

2. Wrap the existing `simplify_mesh` function in a `QemSimplifier` struct:
```rust
pub struct QemSimplifier;

impl MeshSimplifier for QemSimplifier {
    fn simplify(&self, mesh: &Mesh, target_ratio: f32) -> Mesh {
        simplify_mesh(mesh, target_ratio)
    }
    fn name(&self) -> &'static str { "QEM (Garland-Heckbert)" }
}
```

3. In `lod.rs`, add a resource to hold the active simplifier:
```rust
#[derive(Resource)]
pub struct SimplificationBackend {
    pub backend: Box<dyn MeshSimplifier>,
}

impl Default for SimplificationBackend {
    fn default() -> Self {
        Self { backend: Box::new(mesh_simplify::QemSimplifier) }
    }
}
```

4. Keep `simplify_mesh` as a public function (existing call sites still work during migration).

**Verification**:
```bash
cd engine && cargo test --lib
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
```

**Commit point**: "refactor: introduce MeshSimplifier trait and QemSimplifier wrapper"

**Edge cases**:
- `dyn MeshSimplifier` requires `Send + Sync` for Bevy resource safety. Both implementations are stateless so this is trivially satisfied.
- The `Default` impl for `SimplificationBackend` ensures backwards compatibility -- if nobody sets a backend, QEM is used.

---

### Step 3: Implement `MeshoptSimplifier` using meshopt-rs

**Goal**: Create the meshopt-rs-backed simplifier that preserves vertex attributes.

**Files**:
- `engine/src/core/mesh_simplify.rs`

**Tasks**:

1. Add `MeshoptSimplifier` struct:
```rust
pub struct MeshoptSimplifier;
```

2. Implement `MeshSimplifier` for it. The key difference from QEM: meshoptimizer's `simplify()` takes positions + indices and returns a new index buffer referencing the SAME vertex positions. This means all vertex attributes (UVs, normals, tangents, colors) are automatically preserved.

3. The implementation must:
   - Extract positions as `&[f32]` (flattened `[f32; 3]` -> `&[f32]` with stride 12)
   - Extract indices as `&[u32]`
   - Call `meshopt_rs::simplify::simplify()` (or equivalent API -- verify exact function name from docs)
   - Build a new Bevy `Mesh` with the simplified index buffer and compacted vertex attributes
   - Compact unused vertices (vertices no longer referenced by any index) to save memory

4. Write unit tests comparing meshopt output vs QEM output on the same grid mesh:
   - Triangle count should be in similar range
   - meshopt output should have valid UVs (not planar-projected)
   - All indices should reference valid vertices

**Verification**:
```bash
cd engine && cargo test mesh_simplify --lib
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
```

**Commit point**: "feat: implement MeshoptSimplifier using meshopt-rs with attribute preservation"

**Edge cases**:
- meshopt-rs API may differ from meshoptimizer C++ API. Check `docs.rs/meshopt-rs` for exact signatures.
- If meshopt-rs's simplify function requires a `target_index_count` (absolute) instead of a ratio, compute it as `(original_index_count as f32 * target_ratio) as usize`.
- The vertex compaction step is critical for memory -- without it, LOD3 at 10% triangles still stores 100% of vertices.
- meshopt-rs may not have a `simplify` function at all if that feature is not yet ported. In that case, use the `simplify_sloppy` variant or fall back to QEM for now.

---

### Step 4: Wire `SimplificationBackend` into the LOD pipeline

**Goal**: Replace direct `mesh_simplify::simplify_mesh` calls with the backend resource.

**Files**:
- `engine/src/bridge/performance.rs`
- `engine/src/bridge/mod.rs`

**Tasks**:

1. In `bridge/mod.rs`, register the resource:
```rust
.init_resource::<core::lod::SimplificationBackend>()
```

2. In `bridge/performance.rs`, modify `apply_lod_commands`:
   - Add `backend: Res<SimplificationBackend>` system parameter
   - Replace `mesh_simplify::simplify_mesh(&original_mesh, ratio)` with `backend.backend.simplify(&original_mesh, ratio)`

3. In `bridge/performance.rs`, modify `regenerate_missing_lod_meshes`:
   - Add `backend: Res<SimplificationBackend>` system parameter
   - Replace `mesh_simplify::simplify_mesh(&original_mesh, ratio)` with `backend.backend.simplify(&original_mesh, ratio)`

4. Check system parameter count after adding `Res<SimplificationBackend>` -- both systems are under the 16-param limit.

**Verification**:
```bash
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
```

**Commit point**: "feat: wire SimplificationBackend resource into LOD generation pipeline"

**Edge cases**:
- `apply_lod_commands` already has 5 system params (Commands, ResMut<PendingCommands>, Query, Query, ResMut<Assets<Mesh>>). Adding `Res<SimplificationBackend>` makes 6 -- well within the 16-param limit.
- `regenerate_missing_lod_meshes` has 4 params. Adding one makes 5.

---

### Step 5: Add `set_simplification_backend` command

**Goal**: Allow switching between QEM and meshopt at runtime via JSON command.

**Files**:
- `engine/src/core/pending/performance.rs`
- `engine/src/core/commands/procedural.rs` (or create a new `performance.rs` commands module)
- `engine/src/bridge/performance.rs`

**Tasks**:

1. Add request struct in `pending/performance.rs`:
```rust
#[derive(Debug, Clone)]
pub struct SetSimplificationBackendRequest {
    pub backend: String,  // "qem" or "meshopt"
}
```

2. Add queue method and bridge function.

3. Add command handler dispatching on `"set_simplification_backend"`.

4. In `apply_lod_commands` (or a new system), process the request:
```rust
for request in pending.set_simplification_backend_requests.drain(..) {
    match request.backend.as_str() {
        "meshopt" => backend.backend = Box::new(mesh_simplify::MeshoptSimplifier),
        "qem" | _ => backend.backend = Box::new(mesh_simplify::QemSimplifier),
    }
}
```

5. Emit an event so the UI can confirm the switch.

**Verification**:
```bash
cd engine && cargo test --lib
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
```

**Commit point**: "feat: add set_simplification_backend command for runtime algorithm switching"

---

### Step 6: Update LodInspector UI

**Goal**: Add a dropdown to select simplification backend and show which algorithm is active.

**Files**:
- `web/src/components/editor/LodInspector.tsx`

**Tasks**:

1. Add a `<select>` dropdown above the "Generate LOD Meshes" button with options: "meshopt (recommended)" and "QEM (legacy)".
2. On change, dispatch `set_simplification_backend` command.
3. Update the status message after generation to include which backend was used.
4. Default selection: "meshopt".

**Verification**:
```bash
cd web && npx eslint --max-warnings 0 .
cd web && npx tsc --noEmit
cd web && npx vitest run
```

**Commit point**: "feat: add simplification backend selector to LodInspector"

---

### Step 7: Add auto-LOD toggle for GLTF import

**Goal**: When importing a GLTF model, optionally auto-generate LODs.

**Files**:
- `engine/src/core/pending/scene.rs` (GltfImportRequest)
- `engine/src/bridge/scene_io.rs` (apply_gltf_scene_spawn)
- `web/src/components/editor/LodInspector.tsx` or a new import settings panel

**Tasks**:

1. Add `auto_lod: bool` field to `GltfImportRequest` (default `false`).
2. In `apply_gltf_scene_spawn`, when spawning mesh entities from a GLTF, if `auto_lod` is true, also insert `LodData { auto_generate: true, ..Default::default() }`.
3. The existing `regenerate_missing_lod_meshes` system will detect entities with `LodData { auto_generate: true }` but no `LodMeshes` and generate them next frame.
4. Update the GLTF import UI (if one exists) or add a checkbox to the asset panel import flow.

**Verification**:
```bash
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
cd web && npx eslint --max-warnings 0 .
cd web && npx tsc --noEmit
```

**Commit point**: "feat: add auto-LOD generation option for GLTF imports"

**Edge cases**:
- Large GLTF models with many mesh entities could cause a frame spike when all LODs generate simultaneously. Consider a throttling mechanism (max N LOD generations per frame) in `regenerate_missing_lod_meshes`.
- GLTF models that already include LOD levels (via `MSFT_lod` extension) should not get auto-LOD applied on top.

---

### Step 8: Add vertex cache optimization pass (bonus)

**Goal**: After simplification, reorder indices for GPU vertex cache efficiency.

**Files**:
- `engine/src/core/mesh_simplify.rs`

**Tasks**:

1. If `meshopt-rs` exposes `optimize_vertex_cache()`, call it on the simplified index buffer before building the output mesh.
2. This is a post-processing step that applies to both the meshopt and QEM backends.
3. Add it as an optional step controlled by a flag on `LodData` (default: `true` for meshopt backend, `false` for QEM since QEM output has arbitrary topology anyway).

**Verification**:
```bash
cd engine && cargo test mesh_simplify --lib
```

**Commit point**: "feat: add vertex cache optimization pass to LOD generation"

---

### Step 9: Update MCP commands and documentation

**Goal**: Update commands.json and known-limitations.md.

**Files**:
- `mcp-server/manifest/commands.json`
- `web/src/data/commands.json`
- `docs/known-limitations.md`

**Tasks**:

1. Add `set_simplification_backend` to commands.json.
2. Copy to `web/src/data/commands.json`.
3. Update `docs/known-limitations.md` to remove the "mesh decimation not available" limitation and note that meshopt-rs is now integrated.

**Verification**:
```bash
cd mcp-server && npx vitest run
cd web && npx eslint --max-warnings 0 .
```

**Commit point**: "docs: update MCP commands and remove LOD decimation limitation"

---

### Step 10: Full verification

**Verification suite**:
```bash
cd engine && cargo test --lib
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
cd web && npx eslint --max-warnings 0 .
cd web && npx tsc --noEmit
cd web && npx vitest run
cd mcp-server && npx vitest run
```

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `meshopt-rs` does not compile for `wasm32-unknown-unknown` | Low (pure Rust) | High | Step 1 validates this upfront. Fallback: improve existing QEM (Step 5 becomes primary work) |
| `meshopt-rs` simplify API is not yet ported | Medium | High | Check docs.rs before starting Step 3. If missing, use `simplify_sloppy` or fall back to QEM |
| Frame spike on bulk LOD generation (large GLTF) | Medium | Medium | Add throttle in `regenerate_missing_lod_meshes` (max 3 entities per frame) |
| WASM binary size increase from meshopt-rs | Low | Low | meshoptimizer algorithms are compact; expect <100KB increase. Profile with `wasm-opt -Oz` |
| `meshopt-rs` crate is unmaintained | Medium | Low | Pure Rust code; we can fork and maintain if needed. The algorithms are well-documented |

## WASM Memory Considerations

The 4GB WASM memory limit is relevant here. LOD generation temporarily requires:
- Original mesh vertex/index data (already loaded)
- Simplified mesh vertex/index data (new allocation)
- meshopt-rs internal working buffers

For a 1M triangle mesh (~36MB vertex data), LOD generation adds ~36MB temporary allocation per level. Generating 3 LOD levels simultaneously could require ~108MB temporary. This is well within the 4GB limit but should be noted for very large scenes. The throttling mechanism in Step 7 mitigates this.

## State Separation

- **Rust (ECS)**: `LodData`, `LodMeshes`, `SimplificationBackend` -- all engine-side
- **React (Zustand)**: `lodLevels` map (entity ID -> current LOD level), backend selection UI state
- **No new bridge events needed** -- existing `lod_changed` event is sufficient

---

## Open Questions (for spec review)

1. Should we expose simplification quality metrics (Hausdorff distance, PSNR) in the LOD inspector? This would help users evaluate LOD quality but adds complexity.
2. Should the backend selection be per-project or global? Currently proposed as global (Bevy resource).
3. Should we add a "preview LOD" mode that lets users see each LOD level in the viewport without changing camera distance?
