//! Mega-shader stub functions.
//!
//! This file is the DEFAULT implementation included by forge_effects.wgsl via
//! the Rust bridge injection mechanism.  When the CustomShaderRegistry is empty
//! all 8 slots pass through the input color unchanged.
//!
//! The bridge's `restitch_custom_shaders` system replaces the entire block
//! below the FORGE_CUSTOM_SLOT_FUNCTIONS marker with generated versions
//! (including any user-provided WGSL function bodies) and hot-swaps the
//! shader asset at FORGE_EFFECTS_SHADER_HANDLE.

fn custom_shader_1(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_2(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_3(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_4(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_5(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_6(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_7(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}

fn custom_shader_8(color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) -> vec4<f32> {
    return color;
}
