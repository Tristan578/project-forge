//! Material, lighting, environment, skybox, post-processing, coordinate mode, and shader systems.

use bevy::prelude::*;
use crate::core::{
    camera,
    environment::{self, EnvironmentSettings, SkyboxHandles},
    entity_id::EntityId,
    gizmo::CoordinateMode,
    history::{HistoryStack, UndoableAction},
    lighting::LightData,
    material::MaterialData,
    pending_commands::PendingCommands,
    post_processing::PostProcessingSettings,
    shader_effects::{ShaderEffectData, ForgeMaterial, ForgeShaderExtension},
};
use crate::bridge::{events, Selection, SelectionChangedEvent};

/// System that emits material data when the primary selection has a MaterialData component.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_material_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &MaterialData), Changed<MaterialData>>,
    selection_query: Query<(&EntityId, &MaterialData)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, mat_data)) = selection_query.get(primary) {
                events::emit_material_changed(&entity_id.0, mat_data);
            }
        }
    }

    // Emit when material data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, mat_data)) = query.get(primary) {
            events::emit_material_changed(&entity_id.0, mat_data);
        }
    }
}

/// System that emits light data when the primary selection has a LightData component.
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_light_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &LightData), Changed<LightData>>,
    selection_query: Query<(&EntityId, &LightData)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, light_data)) = selection_query.get(primary) {
                events::emit_light_changed(&entity_id.0, light_data);
            }
        }
    }

    // Emit when light data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, light_data)) = query.get(primary) {
            events::emit_light_changed(&entity_id.0, light_data);
        }
    }
}

/// System that applies pending environment updates from the bridge.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_environment_updates(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
) {
    for update in pending.environment_updates.drain(..) {
        if let Some(v) = update.skybox_brightness { settings.skybox_brightness = v; }
        if let Some(v) = update.ibl_intensity { settings.ibl_intensity = v; }
        if let Some(v) = update.ibl_rotation_degrees { settings.ibl_rotation_degrees = v; }
        if let Some(v) = update.clear_color { settings.clear_color = v; }
        if let Some(v) = update.fog_enabled { settings.fog_enabled = v; }
        if let Some(v) = update.fog_color { settings.fog_color = v; }
        if let Some(v) = update.fog_start { settings.fog_start = v; }
        if let Some(v) = update.fog_end { settings.fog_end = v; }

        // Emit event back to React with full state
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending set skybox requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_set_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    mut skybox_handles: ResMut<SkyboxHandles>,
    mut images: ResMut<Assets<Image>>,
    texture_handles: Res<crate::core::asset_manager::TextureHandleMap>,
    camera_query: Query<Entity, With<camera::EditorCamera>>,
    mut commands: Commands,
) {
    for request in pending.set_skybox_requests.drain(..) {
        // Update settings fields
        if let Some(brightness) = request.brightness {
            settings.skybox_brightness = brightness;
        }
        if let Some(intensity) = request.ibl_intensity {
            settings.ibl_intensity = intensity;
        }
        if let Some(rotation) = request.rotation {
            settings.ibl_rotation_degrees = rotation;
        }

        // Handle preset or asset ID
        if let Some(preset) = request.preset {
            settings.skybox_preset = Some(preset.clone());
            settings.skybox_asset_id = None;

            // Generate or retrieve cached preset cubemap
            let handle = if let Some(h) = skybox_handles.handles.get(&preset) {
                h.clone()
            } else {
                let image = environment::generate_preset_cubemap(&preset);
                let handle = images.add(image);
                skybox_handles.handles.insert(preset.clone(), handle.clone());
                handle
            };

            // Apply to camera
            if let Ok(camera_entity) = camera_query.single() {
                commands.entity(camera_entity).insert(bevy::core_pipeline::Skybox {
                    image: handle,
                    brightness: settings.skybox_brightness,
                    ..Default::default()
                });
            }

            tracing::info!("Applied skybox preset: {}", preset);
        } else if let Some(asset_id) = request.asset_id {
            settings.skybox_asset_id = Some(asset_id.clone());
            settings.skybox_preset = None;

            // Look up the asset handle from the global texture registry
            if let Some(handle) = texture_handles.0.get(&asset_id) {
                if let Ok(camera_entity) = camera_query.single() {
                    commands.entity(camera_entity).insert(bevy::core_pipeline::Skybox {
                        image: handle.clone(),
                        brightness: settings.skybox_brightness,
                        ..Default::default()
                    });
                }
                tracing::info!("Applied custom skybox asset: {}", asset_id);
            } else {
                tracing::warn!("Custom skybox asset not found in texture registry: {}", asset_id);
            }
        }

        // Emit event
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending remove skybox requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_remove_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    camera_query: Query<Entity, With<camera::EditorCamera>>,
    mut commands: Commands,
) {
    if !pending.remove_skybox_requests.is_empty() {
        pending.remove_skybox_requests.clear();

        settings.skybox_preset = None;
        settings.skybox_asset_id = None;

        // Remove Skybox component from camera
        if let Ok(camera_entity) = camera_query.single() {
            commands.entity(camera_entity).remove::<bevy::core_pipeline::Skybox>();
        }

        tracing::info!("Removed skybox");
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending update skybox requests.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_update_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    camera_query: Query<Entity, With<camera::EditorCamera>>,
    mut skybox_query: Query<&mut bevy::core_pipeline::Skybox>,
    _commands: Commands,
) {
    for request in pending.update_skybox_requests.drain(..) {
        if let Some(brightness) = request.brightness {
            settings.skybox_brightness = brightness;
        }
        if let Some(intensity) = request.ibl_intensity {
            settings.ibl_intensity = intensity;
        }
        if let Some(rotation) = request.rotation {
            settings.ibl_rotation_degrees = rotation;
        }

        // Update Skybox component brightness
        if let Ok(camera_entity) = camera_query.single() {
            if let Ok(mut skybox) = skybox_query.get_mut(camera_entity) {
                skybox.brightness = settings.skybox_brightness;
            }
        }

        events::emit_environment_changed(&settings);
    }
}

/// System that applies custom skybox requests from the bridge.
///
/// Receives an equirectangular image (typically from AI skybox generation),
/// converts it to a 6-face cubemap, and applies it as the scene skybox.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_custom_skybox_requests(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<EnvironmentSettings>,
    mut images: ResMut<Assets<Image>>,
    camera_query: Query<Entity, With<camera::EditorCamera>>,
    mut commands: Commands,
) {
    use base64::Engine as _;
    use bevy::image::{ImageType, CompressedImageFormats, ImageSampler};
    use bevy::asset::RenderAssetUsages;

    for request in pending.custom_skybox_requests.drain(..) {
        // Parse data URL: "data:image/png;base64,AAAA..."
        let raw_base64 = if let Some(comma_pos) = request.data_base64.find(',') {
            &request.data_base64[comma_pos + 1..]
        } else {
            // Raw base64 without data URL prefix
            request.data_base64.as_str()
        };

        // Decode base64 to raw bytes
        let bytes = match base64::engine::general_purpose::STANDARD.decode(raw_base64) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!("Failed to decode custom skybox base64: {}", e);
                continue;
            }
        };

        // Create Image from bytes (PNG from AI skybox generation)
        let source_image = match Image::from_buffer(
            &bytes,
            ImageType::Extension("png"),
            CompressedImageFormats::NONE,
            true,
            ImageSampler::Default,
            RenderAssetUsages::RENDER_WORLD,
        ) {
            Ok(img) => img,
            Err(e) => {
                tracing::error!("Failed to create image from custom skybox bytes: {}", e);
                continue;
            }
        };

        // Check if the image is already a cubemap (6 array layers) or needs conversion
        let cubemap_image = if source_image.texture_descriptor.size.depth_or_array_layers == 6 {
            // Already a cubemap — use as-is (just ensure view descriptor is set)
            let mut img = source_image;
            img.texture_view_descriptor = Some(bevy::render::render_resource::TextureViewDescriptor {
                dimension: Some(bevy::render::render_resource::TextureViewDimension::Cube),
                ..default()
            });
            img
        } else {
            // Equirectangular image — convert to cubemap
            // Use face size based on source height, capped at 256 for performance
            let face_size = (source_image.height() / 2).min(256).max(64);
            tracing::info!(
                "Converting equirectangular image ({}x{}) to cubemap ({}x{} per face)",
                source_image.width(), source_image.height(), face_size, face_size,
            );
            environment::equirectangular_to_cubemap(&source_image, face_size)
        };

        let handle = images.add(cubemap_image);

        // Update settings
        settings.skybox_preset = None;
        settings.skybox_asset_id = Some(request.asset_id.clone());

        // Apply to camera
        if let Ok(camera_entity) = camera_query.single() {
            commands.entity(camera_entity).insert(bevy::core_pipeline::Skybox {
                image: handle,
                brightness: settings.skybox_brightness,
                rotation: bevy::math::Quat::IDENTITY,
            });
        }

        tracing::info!("Applied custom skybox: {}", request.asset_id);
        events::emit_environment_changed(&settings);
    }
}

/// System that applies pending post-processing updates from the bridge.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_post_processing_updates(
    mut pending: ResMut<PendingCommands>,
    mut settings: ResMut<PostProcessingSettings>,
) {
    for update in pending.post_processing_updates.drain(..) {
        if let Some(bloom) = update.bloom {
            settings.bloom = bloom;
        }
        if let Some(ca) = update.chromatic_aberration {
            settings.chromatic_aberration = ca;
        }
        if let Some(cg) = update.color_grading {
            settings.color_grading = cg;
        }
        if let Some(sharp) = update.sharpening {
            settings.sharpening = sharp;
        }
        if let Some(ssao) = update.ssao {
            settings.ssao = ssao;
        }
        if let Some(dof) = update.depth_of_field {
            settings.depth_of_field = dof;
        }
        if let Some(mb) = update.motion_blur {
            settings.motion_blur = mb;
        }

        // Emit event back to React with full state
        events::emit_post_processing_changed(&settings);
    }
}

/// System that applies pending coordinate mode updates from the bridge.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_pending_coordinate_mode(
    mut pending: ResMut<PendingCommands>,
    mut coordinate_mode: ResMut<CoordinateMode>,
) {
    if let Some(new_mode) = pending.coordinate_mode_update.take() {
        *coordinate_mode = new_mode;

        // Emit event to React
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CoordinateModePayload {
            mode: CoordinateMode,
            display_name: &'static str,
        }

        events::emit_event("COORDINATE_MODE_CHANGED", &CoordinateModePayload {
            mode: new_mode,
            display_name: new_mode.display_name(),
        });
    }
}

/// System that applies pending shader update requests (editor-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_shader_updates(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId, Option<&ShaderEffectData>)>,
    std_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<StandardMaterial>, &MaterialData)>,
    ext_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<ForgeMaterial>)>,
    std_materials: ResMut<Assets<StandardMaterial>>,
    mut ext_materials: ResMut<Assets<ForgeMaterial>>,
    mut history: ResMut<HistoryStack>,
) {
    for update in pending.shader_updates.drain(..) {
        // Find entity
        let found = entity_query.iter().find(|(_, eid, _)| eid.0 == update.entity_id);
        let Some((entity, _, old_shader)) = found else { continue; };

        let old_shader_clone = old_shader.cloned();

        // Check if entity already has ExtendedMaterial
        if let Ok((_, _, ext_handle)) = ext_mat_query.get(entity) {
            // Update existing extended material
            if let Some(ext_mat) = ext_materials.get_mut(ext_handle) {
                ext_mat.extension = ForgeShaderExtension::from(&update.shader_data);
            }
        } else if let Ok((_, _, std_handle, _mat_data)) = std_mat_query.get(entity) {
            // Upgrade from StandardMaterial to ExtendedMaterial
            if let Some(std_mat) = std_materials.get(std_handle.0.id()) {
                let base = std_mat.clone();
                let extension = ForgeShaderExtension::from(&update.shader_data);
                let ext_mat = ForgeMaterial { base, extension };
                let ext_handle = ext_materials.add(ext_mat);
                commands.entity(entity)
                    .remove::<MeshMaterial3d<StandardMaterial>>()
                    .insert(MeshMaterial3d(ext_handle));
            }
        }

        // Insert/update the ShaderEffectData component
        commands.entity(entity).insert(update.shader_data.clone());

        // Record undo
        history.push(UndoableAction::ShaderChange {
            entity_id: update.entity_id.clone(),
            old_shader: old_shader_clone,
            new_shader: Some(update.shader_data),
        });
    }
}

/// System that applies pending shader removal requests (editor-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_shader_removals(
    mut pending: ResMut<PendingCommands>,
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId, Option<&ShaderEffectData>)>,
    ext_mat_query: Query<(Entity, &EntityId, &MeshMaterial3d<ForgeMaterial>)>,
    mut ext_materials: ResMut<Assets<ForgeMaterial>>,
    mut history: ResMut<HistoryStack>,
) {
    for removal in pending.shader_removals.drain(..) {
        let found = entity_query.iter().find(|(_, eid, _)| eid.0 == removal.entity_id);
        let Some((entity, _, old_shader)) = found else { continue; };

        let old_shader_clone = old_shader.cloned();

        // Set shader to passthrough (don't swap back to StandardMaterial)
        let none_data = ShaderEffectData { shader_type: "none".to_string(), ..Default::default() };

        if let Ok((_, _, ext_handle)) = ext_mat_query.get(entity) {
            if let Some(ext_mat) = ext_materials.get_mut(ext_handle) {
                ext_mat.extension.shader_type = 0;
            }
        }

        commands.entity(entity).insert(none_data.clone());

        history.push(UndoableAction::ShaderChange {
            entity_id: removal.entity_id.clone(),
            old_shader: old_shader_clone,
            new_shader: Some(none_data),
        });
    }
}

/// System that syncs MaterialData changes to ExtendedMaterial entities (always-active).
pub(super) fn sync_extended_material_data(
    query: Query<(&MaterialData, &MeshMaterial3d<ForgeMaterial>), Changed<MaterialData>>,
    mut ext_materials: ResMut<Assets<ForgeMaterial>>,
    texture_handles: Res<crate::core::asset_manager::TextureHandleMap>,
) {
    for (data, handle) in query.iter() {
        if let Some(ext_mat) = ext_materials.get_mut(handle) {
            crate::core::material::apply_material_data_to_standard(&mut ext_mat.base, data, &texture_handles);
        }
    }
}

/// System that emits shader data when the primary selection has a ShaderEffectData component (editor-only).
#[cfg(not(feature = "runtime"))]
pub(super) fn emit_shader_on_selection(
    selection: Res<Selection>,
    query: Query<(&EntityId, &ShaderEffectData), Changed<ShaderEffectData>>,
    selection_query: Query<(&EntityId, Option<&ShaderEffectData>)>,
    mut selection_events: MessageReader<SelectionChangedEvent>,
) {
    // Emit on selection change
    for _event in selection_events.read() {
        if let Some(primary) = selection.primary {
            if let Ok((entity_id, shader_data)) = selection_query.get(primary) {
                events::emit_shader_changed(&entity_id.0, shader_data);
            }
        }
    }

    // Emit when shader data changes on selected entity
    if let Some(primary) = selection.primary {
        if let Ok((entity_id, shader_data)) = query.get(primary) {
            events::emit_shader_changed(&entity_id.0, Some(shader_data));
        }
    }
}

/// System that applies custom WGSL source updates by hot-swapping the Shader asset.
///
/// Hot-swapping the Shader asset at CUSTOM_WGSL_SHADER_HANDLE triggers Bevy's
/// pipeline recompilation for all `CustomWgslMaterial` instances automatically.
#[cfg(not(feature = "runtime"))]
pub(super) fn apply_custom_wgsl_source_updates(
    mut pending: ResMut<PendingCommands>,
    mut source: ResMut<crate::core::custom_wgsl::CustomWgslSource>,
    mut shaders: ResMut<Assets<bevy::shader::Shader>>,
) {
    use crate::core::custom_wgsl::{validate_wgsl_source, CUSTOM_WGSL_SHADER_HANDLE};

    const TEMPLATE: &str = include_str!("../shaders/custom_wgsl_template.wgsl");
    const INJECTION_COMMENT: &str = "    // FORGE_USER_CODE_INJECTION_POINT\n    return base_color;";

    for update in pending.custom_wgsl_source_updates.drain(..) {
        // Validate again in the ECS system for safety.
        let validation = validate_wgsl_source(&update.user_code);
        if !validation.valid {
            source.compile_status = "error".to_string();
            source.compile_error = validation.error;
            source.user_code = update.user_code;
            source.name = update.name;
            events::emit_custom_wgsl_source_changed(&source);
            continue;
        }

        // Inject user code into the template, replacing the placeholder.
        let user_code_indented = update
            .user_code
            .lines()
            .map(|line| format!("    {}", line))
            .collect::<Vec<_>>()
            .join("\n");

        let composed = TEMPLATE.replace(INJECTION_COMMENT, &user_code_indented);

        // Hot-swap the Shader asset. Bevy detects asset changes and recompiles
        // render pipelines for all materials using CUSTOM_WGSL_SHADER_HANDLE.
        if let Err(err) = shaders.insert(
            CUSTOM_WGSL_SHADER_HANDLE.id(),
            bevy::shader::Shader::from_wgsl(composed, "shaders/custom_wgsl_user.wgsl"),
        ) {
            source.compile_status = "error".to_string();
            source.compile_error = Some(format!("Shader asset insert failed: {err}"));
            tracing::error!("Failed to hot-swap custom WGSL shader: {err}");
        } else {
            source.compile_status = "ok".to_string();
            source.compile_error = None;
            tracing::info!("Custom WGSL shader hot-swapped: {}", update.name);
        }

        source.user_code = update.user_code;
        source.name = update.name;
        events::emit_custom_wgsl_source_changed(&source);
    }
}

/// System that syncs time to all CustomWgslMaterial entities each frame.
///
/// Also syncs user_params and user_color from ShaderEffectData when present,
/// so per-entity parameter variation is possible even with a shared shader source.
pub(super) fn sync_custom_wgsl_uniforms(
    time: Res<Time>,
    shader_query: Query<(
        Option<&ShaderEffectData>,
        &MeshMaterial3d<crate::core::custom_wgsl::CustomWgslMaterial>,
    )>,
    mut custom_materials: ResMut<Assets<crate::core::custom_wgsl::CustomWgslMaterial>>,
) {
    let t = time.elapsed_secs();
    for (shader_data, handle) in shader_query.iter() {
        if let Some(mat) = custom_materials.get_mut(handle) {
            mat.extension.time = t;
            if let Some(data) = shader_data {
                mat.extension.user_color = Vec4::new(
                    data.custom_color[0],
                    data.custom_color[1],
                    data.custom_color[2],
                    data.custom_color[3],
                );
            }
        }
    }
}
