//! Custom WGSL shader template.
//!
//! This shader is a MaterialExtension fragment override. The Rust bridge
//! hot-swaps this asset (at CUSTOM_WGSL_SHADER_HANDLE) whenever the user
//! provides new WGSL code. The placeholder comment below is the injection
//! point replaced at runtime.
//!
//! User function contract:
//!   fn user_effect(
//!       base_color: vec4<f32>,   -- PBR lit output
//!       world_pos: vec3<f32>,    -- fragment world position
//!       world_normal: vec3<f32>, -- fragment normal (normalized)
//!       uv: vec2<f32>,           -- texture coordinates
//!       time: f32,               -- elapsed time in seconds
//!       user_params_0: vec4<f32>, -- user float params [0..3]
//!       user_params_1: vec4<f32>, -- user float params [4..7]
//!       user_params_2: vec4<f32>, -- user float params [8..11]
//!       user_params_3: vec4<f32>, -- user float params [12..15]
//!       user_color: vec4<f32>,   -- user color param
//!   ) -> vec4<f32>

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
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
    user_color: vec4<f32>,
    resolution: vec2<f32>,
    _pad3: vec2<f32>,
    user_params_0: vec4<f32>,
    user_params_1: vec4<f32>,
    user_params_2: vec4<f32>,
    user_params_3: vec4<f32>,
}

@group(2) @binding(101)
var<uniform> forge_user: ForgeUserUniforms;

// --- User-authored effect function ---
// The WGSL bridge replaces the body of this function at runtime.
fn user_effect(
    base_color: vec4<f32>,
    world_pos: vec3<f32>,
    world_normal: vec3<f32>,
    uv: vec2<f32>,
    time: f32,
    user_params_0: vec4<f32>,
    user_params_1: vec4<f32>,
    user_params_2: vec4<f32>,
    user_params_3: vec4<f32>,
    user_color: vec4<f32>,
) -> vec4<f32> {
    // FORGE_USER_CODE_INJECTION_POINT
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
            forge_user.user_params_0,
            forge_user.user_params_1,
            forge_user.user_params_2,
            forge_user.user_params_3,
            forge_user.user_color,
        );
    #endif

    return out;
}
