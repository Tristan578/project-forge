//! Material, lighting, and environment command handlers.

use serde::Deserialize;
use crate::core::material::{MaterialData, MaterialAlphaMode, ParallaxMethod};
use crate::core::lighting::LightData;
use crate::core::shader_effects::ShaderEffectData;
use crate::core::post_processing::{
    BloomSettings, ChromaticAberrationSettings, ColorGradingSettings, SharpeningSettings,
    SsaoSettings, DepthOfFieldSettings, MotionBlurSettings,
};
use crate::core::pending_commands::{
    queue_material_update_from_bridge, queue_light_update_from_bridge,
    queue_ambient_light_update_from_bridge, queue_environment_update_from_bridge,
    queue_post_processing_update_from_bridge,
    queue_shader_update_from_bridge, queue_shader_removal_from_bridge,
    queue_set_skybox_from_bridge, queue_remove_skybox_from_bridge,
    queue_update_skybox_from_bridge, queue_custom_skybox_from_bridge,
    MaterialUpdate, LightUpdate, AmbientLightUpdate, EnvironmentUpdate,
    PostProcessingUpdate, ShaderUpdate, ShaderRemoval,
    SetSkyboxRequest, UpdateSkyboxRequest, SetCustomSkyboxRequest,
    QueryRequest,
};

/// Material and lighting command dispatcher.
pub fn dispatch(command: &str, payload: &serde_json::Value) -> Option<super::CommandResult> {
    match command {
        "update_material" => Some(handle_update_material(payload.clone())),
        "set_custom_shader" => Some(handle_set_custom_shader(payload.clone())),
        "remove_custom_shader" => Some(handle_remove_custom_shader(payload.clone())),
        "get_shader" => {
            let entity_id = payload
                .get("entityId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if let Some(id) = entity_id {
                Some(super::handle_query(QueryRequest::ShaderData { entity_id: id }))
            } else {
                Some(Err("Missing entityId".to_string()))
            }
        }
        "list_shaders" => Some(handle_list_shaders(payload.clone())),
        "update_light" => Some(handle_update_light(payload.clone())),
        "update_ambient_light" => Some(handle_update_ambient_light(payload.clone())),
        "update_environment" => Some(handle_update_environment(payload.clone())),
        "update_post_processing" => Some(handle_update_post_processing(payload.clone())),
        "get_post_processing" => Some(super::handle_query(QueryRequest::PostProcessingState)),
        "set_skybox" => Some(handle_set_skybox(payload.clone())),
        "remove_skybox" => Some(handle_remove_skybox(payload.clone())),
        "update_skybox" => Some(handle_update_skybox(payload.clone())),
        "set_custom_skybox" => Some(handle_set_custom_skybox(payload.clone())),
        _ => None,
    }
}

/// Payload for update_material command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMaterialPayload {
    entity_id: String,
    base_color: Option<[f32; 4]>,
    metallic: Option<f32>,
    perceptual_roughness: Option<f32>,
    reflectance: Option<f32>,
    emissive: Option<[f32; 4]>,
    emissive_exposure_weight: Option<f32>,
    alpha_mode: Option<String>,
    alpha_cutoff: Option<f32>,
    double_sided: Option<bool>,
    unlit: Option<bool>,
    // UV Transform (E-1a)
    uv_offset: Option<[f32; 2]>,
    uv_scale: Option<[f32; 2]>,
    uv_rotation: Option<f32>,
    // Parallax (E-1b)
    parallax_depth_scale: Option<f32>,
    parallax_mapping_method: Option<String>,
    max_parallax_layer_count: Option<f32>,
    parallax_relief_max_steps: Option<u32>,
    // Clearcoat (E-1c)
    clearcoat: Option<f32>,
    clearcoat_perceptual_roughness: Option<f32>,
    // Transmission (E-1d)
    specular_transmission: Option<f32>,
    diffuse_transmission: Option<f32>,
    ior: Option<f32>,
    thickness: Option<f32>,
    attenuation_distance: Option<f32>,
    attenuation_color: Option<[f32; 3]>,
}

/// Handle update_material command from React.
/// Accepts partial updates — only provided fields are changed.
fn handle_update_material(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdateMaterialPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_material payload: {}", e))?;

    // Build a MaterialData with defaults, then overlay provided fields.
    // The apply system will merge this with the existing component.
    let mut mat = MaterialData::default();
    if let Some(v) = data.base_color { mat.base_color = v; }
    if let Some(v) = data.metallic { mat.metallic = v; }
    if let Some(v) = data.perceptual_roughness { mat.perceptual_roughness = v; }
    if let Some(v) = data.reflectance { mat.reflectance = v; }
    if let Some(v) = data.emissive { mat.emissive = v; }
    if let Some(v) = data.emissive_exposure_weight { mat.emissive_exposure_weight = v; }
    if let Some(ref v) = data.alpha_mode {
        mat.alpha_mode = match v.as_str() {
            "blend" => MaterialAlphaMode::Blend,
            "mask" => MaterialAlphaMode::Mask,
            _ => MaterialAlphaMode::Opaque,
        };
    }
    if let Some(v) = data.alpha_cutoff { mat.alpha_cutoff = v; }
    if let Some(v) = data.double_sided { mat.double_sided = v; }
    if let Some(v) = data.unlit { mat.unlit = v; }
    // UV Transform (E-1a)
    if let Some(v) = data.uv_offset { mat.uv_offset = v; }
    if let Some(v) = data.uv_scale { mat.uv_scale = v; }
    if let Some(v) = data.uv_rotation { mat.uv_rotation = v; }
    // Parallax (E-1b)
    if let Some(v) = data.parallax_depth_scale { mat.parallax_depth_scale = v; }
    if let Some(ref v) = data.parallax_mapping_method {
        mat.parallax_mapping_method = match v.as_str() {
            "relief" => ParallaxMethod::Relief,
            _ => ParallaxMethod::Occlusion,
        };
    }
    if let Some(v) = data.max_parallax_layer_count { mat.max_parallax_layer_count = v; }
    if let Some(v) = data.parallax_relief_max_steps { mat.parallax_relief_max_steps = v; }
    // Clearcoat (E-1c)
    if let Some(v) = data.clearcoat { mat.clearcoat = v; }
    if let Some(v) = data.clearcoat_perceptual_roughness { mat.clearcoat_perceptual_roughness = v; }
    // Transmission (E-1d)
    if let Some(v) = data.specular_transmission { mat.specular_transmission = v; }
    if let Some(v) = data.diffuse_transmission { mat.diffuse_transmission = v; }
    if let Some(v) = data.ior { mat.ior = v; }
    if let Some(v) = data.thickness { mat.thickness = v; }
    if let Some(v) = data.attenuation_distance { mat.attenuation_distance = v; }
    if let Some(v) = data.attenuation_color { mat.attenuation_color = v; }

    let update = MaterialUpdate {
        entity_id: data.entity_id.clone(),
        material_data: mat,
    };

    if queue_material_update_from_bridge(update) {
        tracing::info!("Queued material update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_custom_shader command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCustomShaderPayload {
    entity_id: String,
    #[serde(flatten)]
    shader_data: ShaderEffectData,
}

/// Handle set_custom_shader command.
fn handle_set_custom_shader(payload: serde_json::Value) -> super::CommandResult {
    let data: SetCustomShaderPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_custom_shader payload: {}", e))?;

    let update = ShaderUpdate {
        entity_id: data.entity_id.clone(),
        shader_data: data.shader_data,
    };

    if queue_shader_update_from_bridge(update) {
        tracing::info!("Queued shader update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_custom_shader command.
fn handle_remove_custom_shader(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload
        .get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    let removal = ShaderRemoval {
        entity_id: entity_id.clone(),
    };

    if queue_shader_removal_from_bridge(removal) {
        tracing::info!("Queued shader removal for entity: {}", entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle list_shaders command — returns hardcoded shader list.
fn handle_list_shaders(_payload: serde_json::Value) -> super::CommandResult {
    // This is a simple query that doesn't need queuing — return immediately via emit_event
    // For now, just return Ok(). The query system will handle emitting the result.
    Ok(())
}

/// Payload for update_light command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateLightPayload {
    entity_id: String,
    color: Option<[f32; 3]>,
    intensity: Option<f32>,
    shadows_enabled: Option<bool>,
    shadow_depth_bias: Option<f32>,
    shadow_normal_bias: Option<f32>,
    range: Option<f32>,
    radius: Option<f32>,
    inner_angle: Option<f32>,
    outer_angle: Option<f32>,
}

/// Handle update_light command from React.
/// Accepts partial updates — the apply system merges with existing LightData.
fn handle_update_light(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdateLightPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_light payload: {}", e))?;

    // Build a LightData with point defaults, then overlay provided fields.
    // The actual light_type will be read from the entity's existing LightData.
    let mut light = LightData::point();
    if let Some(v) = data.color { light.color = v; }
    if let Some(v) = data.intensity { light.intensity = v; }
    if let Some(v) = data.shadows_enabled { light.shadows_enabled = v; }
    if let Some(v) = data.shadow_depth_bias { light.shadow_depth_bias = v; }
    if let Some(v) = data.shadow_normal_bias { light.shadow_normal_bias = v; }
    if let Some(v) = data.range { light.range = v; }
    if let Some(v) = data.radius { light.radius = v; }
    if let Some(v) = data.inner_angle { light.inner_angle = v; }
    if let Some(v) = data.outer_angle { light.outer_angle = v; }

    let update = LightUpdate {
        entity_id: data.entity_id.clone(),
        light_data: light,
    };

    if queue_light_update_from_bridge(update) {
        tracing::info!("Queued light update for entity: {}", data.entity_id);
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_ambient_light command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAmbientLightPayload {
    color: Option<[f32; 3]>,
    brightness: Option<f32>,
}

/// Handle update_ambient_light command from React.
fn handle_update_ambient_light(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdateAmbientLightPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_ambient_light payload: {}", e))?;

    let update = AmbientLightUpdate {
        color: data.color,
        brightness: data.brightness,
    };

    if queue_ambient_light_update_from_bridge(update) {
        tracing::info!("Queued ambient light update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_environment command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateEnvironmentPayload {
    skybox_brightness: Option<f32>,
    ibl_intensity: Option<f32>,
    ibl_rotation_degrees: Option<f32>,
    clear_color: Option<[f32; 3]>,
    fog_enabled: Option<bool>,
    fog_color: Option<[f32; 3]>,
    fog_start: Option<f32>,
    fog_end: Option<f32>,
}

/// Handle update_environment command from React.
fn handle_update_environment(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdateEnvironmentPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_environment payload: {}", e))?;

    let update = EnvironmentUpdate {
        skybox_brightness: data.skybox_brightness,
        ibl_intensity: data.ibl_intensity,
        ibl_rotation_degrees: data.ibl_rotation_degrees,
        clear_color: data.clear_color,
        fog_enabled: data.fog_enabled,
        fog_color: data.fog_color,
        fog_start: data.fog_start,
        fog_end: data.fog_end,
    };

    if queue_environment_update_from_bridge(update) {
        tracing::info!("Queued environment update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePostProcessingPayload {
    bloom: Option<BloomSettings>,
    chromatic_aberration: Option<ChromaticAberrationSettings>,
    color_grading: Option<ColorGradingSettings>,
    sharpening: Option<SharpeningSettings>,
    ssao: Option<Option<SsaoSettings>>,
    depth_of_field: Option<Option<DepthOfFieldSettings>>,
    motion_blur: Option<Option<MotionBlurSettings>>,
}

fn handle_update_post_processing(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdatePostProcessingPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_post_processing payload: {}", e))?;

    let update = PostProcessingUpdate {
        bloom: data.bloom,
        chromatic_aberration: data.chromatic_aberration,
        color_grading: data.color_grading,
        sharpening: data.sharpening,
        ssao: data.ssao,
        depth_of_field: data.depth_of_field,
        motion_blur: data.motion_blur,
    };

    if queue_post_processing_update_from_bridge(update) {
        tracing::info!("Queued post-processing update");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_skybox command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSkyboxPayload {
    preset: Option<String>,
    asset_id: Option<String>,
    brightness: Option<f32>,
    ibl_intensity: Option<f32>,
    rotation: Option<f32>,
}

/// Handle set_skybox command.
fn handle_set_skybox(payload: serde_json::Value) -> super::CommandResult {
    let data: SetSkyboxPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_skybox payload: {}", e))?;

    let request = SetSkyboxRequest {
        preset: data.preset,
        asset_id: data.asset_id,
        brightness: data.brightness,
        ibl_intensity: data.ibl_intensity,
        rotation: data.rotation,
    };

    if queue_set_skybox_from_bridge(request) {
        tracing::info!("Queued set skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Handle remove_skybox command.
fn handle_remove_skybox(_payload: serde_json::Value) -> super::CommandResult {
    if queue_remove_skybox_from_bridge() {
        tracing::info!("Queued remove skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for update_skybox command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSkyboxPayload {
    brightness: Option<f32>,
    ibl_intensity: Option<f32>,
    rotation: Option<f32>,
}

/// Handle update_skybox command.
fn handle_update_skybox(payload: serde_json::Value) -> super::CommandResult {
    let data: UpdateSkyboxPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid update_skybox payload: {}", e))?;

    let request = UpdateSkyboxRequest {
        brightness: data.brightness,
        ibl_intensity: data.ibl_intensity,
        rotation: data.rotation,
    };

    if queue_update_skybox_from_bridge(request) {
        tracing::info!("Queued update skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}

/// Payload for set_custom_skybox command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetCustomSkyboxPayload {
    asset_id: String,
    data_base64: String,
}

/// Handle set_custom_skybox command.
fn handle_set_custom_skybox(payload: serde_json::Value) -> super::CommandResult {
    let data: SetCustomSkyboxPayload = serde_json::from_value(payload)
        .map_err(|e| format!("Invalid set_custom_skybox payload: {}", e))?;

    let request = SetCustomSkyboxRequest {
        asset_id: data.asset_id,
        data_base64: data.data_base64,
    };

    if queue_custom_skybox_from_bridge(request) {
        tracing::info!("Queued custom skybox request");
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
