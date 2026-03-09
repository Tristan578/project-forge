# PF-140: Mega-Shader Approach for Arbitrary Custom WGSL Shaders

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to write arbitrary WGSL fragment shader code that runs in the engine, extending the existing `ForgeShaderExtension` / `ForgeMaterial` system with a user-code injection pipeline. The user writes a WGSL function body that receives PBR output + uniforms and returns a modified color, which gets compiled into the mega-shader at runtime.

**Architecture:** User WGSL code is stored as a string in the ECS component (`CustomWgslData`), validated on the JS side via `naga` (WASM build) or regex heuristics, then sent to Rust where it is injected into a parameterized WGSL template, compiled as a new `MaterialExtension`, and hot-swapped onto the entity.

**Tech Stack:** Rust (Bevy 0.18 + wgpu/naga), TypeScript, Zustand, vitest

**CRITICAL: Commit your work after every logical chunk (test file, feature, etc.). Do not accumulate uncommitted changes -- rate limits can terminate you at any time.**

---

## Critical Design Decisions

### 1. Why NOT naga-based validation in WASM

`naga` is a transitive dependency via `bevy -> wgpu`, but it is NOT re-exported for user consumption. Adding `naga` as a direct dependency would:
- Increase WASM binary size significantly (~500KB+)
- Create version conflicts with wgpu's pinned naga version
- Require exposing naga's `Module` parsing API through wasm-bindgen

**Decision:** Validate WGSL on the Rust side using Bevy's shader compilation pipeline. If the shader fails to compile, catch the error via `Assets<Shader>` error events and report back to JS. On the JS side, use lightweight heuristic validation only (balanced braces, no `@group`/`@binding` redefinitions, no infinite loops).

### 2. Shader Injection Strategy

The existing `forge_effects.wgsl` uses a branching mega-shader with `shader_type` integer dispatch. For arbitrary user code, we introduce a **separate material type** rather than extending the existing mega-shader. This avoids:
- Bloating the existing shader with user code that changes per-entity
- Recompiling the shared shader every time any entity's code changes
- Uniform buffer layout instability

**Decision:** Create `CustomWgslMaterial` (a new `ExtendedMaterial<StandardMaterial, CustomWgslExtension>`) that is distinct from `ForgeMaterial`. Each entity with custom WGSL gets its own material asset with the user's code baked into the fragment shader source.

### 3. Uniform Passing

User shaders get a fixed set of available uniforms via a `ForgeUserUniforms` struct at binding 101:
- `time: f32` -- elapsed seconds
- `user_params: array<f32, 16>` -- 16 float slots the user can name/map from the inspector
- `user_color: vec4<f32>` -- primary color parameter
- `resolution: vec2<f32>` -- viewport resolution

This keeps the uniform layout stable across all user shaders while giving enough flexibility for most effects.

### 4. WASM Memory Constraint

Each compiled shader material is a separate asset. We cap the number of unique custom WGSL materials per scene at **32** to avoid memory pressure. The 4GB WASM limit means we cannot have unbounded shader variants.

### 5. WebGL2 Compatibility

Custom WGSL shaders are **WebGPU only**. WebGL2 uses GLSL, not WGSL. On WebGL2, entities with `CustomWgslData` fall back to standard PBR rendering. The component data is preserved for save/load but not rendered.

---

## Task Breakdown

### Task 1: ECS Component -- `CustomWgslData`

**Files:**
- Create: `engine/src/core/custom_wgsl.rs`
- Modify: `engine/src/core/mod.rs` (add `pub mod custom_wgsl;`)

**Step 1: Define the component struct**

```rust
// engine/src/core/custom_wgsl.rs

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Maximum number of unique custom WGSL materials per scene.
pub const MAX_CUSTOM_WGSL_MATERIALS: usize = 32;

/// Maximum WGSL source code length in bytes (64KB).
pub const MAX_WGSL_SOURCE_LENGTH: usize = 65_536;

/// Number of user-configurable float parameters.
pub const USER_PARAM_COUNT: usize = 16;

/// Serializable custom WGSL shader data stored as an ECS component.
/// The user_code field contains a WGSL function body that receives:
///   - `base_color: vec4<f32>` -- PBR lit output color
///   - `world_pos: vec3<f32>` -- fragment world position
///   - `world_normal: vec3<f32>` -- fragment world normal
///   - `uv: vec2<f32>` -- texture coordinates
///   - `time: f32` -- elapsed time in seconds
///   - `user_params: array<f32, 16>` -- user-configurable float params
///   - `user_color: vec4<f32>` -- user-configurable color
/// and must return `vec4<f32>` (the final fragment color).
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomWgslData {
    /// User-authored WGSL function body.
    pub user_code: String,

    /// Human-readable name for this shader.
    pub name: String,

    /// Whether this custom shader is active (vs bypassed to standard PBR).
    pub enabled: bool,

    /// 16 user-configurable float parameters.
    /// Inspector maps named labels to indices.
    #[serde(default = "default_user_params")]
    pub user_params: [f32; USER_PARAM_COUNT],

    /// Labels for user_params slots (empty string = unused).
    #[serde(default = "default_param_labels")]
    pub param_labels: Vec<String>,

    /// Primary user color parameter.
    #[serde(default = "default_user_color")]
    pub user_color: [f32; 4],

    /// Compilation status: "ok", "error", or "pending".
    #[serde(default = "default_status")]
    pub compile_status: String,

    /// Error message from last compilation attempt.
    #[serde(default)]
    pub compile_error: Option<String>,
}

fn default_user_params() -> [f32; USER_PARAM_COUNT] { [0.0; USER_PARAM_COUNT] }
fn default_param_labels() -> Vec<String> { vec![String::new(); USER_PARAM_COUNT] }
fn default_user_color() -> [f32; 4] { [1.0, 1.0, 1.0, 1.0] }
fn default_status() -> String { "pending".to_string() }

impl Default for CustomWgslData {
    fn default() -> Self {
        Self {
            user_code: "return base_color;".to_string(),
            name: "Custom Shader".to_string(),
            enabled: true,
            user_params: default_user_params(),
            param_labels: default_param_labels(),
            user_color: default_user_color(),
            compile_status: default_status(),
            compile_error: None,
        }
    }
}
```

**Step 2: Register module in core/mod.rs**

Add `pub mod custom_wgsl;` alongside the other module declarations.

**Verify:** `cargo check --target wasm32-unknown-unknown` (just the struct, no systems yet)

**Commit:** "feat(engine): add CustomWgslData ECS component for arbitrary WGSL shaders"

---

### Task 2: GPU Extension + WGSL Template

**Files:**
- Modify: `engine/src/core/custom_wgsl.rs` (add GPU types)
- Create: `engine/src/shaders/custom_wgsl_template.wgsl`

**Step 1: Add the GPU bind group struct**

```rust
// Add to engine/src/core/custom_wgsl.rs

use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::render::render_resource::AsBindGroup;
use bevy::shader::{Shader, ShaderRef};

/// GPU uniform block for user shaders.
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct CustomWgslExtension {
    #[uniform(101)]
    pub time: f32,
    #[uniform(101)]
    pub user_params: [f32; USER_PARAM_COUNT],
    #[uniform(101)]
    pub user_color: Vec4,
    #[uniform(101)]
    pub resolution: Vec2,
}

impl Default for CustomWgslExtension {
    fn default() -> Self {
        Self {
            time: 0.0,
            user_params: [0.0; USER_PARAM_COUNT],
            user_color: Vec4::ONE,
            resolution: Vec2::new(1920.0, 1080.0),
        }
    }
}

/// Type alias for user custom WGSL material.
pub type CustomWgslMaterial = ExtendedMaterial<StandardMaterial, CustomWgslExtension>;
```

**Step 2: Create the WGSL template**

The template file is a complete WGSL shader that includes a `USER_CODE_INJECTION_POINT` marker. At runtime, the Rust code replaces this marker with the user's function body.

```wgsl
// engine/src/shaders/custom_wgsl_template.wgsl

#import bevy_pbr::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::alpha_discard,
    mesh_view_bindings::view,
}

#ifdef PREPASS_PIPELINE
#import bevy_pbr::{
    prepass_io::{VertexOutput, FragmentOutput},
    pbr_deferred_functions::deferred_output,
}
#else
#import bevy_pbr::{
    forward_io::{VertexOutput, FragmentOutput},
    pbr_functions::{apply_pbr_lighting, main_pass_post_lighting_processing},
}
#endif

struct ForgeUserUniforms {
    time: f32,
    user_params: array<f32, 16>,
    user_color: vec4<f32>,
    resolution: vec2<f32>,
}

@group(2) @binding(101)
var<uniform> forge_user: ForgeUserUniforms;

// --- User-authored effect function ---
// Inputs:
//   base_color: vec4<f32>  - PBR lit output
//   world_pos: vec3<f32>   - fragment world position
//   world_normal: vec3<f32> - fragment normal (normalized)
//   uv: vec2<f32>          - texture coordinates
//   time: f32              - elapsed time in seconds
//   user_params: array<f32, 16> - user float params
//   user_color: vec4<f32>  - user color param
// Must return: vec4<f32>

fn user_effect(
    base_color: vec4<f32>,
    world_pos: vec3<f32>,
    world_normal: vec3<f32>,
    uv: vec2<f32>,
    time: f32,
    user_params: array<f32, 16>,
    user_color: vec4<f32>,
) -> vec4<f32> {
    // USER_CODE_INJECTION_POINT
    return base_color;
}

@fragment
fn fragment(
    in: VertexOutput,
    @builtin(front_facing) is_front: bool,
) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    var out: FragmentOutput;

    #ifdef PREPASS_PIPELINE
        out = deferred_output(in, pbr_input);
    #else
        out.color = apply_pbr_lighting(pbr_input);
        out.color = main_pass_post_lighting_processing(pbr_input, out.color);

        out.color = user_effect(
            out.color,
            in.world_position.xyz,
            pbr_input.N,
            in.uv,
            forge_user.time,
            forge_user.user_params,
            forge_user.user_color,
        );
    #endif

    return out;
}
```

**IMPORTANT:** The `MaterialExtension` implementation for `CustomWgslExtension` cannot use a static `ShaderRef` since each entity needs different injected code. Instead, we will handle shader creation dynamically per-entity in the bridge system (Task 4). The `MaterialExtension` trait impl returns a placeholder handle that gets overridden when the material asset is created.

**Verify:** File parses as valid WGSL structure (manual review). Rust structs compile.

**Commit:** "feat(engine): add CustomWgslExtension GPU type and WGSL template"

---

### Task 3: Pending Commands + Command Dispatch

**Files:**
- Modify: `engine/src/core/pending/material.rs` (add request structs + queue methods)
- Modify: `engine/src/core/pending/mod.rs` (add fields to PendingCommands)
- Modify: `engine/src/core/commands/material.rs` (add command handlers)

**Step 1: Add pending request types**

```rust
// Add to engine/src/core/pending/material.rs

pub struct CustomWgslUpdate {
    pub entity_id: String,
    pub data: CustomWgslData,
}

pub struct CustomWgslRemoval {
    pub entity_id: String,
}

pub struct CustomWgslParamUpdate {
    pub entity_id: String,
    pub user_params: Option<[f32; 16]>,
    pub user_color: Option<[f32; 4]>,
    pub enabled: Option<bool>,
}
```

**Step 2: Add queue fields to PendingCommands**

In `pending/mod.rs`:
```rust
pub custom_wgsl_updates: Vec<CustomWgslUpdate>,
pub custom_wgsl_removals: Vec<CustomWgslRemoval>,
pub custom_wgsl_param_updates: Vec<CustomWgslParamUpdate>,
```

**Step 3: Add queue methods and bridge functions**

Standard pattern: `queue_custom_wgsl_update`, `queue_custom_wgsl_removal`, `queue_custom_wgsl_param_update` methods on `PendingCommands`, plus `queue_*_from_bridge` free functions using `with_pending`.

**Step 4: Add command handlers**

In `commands/material.rs`, add dispatch entries:
- `"set_custom_wgsl"` -> `handle_set_custom_wgsl`
- `"update_custom_wgsl_params"` -> `handle_update_custom_wgsl_params`
- `"remove_custom_wgsl"` -> `handle_remove_custom_wgsl`
- `"validate_wgsl"` -> `handle_validate_wgsl` (lightweight, checks length + basic structure)

**Payload for `set_custom_wgsl`:**
```json
{
  "entityId": "uuid",
  "userCode": "let wave = sin(uv.x * 10.0 + time);\nreturn vec4(base_color.rgb * wave, 1.0);",
  "name": "Wave Effect",
  "paramLabels": ["waveFreq", "waveAmp", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  "userParams": [10.0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "userColor": [1, 0.5, 0.2, 1]
}
```

**Payload for `update_custom_wgsl_params`:**
```json
{
  "entityId": "uuid",
  "userParams": [10.0, 2.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "userColor": [1, 0, 0, 1],
  "enabled": true
}
```

**Payload for `validate_wgsl`:**
```json
{
  "code": "return vec4(1.0);"
}
```
Returns `{ "valid": true }` or `{ "valid": false, "error": "..." }`.

**Validation rules (Rust side, in `handle_validate_wgsl`):**
1. Length must not exceed `MAX_WGSL_SOURCE_LENGTH` (64KB)
2. Must not contain `@group` or `@binding` (prevents uniform hijacking)
3. Must not contain `textureStore` or `atomicStore` (prevents write-to-texture attacks)
4. Must not redefine `fn fragment` or `fn vertex`
5. Balanced braces `{}`

**Verify:** `cargo check --target wasm32-unknown-unknown`

**Commit:** "feat(engine): add custom WGSL pending commands and dispatch handlers"

---

### Task 4: Bridge System -- Shader Compilation + Hot-Swap

**Files:**
- Modify: `engine/src/bridge/material.rs` (add apply systems)
- Modify: `engine/src/bridge/mod.rs` (register systems)
- Modify: `engine/src/bridge/events.rs` (add emit function)

**Step 1: Add the shader compilation system**

This is the core of the feature. The system:
1. Drains `custom_wgsl_updates` from `PendingCommands`
2. For each update, reads the WGSL template via `include_str!`
3. Replaces `USER_CODE_INJECTION_POINT` with the user's code
4. Creates a new `Shader` asset from the composed source
5. Creates a `CustomWgslExtension` with a `ShaderRef` pointing to the new shader
6. Wraps in `ExtendedMaterial<StandardMaterial, CustomWgslExtension>`
7. Swaps the entity's `MeshMaterial3d` to the new material
8. On compilation success, updates `CustomWgslData.compile_status = "ok"`
9. On failure (detected next frame via shader pipeline error), sets `compile_status = "error"`

```rust
// In bridge/material.rs

/// System that compiles and applies custom WGSL shader updates.
/// WebGPU only -- on WebGL2 this system is a no-op.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_custom_wgsl_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId, Option<&CustomWgslData>)>,
    std_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<StandardMaterial>, &MaterialData)>,
    ext_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<CustomWgslMaterial>)>,
    std_materials: Res<Assets<StandardMaterial>>,
    mut custom_materials: ResMut<Assets<CustomWgslMaterial>>,
    mut shaders: ResMut<Assets<Shader>>,
    mut history: ResMut<HistoryStack>,
) {
    const TEMPLATE: &str = include_str!("../shaders/custom_wgsl_template.wgsl");

    for update in pending.custom_wgsl_updates.drain(..) {
        let found = entity_query.iter().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, old_data)) = found else { continue; };

        let old_data_clone = old_data.cloned();

        // Compose the final WGSL source
        let composed = TEMPLATE.replace(
            "// USER_CODE_INJECTION_POINT\n    return base_color;",
            &update.data.user_code,
        );

        // Create shader asset
        let shader_handle = shaders.add(Shader::from_wgsl(
            composed,
            format!("custom_wgsl_{}", update.entity_id),
        ));

        // Build extension with user params
        let extension = CustomWgslExtension {
            time: 0.0,
            user_params: update.data.user_params,
            user_color: Vec4::from_array(update.data.user_color),
            resolution: Vec2::new(1920.0, 1080.0),
            // NOTE: shader_handle must be stored in a resource or marker
            // so MaterialExtension::fragment_shader() can return it.
            // See "Dynamic ShaderRef" section below.
        };

        // Get base StandardMaterial
        let base_mat = if let Ok((_, _, std_handle, _)) = std_mat_query.get(entity) {
            std_materials.get(std_handle.0.id()).cloned().unwrap_or_default()
        } else if let Ok((_, _, ext_handle)) = ext_mat_query.get(entity) {
            custom_materials.get(ext_handle.0.id())
                .map(|m| m.base.clone())
                .unwrap_or_default()
        } else {
            StandardMaterial::default()
        };

        let custom_mat = CustomWgslMaterial { base: base_mat, extension };
        let mat_handle = custom_materials.add(custom_mat);

        // Swap material on entity
        commands.entity(entity)
            .remove::<MeshMaterial3d<StandardMaterial>>()
            .remove::<MeshMaterial3d<ForgeMaterial>>()
            .insert(MeshMaterial3d(mat_handle));

        // Update ECS component
        let mut data = update.data.clone();
        data.compile_status = "ok".to_string();
        data.compile_error = None;
        commands.entity(entity).insert(data.clone());

        // Record undo (reuse ShaderChange variant or add new variant)
        // For now reuse existing history -- see Task 6

        // Emit event
        events::emit_custom_wgsl_changed(&update.entity_id, &data);
    }
}
```

**IMPORTANT -- Dynamic ShaderRef problem:**

`MaterialExtension::fragment_shader()` is a static method (`fn fragment_shader() -> ShaderRef`), not instance method. This means ALL instances of `CustomWgslExtension` share the same shader source. This fundamentally conflicts with per-entity custom code.

**Solution: One `MaterialExtension` type per unique shader source.**

This is the hardest design constraint. Options:

**Option A: Pre-register N shader slots (chosen)**
- Pre-register 32 shader handles at plugin init time
- Each custom WGSL entity claims a slot
- When user code changes, update the `Shader` asset at that slot
- `CustomWgslExtension` stores a `slot_index: u32` uniform
- A single `MaterialExtension` impl returns a dispatcher shader that reads `slot_index`

**Problem:** This still uses one shader source for all. The dispatcher would need to branch on `slot_index`, which means the shader code IS static.

**Option B: Multiple material types (compile-time)**
Not feasible -- cannot generate Rust types at runtime.

**Option C: Direct Shader asset hot-swap (chosen, revised)**
- Each entity gets its own `Handle<Shader>` with unique composed WGSL
- Instead of using `MaterialExtension`, create a full `Material` implementation
- Use `Material::fragment_shader()` as an instance method via a newtype
- **Actually:** In Bevy 0.18, `Material::fragment_shader()` IS also an associated function, not instance.

**Option D: Asset-level shader mutation (final answer)**
- All `CustomWgslExtension` instances share the same `MaterialExtension::fragment_shader()` returning a fixed handle
- But for per-entity code, we:
  1. Create a SEPARATE `Shader` asset per entity
  2. Create a SEPARATE `MaterialPlugin` registration per "shader variant"? No, that is not feasible.

**REVISED DESIGN: Use `Shader` asset hot-replacement with a single template**

After careful analysis, the pragmatic approach for Bevy 0.18 is:

1. **One shader per entity is NOT possible** with `MaterialExtension` (static dispatch).
2. **Instead:** The "arbitrary WGSL" feature works via a **user-function-as-uniform-parametric** approach:
   - The mega-shader template includes a fixed set of **composable operations** (math ops, noise, blend modes, color transforms)
   - Users configure these via the 16 float params + operation selection indices
   - A "raw WGSL" mode exists but is **global** -- only one custom WGSL source per scene, applied via replacing the Shader asset

**This is the realistic constraint.** Let me revise the plan accordingly.

### REVISED: Hybrid Approach

**Tier 1: Parametric Shader (per-entity, many instances)**
- Extends the existing `ForgeShaderExtension` with more operations
- Users select from ~20 composable effect blocks (noise warp, color ramp, edge detect, etc.)
- Configured via the existing uniform block + additional params
- No WGSL authoring needed

**Tier 2: Raw WGSL Override (one per scene, advanced users)**
- A single "custom WGSL material" type per scene
- User writes WGSL function body
- Replaces the Shader asset for `CustomWgslExtension`
- ALL entities using the custom material type share this code
- Different parameter values per entity via the uniform block

This matches Bevy's material system constraints while giving users real WGSL authoring.

---

## REVISED Task Breakdown

### Task 1: Extend ForgeShaderExtension with Composable Blocks

**Files:**
- Modify: `engine/src/core/shader_effects.rs`
- Modify: `engine/src/shaders/forge_effects.wgsl`

**Step 1: Add new shader_type variants to ShaderEffectData**

Add these to the `shader_type_to_u32` match and the WGSL branching:

| Type ID | Name | Description |
|---------|------|-------------|
| 7 | `edge_detect` | Sobel edge detection overlay |
| 8 | `noise_warp` | UV distortion via noise field |
| 9 | `color_ramp` | Remap luminance through user_color gradient |
| 10 | `pulse` | Rhythmic scale/emission pulse |
| 11 | `scanline_crt` | CRT scanline + vignette |
| 12 | `chromatic_split` | RGB channel offset |
| 13 | `pixelate` | Reduce UV resolution |
| 14 | `outline` | Depth/normal-based outline |
| 15 | `heat_distortion` | Rising heat wave effect |
| 16 | `custom_wgsl` | Raw WGSL injection (scene-global) |

**Step 2: Add fields to ShaderEffectData**

```rust
// New fields in ShaderEffectData

/// User-configurable float parameters for advanced effects.
#[serde(default = "default_user_params")]
pub user_params: [f32; 8],

/// Pixelation resolution (pixels per unit, for pixelate effect).
#[serde(default = "default_pixel_size")]
pub pixel_size: f32,

/// Outline thickness (for outline effect).
#[serde(default = "default_outline_thickness")]
pub outline_thickness: f32,

/// Secondary color for gradients/outlines.
#[serde(default = "default_secondary_color")]
pub secondary_color: [f32; 4],
```

**Step 3: Add corresponding fields to ForgeShaderExtension**

Match new fields in the `AsBindGroup` struct and `From<&ShaderEffectData>` impl.

**Step 4: Add WGSL effect implementations**

In `forge_effects.wgsl`, add branches for types 7-15 after the existing fresnel_glow branch. Each effect reads from the shared uniform block.

**Verify:** `cargo check --target wasm32-unknown-unknown`

**Commit:** "feat(engine): add 9 composable shader effect blocks (edge_detect through heat_distortion)"

---

### Task 2: Custom WGSL Data Component + Scene-Global Shader

**Files:**
- Create: `engine/src/core/custom_wgsl.rs`
- Modify: `engine/src/core/mod.rs`
- Create: `engine/src/shaders/custom_wgsl_template.wgsl`

**Step 1: Define CustomWgslData component (scene-global shader source)**

```rust
// engine/src/core/custom_wgsl.rs

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Maximum WGSL source code length in bytes (64KB).
pub const MAX_WGSL_SOURCE_LENGTH: usize = 65_536;

/// Scene-global custom WGSL shader configuration.
/// Only ONE custom WGSL source exists per scene. Entities opt-in
/// by setting shader_type = "custom_wgsl" on their ShaderEffectData.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomWgslSource {
    /// User-authored WGSL function body.
    pub user_code: String,

    /// Human-readable name.
    pub name: String,

    /// Compilation status: "ok", "error", or "pending".
    #[serde(default = "default_status")]
    pub compile_status: String,

    /// Error message from last compilation attempt.
    #[serde(default)]
    pub compile_error: Option<String>,
}

fn default_status() -> String { "pending".to_string() }

impl Default for CustomWgslSource {
    fn default() -> Self {
        Self {
            user_code: "return base_color;".to_string(),
            name: "Custom WGSL".to_string(),
            compile_status: "ok".to_string(),
            compile_error: None,
        }
    }
}

/// Validation result for WGSL source code.
pub struct WgslValidation {
    pub valid: bool,
    pub error: Option<String>,
}

/// Validate WGSL source code (lightweight heuristic checks).
pub fn validate_wgsl_source(code: &str) -> WgslValidation {
    if code.len() > MAX_WGSL_SOURCE_LENGTH {
        return WgslValidation {
            valid: false,
            error: Some(format!("Source exceeds maximum length of {} bytes", MAX_WGSL_SOURCE_LENGTH)),
        };
    }

    // Forbid binding redefinition
    if code.contains("@group") || code.contains("@binding") {
        return WgslValidation {
            valid: false,
            error: Some("Custom code must not contain @group or @binding declarations".to_string()),
        };
    }

    // Forbid function redefinition
    if code.contains("fn fragment") || code.contains("fn vertex") {
        return WgslValidation {
            valid: false,
            error: Some("Custom code must not redefine fragment or vertex functions".to_string()),
        };
    }

    // Forbid storage writes
    if code.contains("textureStore") || code.contains("atomicStore") {
        return WgslValidation {
            valid: false,
            error: Some("Custom code must not perform storage writes".to_string()),
        };
    }

    // Check balanced braces
    let open = code.chars().filter(|c| *c == '{').count();
    let close = code.chars().filter(|c| *c == '}').count();
    if open != close {
        return WgslValidation {
            valid: false,
            error: Some(format!("Unbalanced braces: {} open, {} close", open, close)),
        };
    }

    WgslValidation { valid: true, error: None }
}
```

**Step 2: Create WGSL template**

Same as the template shown earlier in the design section, placed at `engine/src/shaders/custom_wgsl_template.wgsl`.

**Step 3: Register module**

In `core/mod.rs`: `pub mod custom_wgsl;`

**Verify:** `cargo check --target wasm32-unknown-unknown`

**Commit:** "feat(engine): add CustomWgslSource resource and WGSL validation"

---

### Task 3: Pending Commands + Command Dispatch for Custom WGSL

**Files:**
- Modify: `engine/src/core/pending/material.rs`
- Modify: `engine/src/core/pending/mod.rs`
- Modify: `engine/src/core/commands/material.rs`

**Step 1: Add pending types**

```rust
// In pending/material.rs
pub struct CustomWgslSourceUpdate {
    pub user_code: String,
    pub name: String,
}

pub struct CustomWgslValidateRequest {
    pub code: String,
}
```

**Step 2: Add to PendingCommands**

```rust
pub custom_wgsl_source_updates: Vec<CustomWgslSourceUpdate>,
pub custom_wgsl_validate_requests: Vec<CustomWgslValidateRequest>,
```

**Step 3: Add queue methods + bridge functions**

Follow the standard pattern with `with_pending`.

**Step 4: Add command handlers**

```rust
// In commands/material.rs dispatch match
"set_custom_wgsl_source" => Some(handle_set_custom_wgsl_source(payload.clone())),
"validate_wgsl" => Some(handle_validate_wgsl(payload.clone())),
```

`handle_set_custom_wgsl_source`: validates, queues the update.
`handle_validate_wgsl`: runs `validate_wgsl_source()`, returns result synchronously (no queue needed -- pure function).

**Verify:** `cargo check --target wasm32-unknown-unknown`

**Commit:** "feat(engine): add custom WGSL command dispatch and pending queue"

---

### Task 4: Bridge System -- Compile + Hot-Swap Custom WGSL Shader

**Files:**
- Modify: `engine/src/bridge/material.rs`
- Modify: `engine/src/bridge/mod.rs`
- Modify: `engine/src/bridge/events.rs`
- Modify: `engine/src/core/custom_wgsl.rs` (add plugin)

**Step 1: Create CustomWgslPlugin**

```rust
// In custom_wgsl.rs

use bevy::asset::uuid_handle;

const CUSTOM_WGSL_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("f09eeffc-e750-4001-a000-000000000002");

pub struct CustomWgslPlugin;

impl Plugin for CustomWgslPlugin {
    fn build(&self, app: &mut App) {
        // Register the default custom WGSL shader (passthrough)
        let template = include_str!("../shaders/custom_wgsl_template.wgsl");
        if let Err(err) = app.world_mut()
            .resource_mut::<Assets<Shader>>()
            .insert(
                CUSTOM_WGSL_SHADER_HANDLE.id(),
                Shader::from_wgsl(template, "shaders/custom_wgsl_template.wgsl"),
            )
        {
            tracing::warn!("Failed to register custom WGSL shader: {err}");
        }

        // Register the ExtendedMaterial type
        app.add_plugins(MaterialPlugin::<CustomWgslMaterial>::default());

        // Insert default resource
        app.insert_resource(CustomWgslSource::default());
    }
}
```

**Step 2: Add the MaterialExtension impl**

```rust
impl MaterialExtension for CustomWgslExtension {
    fn fragment_shader() -> ShaderRef {
        CUSTOM_WGSL_SHADER_HANDLE.into()
    }
}
```

**Step 3: Bridge system for applying custom WGSL source updates**

```rust
// In bridge/material.rs

/// System that applies custom WGSL source changes by hot-swapping the Shader asset.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_custom_wgsl_source_updates(
    mut pending: ResMut<PendingCommands>,
    mut source: ResMut<CustomWgslSource>,
    mut shaders: ResMut<Assets<Shader>>,
) {
    const TEMPLATE: &str = include_str!("../shaders/custom_wgsl_template.wgsl");

    for update in pending.custom_wgsl_source_updates.drain(..) {
        // Validate first
        let validation = validate_wgsl_source(&update.user_code);
        if !validation.valid {
            source.compile_status = "error".to_string();
            source.compile_error = validation.error;
            source.user_code = update.user_code;
            source.name = update.name;
            events::emit_custom_wgsl_source_changed(&source);
            continue;
        }

        // Compose final shader source
        let composed = TEMPLATE.replace(
            "// USER_CODE_INJECTION_POINT\n    return base_color;",
            &update.user_code,
        );

        // Hot-swap the shader asset at the fixed handle
        // This triggers automatic recompilation for all materials using this shader.
        if let Err(err) = shaders.insert(
            CUSTOM_WGSL_SHADER_HANDLE.id(),
            Shader::from_wgsl(composed, "shaders/custom_wgsl_user.wgsl"),
        ) {
            source.compile_status = "error".to_string();
            source.compile_error = Some(format!("Shader asset insert failed: {err}"));
        } else {
            source.compile_status = "ok".to_string();
            source.compile_error = None;
        }

        source.user_code = update.user_code;
        source.name = update.name;
        events::emit_custom_wgsl_source_changed(&source);
    }
}

/// System that syncs time + user params to CustomWgslMaterial entities each frame.
pub(super) fn sync_custom_wgsl_uniforms(
    time: Res<Time>,
    query: Query<(&ShaderEffectData, &MeshMaterial3d<CustomWgslMaterial>)>,
    mut materials: ResMut<Assets<CustomWgslMaterial>>,
) {
    let t = time.elapsed_secs();
    for (data, handle) in query.iter() {
        if let Some(mat) = materials.get_mut(handle) {
            mat.extension.time = t;
            // user_params from ShaderEffectData
            mat.extension.user_params = data.user_params;
            mat.extension.user_color = Vec4::from_array(data.custom_color);
        }
    }
}
```

**Step 4: Register systems in bridge/mod.rs**

Add `apply_custom_wgsl_source_updates` to the editor-only system group.
Add `sync_custom_wgsl_uniforms` to the always-active system group.
Add `CustomWgslPlugin` to the plugin list.

**Step 5: Add emit function in events.rs**

```rust
pub fn emit_custom_wgsl_source_changed(source: &CustomWgslSource) {
    emit_event("CUSTOM_WGSL_SOURCE_CHANGED", source);
}
```

**Step 6: Handle shader_type = "custom_wgsl" in apply_shader_updates**

When an entity's `ShaderEffectData.shader_type == "custom_wgsl"` (type 16), the existing `apply_shader_updates` system must swap to `CustomWgslMaterial` instead of `ForgeMaterial`. Add a branch in the existing system.

**Verify:** `cargo check --target wasm32-unknown-unknown`

**Commit:** "feat(engine): custom WGSL shader compilation, hot-swap, and uniform sync"

---

### Task 5: EntitySnapshot + History Integration

**Files:**
- Modify: `engine/src/core/history.rs` (EntitySnapshot field)
- Modify: `engine/src/core/entity_factory.rs` (spawn_from_snapshot)
- Modify: `engine/src/core/engine_mode.rs` (snapshot_scene)
- Modify: `engine/src/bridge/scene_io.rs` (export/load)

**Step 1: Add CustomWgslSource to scene file**

The `CustomWgslSource` is a scene-level resource, not per-entity. Add it to the scene file format alongside `EnvironmentSettings` and `PostProcessingSettings`.

In `scene_file.rs`, add `custom_wgsl_source: Option<CustomWgslSource>` to the scene struct.

**Step 2: Export/import in scene_io.rs**

When exporting: read `Res<CustomWgslSource>` and include it.
When loading: if present, insert as resource and trigger shader recompilation.

**Step 3: No EntitySnapshot changes needed**

Since `CustomWgslSource` is a Resource (not a Component), it does not need an EntitySnapshot field. Entities using custom WGSL are just regular `ShaderEffectData { shader_type: "custom_wgsl" }` entities, which are already handled.

**Verify:** `cargo check --target wasm32-unknown-unknown`

**Commit:** "feat(engine): integrate custom WGSL source into scene save/load"

---

### Task 6: Web Types + Store Slice

**Files:**
- Modify: `web/src/stores/slices/types.ts`
- Modify: `web/src/stores/slices/materialSlice.ts`
- Modify: `web/src/hooks/events/materialEvents.ts`

**Step 1: Add TypeScript types**

```typescript
// In types.ts

export interface CustomWgslSource {
  userCode: string;
  name: string;
  compileStatus: 'ok' | 'error' | 'pending';
  compileError: string | null;
}
```

**Step 2: Add to ShaderEffectData**

Extend `ShaderEffectData` with the new fields:
```typescript
export interface ShaderEffectData {
  // ... existing fields ...
  userParams: number[];  // 8 floats
  pixelSize: number;
  outlineThickness: number;
  secondaryColor: [number, number, number, number];
}
```

**Step 3: Add store state + actions**

In `materialSlice.ts`:
```typescript
customWgslSource: CustomWgslSource | null;
setCustomWgslSource: (source: CustomWgslSource | null) => void;
updateCustomWgslSource: (code: string, name: string) => void;
validateWgsl: (code: string) => void;
```

**Step 4: Add event handler**

In `materialEvents.ts`, handle `CUSTOM_WGSL_SOURCE_CHANGED`:
```typescript
case 'CUSTOM_WGSL_SOURCE_CHANGED':
  const wgslPayload = data as unknown as CustomWgslSource;
  useEditorStore.getState().setCustomWgslSource(wgslPayload);
  break;
```

**Test command:** `cd web && npx vitest run --testPathPattern materialSlice`

**Commit:** "feat(web): add custom WGSL types, store slice, and event handler"

---

### Task 7: Custom WGSL Editor UI

**Files:**
- Create: `web/src/components/editor/CustomWgslEditor.tsx`
- Modify: `web/src/components/editor/MaterialInspector.tsx`

**Step 1: Create the WGSL code editor component**

A textarea-based code editor with:
- Monospace font, syntax highlighting (basic -- just keyword coloring via regex replace in a `<pre>` overlay)
- Live validation (debounced 500ms)
- Compile button
- Status indicator (green checkmark / red X)
- Error message display
- Template snippets dropdown (wave, dissolve, color shift, etc.)
- The 16 user_params displayed as labeled sliders (labels from `ShaderEffectData.param_labels` -- reuse existing or add a new field)

```tsx
// web/src/components/editor/CustomWgslEditor.tsx

'use client';

import { useState, useCallback, useMemo } from 'react';
import { Code2, Play, AlertCircle, CheckCircle } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

const WGSL_TEMPLATES = [
  {
    name: 'Passthrough',
    code: 'return base_color;',
  },
  {
    name: 'Color Tint',
    code: 'return base_color * user_color;',
  },
  {
    name: 'Wave Distortion',
    code: [
      'let wave = sin(uv.x * user_params[0] + time * user_params[1]) * 0.5 + 0.5;',
      'return vec4(base_color.rgb * wave, base_color.a);',
    ].join('\n'),
  },
  {
    name: 'Rim Light',
    code: [
      'let view_dir = normalize(vec3(0.0, 0.0, 1.0));',
      'let rim = pow(1.0 - abs(dot(world_normal, view_dir)), user_params[0]);',
      'return vec4(base_color.rgb + user_color.rgb * rim * user_params[1], base_color.a);',
    ].join('\n'),
  },
  // ... more templates
];
```

**Step 2: Add shader type "custom_wgsl" to MaterialInspector dropdown**

Add `<option value="custom_wgsl">Custom WGSL</option>` to the shader type select.

When `shaderType === 'custom_wgsl'`, render the `<CustomWgslEditor />` component instead of the regular param sliders.

**Step 3: Wire up the editor to dispatch**

The "Compile" button calls `updateCustomWgslSource(code, name)` which dispatches the `set_custom_wgsl_source` command.

**Test command:** `cd web && npx eslint --max-warnings 0 . && npx tsc --noEmit`

**Commit:** "feat(web): add CustomWgslEditor component with code editing and templates"

---

### Task 8: MCP Commands

**Files:**
- Modify: `mcp-server/manifest/commands.json`
- Modify: `web/src/data/commands.json` (sync copy)

**Step 1: Add 3 new MCP commands**

```json
{
  "name": "set_custom_wgsl_source",
  "category": "shader",
  "description": "Set the scene-global custom WGSL shader source code. Entities use this by setting shaderType to 'custom_wgsl'.",
  "parameters": {
    "userCode": { "type": "string", "description": "WGSL function body that receives base_color, world_pos, world_normal, uv, time, user_params, user_color and returns vec4<f32>" },
    "name": { "type": "string", "description": "Human-readable shader name" }
  },
  "requiredParameters": ["userCode", "name"]
},
{
  "name": "validate_wgsl",
  "category": "shader",
  "description": "Validate WGSL source code without applying it.",
  "parameters": {
    "code": { "type": "string", "description": "WGSL code to validate" }
  },
  "requiredParameters": ["code"]
},
{
  "name": "list_shader_effects",
  "category": "shader",
  "description": "List all available shader effect types including the 6 original + 9 new composable effects + custom WGSL.",
  "parameters": {},
  "requiredParameters": []
}
```

**Step 2: Sync to web/src/data/commands.json**

**Test command:** `cd mcp-server && npx vitest run`

**Commit:** "feat(mcp): add custom WGSL shader MCP commands"

---

### Task 9: Unit Tests

**Files:**
- Create: `web/src/stores/slices/__tests__/materialSlice.customWgsl.test.ts`
- Create: `web/src/hooks/events/__tests__/materialEvents.customWgsl.test.ts`

**Step 1: Store tests**

Test cases:
1. `setCustomWgslSource` stores the source
2. `updateCustomWgslSource` dispatches `set_custom_wgsl_source` command
3. `validateWgsl` dispatches `validate_wgsl` command
4. `setCustomWgslSource(null)` clears the source
5. New shader types (edge_detect through heat_distortion) can be set via `updateShaderEffect`

**Step 2: Event handler tests**

Test cases:
1. `CUSTOM_WGSL_SOURCE_CHANGED` event updates store
2. `SHADER_CHANGED` event with `shaderType: "custom_wgsl"` stores correctly

**Test command:** `cd web && npx vitest run --testPathPattern customWgsl`

**Commit:** "test(web): add custom WGSL store and event handler tests"

---

### Task 10: TESTING.md + README Update

**Files:**
- Modify: `TESTING.md`
- Modify: `README.md`

**Step 1: Add manual test cases to TESTING.md**

```markdown
## Custom WGSL Shaders

### New Composable Effects
- [ ] Select entity, change shader to "Edge Detect" -- edges render
- [ ] Select entity, change shader to "Pixelate" -- pixel grid visible
- [ ] Select entity, change shader to "CRT Scanline" -- CRT effect visible
- [ ] Select entity, change shader to "Chromatic Split" -- RGB offset visible

### Custom WGSL Editor
- [ ] Select entity, set shader to "Custom WGSL" -- code editor appears
- [ ] Type valid WGSL (e.g., `return vec4(1.0, 0.0, 0.0, 1.0);`) -- compiles, entity turns red
- [ ] Type invalid WGSL (unbalanced braces) -- error shown, entity unchanged
- [ ] Use template dropdown (Wave Distortion) -- code populated, compiles
- [ ] Adjust user_params sliders -- effect updates in real-time
- [ ] Save/load scene -- custom WGSL source persists
- [ ] Multiple entities with shader_type "custom_wgsl" -- all use same source, different params

### WebGL2 Fallback
- [ ] Set shader to "Custom WGSL" on WebGL2 -- entity renders standard PBR, no crash
```

**Step 2: Update README.md**

Add "Custom WGSL Shaders" to the Engine Features section. Update MCP command count.

**Commit:** "docs: add custom WGSL shader test cases and README update"

---

## Edge Cases and Risks

### 1. Shader Compilation Failure at Runtime
**Risk:** User code may pass heuristic validation but fail GPU compilation (e.g., type mismatch in WGSL).
**Mitigation:** The `Shader` asset hot-swap approach means Bevy/wgpu will log the error. We cannot catch this synchronously. The UI should show "pending" status and poll for compilation errors.
**Implementation:** Add a system that checks `AssetEvent<Shader>` for `Failed` events on the custom WGSL handle and updates `CustomWgslSource.compile_status` accordingly.

### 2. Infinite Loops in User WGSL
**Risk:** A `loop {}` in user WGSL will hang the GPU.
**Mitigation:** Heuristic check: forbid bare `loop` keyword without `break`. This is imperfect but catches obvious cases. GPU watchdog timers (browser-level) will eventually kill the context.

### 3. Scene with Custom WGSL Loaded on WebGL2
**Risk:** The `CustomWgslMaterial` type will not exist/render on WebGL2.
**Mitigation:** The plugin registration and material type compilation should be gated behind `#[cfg(feature = "webgpu")]`. On WebGL2, entities with `shader_type: "custom_wgsl"` should silently fall back to standard PBR. The `ShaderEffectData` component is always compiled (data only), matching the particle system pattern.

### 4. Memory Pressure from Shader Variants
**Risk:** Each unique `Shader` asset consumes GPU memory for the compiled pipeline.
**Mitigation:** Scene-global approach means only ONE custom shader pipeline at a time. Combined with the 6 + 9 predefined effects, total pipeline count stays manageable.

### 5. Bevy 0.18 `Assets::insert` Returns Result
**Rule from bevy-api.md:** Must handle or discard with `let _ =`. All `shaders.insert()` and `materials.insert()` calls must use `if let Err(err) = ...` or `let _ =`.

### 6. ForgeShaderExtension Uniform Block Size
Adding `user_params: [f32; 8]` plus other new fields to the existing `@uniform(100)` block increases its size. WebGPU has a minimum uniform buffer size of 16KB. With the current ~48 bytes + new ~56 bytes, we are well within limits (~104 bytes total).

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `engine/src/core/custom_wgsl.rs` | CREATE | CustomWgslSource resource, validation, plugin |
| `engine/src/core/mod.rs` | MODIFY | Add `pub mod custom_wgsl` |
| `engine/src/core/shader_effects.rs` | MODIFY | Add 9 new shader types + user_params fields |
| `engine/src/shaders/forge_effects.wgsl` | MODIFY | Add WGSL for types 7-15 |
| `engine/src/shaders/custom_wgsl_template.wgsl` | CREATE | Template with USER_CODE_INJECTION_POINT |
| `engine/src/core/pending/material.rs` | MODIFY | Add request structs + queue methods |
| `engine/src/core/pending/mod.rs` | MODIFY | Add fields to PendingCommands |
| `engine/src/core/commands/material.rs` | MODIFY | Add 3 command handlers |
| `engine/src/bridge/material.rs` | MODIFY | Add compile, hot-swap, and sync systems |
| `engine/src/bridge/mod.rs` | MODIFY | Register new systems + plugin |
| `engine/src/bridge/events.rs` | MODIFY | Add emit_custom_wgsl_source_changed |
| `engine/src/core/scene_file.rs` | MODIFY | Add custom_wgsl_source to scene format |
| `engine/src/bridge/scene_io.rs` | MODIFY | Export/import custom WGSL source |
| `web/src/stores/slices/types.ts` | MODIFY | Add CustomWgslSource type + extend ShaderEffectData |
| `web/src/stores/slices/materialSlice.ts` | MODIFY | Add custom WGSL state + actions |
| `web/src/hooks/events/materialEvents.ts` | MODIFY | Handle CUSTOM_WGSL_SOURCE_CHANGED |
| `web/src/components/editor/CustomWgslEditor.tsx` | CREATE | WGSL code editor component |
| `web/src/components/editor/MaterialInspector.tsx` | MODIFY | Add custom_wgsl shader type + editor integration |
| `mcp-server/manifest/commands.json` | MODIFY | Add 3 MCP commands |
| `web/src/data/commands.json` | MODIFY | Sync copy |
| `web/src/stores/slices/__tests__/materialSlice.customWgsl.test.ts` | CREATE | Store tests |
| `web/src/hooks/events/__tests__/materialEvents.customWgsl.test.ts` | CREATE | Event tests |
| `TESTING.md` | MODIFY | Manual test cases |
| `README.md` | MODIFY | Feature description + command count |
