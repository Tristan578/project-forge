//! Forge shader effects extension.
//!
//! This shader extends StandardMaterial with 6 built-in visual effects:
//! 1. Dissolve - noise-based alpha discard with edge glow
//! 2. Hologram - scan lines + transparency
//! 3. Force Field - Fresnel rim + animated pulse
//! 4. Lava/Flow - scrolling UV + noise distortion
//! 5. Toon - quantized lighting bands (cel-shading)
//! 6. Fresnel Glow - rim emission overlay

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

struct ForgeShaderUniforms {
    shader_type: u32,
    noise_scale: f32,
    emission_strength: f32,
    dissolve_threshold: f32,
    custom_color: vec4<f32>,
    scroll_speed: vec2<f32>,
    dissolve_edge_width: f32,
    scan_line_frequency: f32,
    scan_line_speed: f32,
    distortion_strength: f32,
    toon_bands: u32,
    fresnel_power: f32,
}

@group(2) @binding(100)
var<uniform> forge_uniforms: ForgeShaderUniforms;

// --- Utility: hash-based noise (no texture dependency) ---

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);

    let a = hash(i);
    let b = hash(i + vec2(1.0, 0.0));
    let c = hash(i + vec2(0.0, 1.0));
    let d = hash(i + vec2(1.0, 1.0));

    let u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

fn fbm_noise(p: vec2<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    var pp = p;

    for (var i = 0; i < octaves; i = i + 1) {
        value += amplitude * noise(pp * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }

    return value;
}

// --- MaterialExtension fragment hook ---

@fragment
fn fragment(
    in: VertexOutput,
    @builtin(front_facing) is_front: bool,
) -> FragmentOutput {
    // Generate the base PBR input
    var pbr_input = pbr_input_from_standard_material(in, is_front);

    // Apply standard PBR lighting to get the base lit color
    var out: FragmentOutput;

    #ifdef PREPASS_PIPELINE
        // Prepass just outputs standard data
        out = deferred_output(in, pbr_input);
    #else
        // Forward rendering: apply lighting and effects
        out.color = apply_pbr_lighting(pbr_input);
        out.color = main_pass_post_lighting_processing(pbr_input, out.color);

        // Get current time from globals
        let t = in.world_position.w; // time is passed via world_position.w in Bevy PBR

        // --- Effect branching ---

        if (forge_uniforms.shader_type == 0u) {
            // Passthrough - return PBR output unchanged
            return out;
        }

        if (forge_uniforms.shader_type == 1u) {
            // DISSOLVE: noise-based alpha discard + edge glow
            let noise_val = fbm_noise(in.uv * forge_uniforms.noise_scale, 4);
            if (noise_val < forge_uniforms.dissolve_threshold) {
                discard;
            }
            let edge = smoothstep(
                forge_uniforms.dissolve_threshold,
                forge_uniforms.dissolve_threshold + forge_uniforms.dissolve_edge_width,
                noise_val
            );
            let edge_color = forge_uniforms.custom_color.rgb * forge_uniforms.emission_strength;
            out.color = vec4(mix(edge_color, out.color.rgb, edge), out.color.a);
            return out;
        }

        if (forge_uniforms.shader_type == 2u) {
            // HOLOGRAM: scan lines + transparency + color tint
            let scan = sin(in.world_position.y * forge_uniforms.scan_line_frequency + t * forge_uniforms.scan_line_speed);
            let alpha = 0.3 + 0.4 * clamp(scan, 0.0, 1.0);
            let holo_color = forge_uniforms.custom_color.rgb * (1.0 + forge_uniforms.emission_strength);
            out.color = vec4(holo_color, alpha);
            return out;
        }

        if (forge_uniforms.shader_type == 3u) {
            // FORCE FIELD: Fresnel rim + animated pulse + transparency
            let view_dir = normalize(view.world_position.xyz - in.world_position.xyz);
            let fresnel = pow(1.0 - abs(dot(pbr_input.N, view_dir)), forge_uniforms.fresnel_power);
            let pulse = 0.5 + 0.5 * sin(t * 3.0 + in.world_position.y * 5.0);
            let shield_alpha = fresnel * (0.5 + 0.5 * pulse);
            let shield_color = forge_uniforms.custom_color.rgb * forge_uniforms.emission_strength;
            out.color = vec4(shield_color, shield_alpha);
            return out;
        }

        if (forge_uniforms.shader_type == 4u) {
            // LAVA/FLOW: scrolling UV + noise distortion + emissive
            let scroll_uv = in.uv + forge_uniforms.scroll_speed * t;
            let noise_val = fbm_noise(scroll_uv * forge_uniforms.noise_scale, 3);
            let distorted = noise_val + forge_uniforms.distortion_strength * sin(t * 2.0);
            let lava_color = mix(
                out.color.rgb,
                forge_uniforms.custom_color.rgb * forge_uniforms.emission_strength,
                distorted
            );
            out.color = vec4(lava_color, out.color.a);
            return out;
        }

        if (forge_uniforms.shader_type == 5u) {
            // TOON: quantized lighting bands
            let luminance = dot(out.color.rgb, vec3(0.299, 0.587, 0.114));
            let bands = f32(forge_uniforms.toon_bands);
            let quantized = floor(luminance * bands + 0.5) / bands;
            let toon_color = out.color.rgb * (quantized / max(luminance, 0.001));
            out.color = vec4(toon_color, out.color.a);
            return out;
        }

        if (forge_uniforms.shader_type == 6u) {
            // FRESNEL GLOW: rim emission overlay
            let view_dir = normalize(view.world_position.xyz - in.world_position.xyz);
            let fresnel = pow(1.0 - abs(dot(pbr_input.N, view_dir)), forge_uniforms.fresnel_power);
            let glow = forge_uniforms.custom_color.rgb * fresnel * forge_uniforms.emission_strength;
            out.color = vec4(out.color.rgb + glow, out.color.a);
            return out;
        }

    #endif

    // Fallback
    return out;
}
