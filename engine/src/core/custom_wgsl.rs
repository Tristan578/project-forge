//! Scene-global custom WGSL shader source system.
//!
//! Allows users to write arbitrary WGSL fragment code that replaces the
//! standard PBR output for entities using shader_type = "custom_wgsl".
//! Because Bevy's `MaterialExtension::fragment_shader()` is a static method
//! (not per-instance), a single shader asset handle is shared. The user's
//! code is injected into a template and the Shader asset is hot-swapped at
//! the fixed handle, triggering automatic recompilation.

use bevy::asset::uuid_handle;
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::AsBindGroup;
use bevy::shader::{Shader, ShaderRef};
use serde::{Deserialize, Serialize};

/// Maximum WGSL source code length in bytes (64KB).
pub const MAX_WGSL_SOURCE_LENGTH: usize = 65_536;

/// Stable handle for the custom WGSL shader asset.
/// Using a UUID handle avoids `embedded_asset!` macro issues on Windows.
pub const CUSTOM_WGSL_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("f09eeffc-e750-4001-a000-000000000002");

// --- Default helpers for serde ---
fn default_status() -> String {
    "ok".to_string()
}

/// Scene-global custom WGSL shader configuration stored as a Bevy `Resource`.
///
/// Only ONE custom WGSL source exists per scene. Entities opt-in by setting
/// `shader_type = "custom_wgsl"` on their `ShaderEffectData`. The user's
/// WGSL function body is injected into a template and the compiled shader
/// is shared by all entities using `CustomWgslMaterial`.
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomWgslSource {
    /// User-authored WGSL function body.
    /// Receives: base_color, world_pos, world_normal, uv, time, user_params, user_color.
    /// Must return: vec4<f32>.
    pub user_code: String,

    /// Human-readable shader name.
    pub name: String,

    /// Compilation status: "ok", "error", or "pending".
    #[serde(default = "default_status")]
    pub compile_status: String,

    /// Error message from last compilation attempt.
    #[serde(default)]
    pub compile_error: Option<String>,
}

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

/// Validation result for WGSL source code (lightweight heuristic checks).
pub struct WgslValidation {
    pub valid: bool,
    pub error: Option<String>,
}

/// Validate WGSL source code via lightweight heuristic checks.
/// These are not GPU-level checks — they guard against obvious mistakes
/// and security violations (binding hijacking, storage writes, etc.).
pub fn validate_wgsl_source(code: &str) -> WgslValidation {
    if code.len() > MAX_WGSL_SOURCE_LENGTH {
        return WgslValidation {
            valid: false,
            error: Some(format!(
                "Source exceeds maximum length of {} bytes",
                MAX_WGSL_SOURCE_LENGTH
            )),
        };
    }

    // Forbid binding redefinition — prevents hijacking the engine's uniform layout.
    if code.contains("@group") || code.contains("@binding") {
        return WgslValidation {
            valid: false,
            error: Some(
                "Custom code must not contain @group or @binding declarations".to_string(),
            ),
        };
    }

    // Forbid function redefinition that would break the template.
    if code.contains("fn fragment") || code.contains("fn vertex") {
        return WgslValidation {
            valid: false,
            error: Some(
                "Custom code must not redefine fragment or vertex entry points".to_string(),
            ),
        };
    }

    // Forbid storage writes — no GPU side-effects outside the fragment output.
    if code.contains("textureStore") || code.contains("atomicStore") {
        return WgslValidation {
            valid: false,
            error: Some("Custom code must not perform storage writes".to_string()),
        };
    }

    // Check balanced braces to catch obvious syntax errors early.
    let open = code.chars().filter(|c| *c == '{').count();
    let close = code.chars().filter(|c| *c == '}').count();
    if open != close {
        return WgslValidation {
            valid: false,
            error: Some(format!(
                "Unbalanced braces: {} open, {} close",
                open, close
            )),
        };
    }

    WgslValidation {
        valid: true,
        error: None,
    }
}

// --- GPU Types ---

/// GPU uniform block for the custom WGSL extension.
/// All fields are packed into a single UBO at binding 101.
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct CustomWgslExtension {
    #[uniform(101)]
    pub time: f32,
    #[uniform(101)]
    pub _pad0: f32,
    #[uniform(101)]
    pub _pad1: f32,
    #[uniform(101)]
    pub _pad2: f32,
    #[uniform(101)]
    pub user_color: Vec4,
    #[uniform(101)]
    pub resolution: Vec2,
    #[uniform(101)]
    pub _pad3: Vec2,
    // user_params as a flat array — 8 vec4s = 32 floats mapped into 8 separate fields
    // to work around AsBindGroup limitations with fixed-size arrays.
    #[uniform(101)]
    pub user_params_0: Vec4,
    #[uniform(101)]
    pub user_params_1: Vec4,
    #[uniform(101)]
    pub user_params_2: Vec4,
    #[uniform(101)]
    pub user_params_3: Vec4,
}

impl Default for CustomWgslExtension {
    fn default() -> Self {
        Self {
            time: 0.0,
            _pad0: 0.0,
            _pad1: 0.0,
            _pad2: 0.0,
            user_color: Vec4::ONE,
            resolution: Vec2::new(1920.0, 1080.0),
            _pad3: Vec2::ZERO,
            user_params_0: Vec4::ZERO,
            user_params_1: Vec4::ZERO,
            user_params_2: Vec4::ZERO,
            user_params_3: Vec4::ZERO,
        }
    }
}

impl MaterialExtension for CustomWgslExtension {
    fn fragment_shader() -> ShaderRef {
        CUSTOM_WGSL_SHADER_HANDLE.into()
    }
}

/// Type alias for the custom WGSL extended material.
pub type CustomWgslMaterial = ExtendedMaterial<StandardMaterial, CustomWgslExtension>;

/// Plugin that registers the custom WGSL shader system.
pub struct CustomWgslPlugin;

impl Plugin for CustomWgslPlugin {
    fn build(&self, app: &mut App) {
        // Register the default custom WGSL shader (passthrough template).
        // This will be hot-swapped when the user provides custom code.
        if let Err(err) = app
            .world_mut()
            .resource_mut::<Assets<Shader>>()
            .insert(
                CUSTOM_WGSL_SHADER_HANDLE.id(),
                Shader::from_wgsl(
                    include_str!("../shaders/custom_wgsl_template.wgsl"),
                    "shaders/custom_wgsl_template.wgsl",
                ),
            )
        {
            tracing::warn!("Failed to register custom WGSL shader: {err}");
        }

        // Register the ExtendedMaterial type so Bevy creates the render pipeline.
        app.add_plugins(MaterialPlugin::<CustomWgslMaterial>::default());

        // Insert the default resource (passthrough, no user code yet).
        app.insert_resource(CustomWgslSource::default());
    }
}
