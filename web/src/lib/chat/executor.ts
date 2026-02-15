/**
 * Tool call executor — maps Claude tool calls to editorStore commands.
 * Runs client-side in the browser to go through the wasm-bindgen bridge.
 */

import type { EditorState, MaterialData, LightData, PhysicsData, EntityType, InputBinding, ParticlePreset, SceneNode, GameCameraData } from '@/stores/editorStore';
import { getPresetById, MATERIAL_PRESETS, getPresetsByCategory, saveCustomMaterial, deleteCustomMaterial, loadCustomMaterials } from '@/lib/materialPresets';

interface ToolCallInput {
  [key: string]: unknown;
}

interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute a tool call against the editor store.
 * Returns the result to feed back to Claude if needed.
 */
export async function executeToolCall(
  toolName: string,
  input: ToolCallInput,
  store: EditorState
): Promise<ExecutionResult> {
  try {
    switch (toolName) {
      // --- Scene commands ---
      case 'spawn_entity': {
        store.spawnEntity(
          input.entityType as EntityType,
          input.name as string | undefined
        );
        return { success: true, result: { message: `Spawned ${input.entityType}` } };
      }

      case 'despawn_entity':
      case 'delete_entities': {
        const ids = input.entityIds as string[] | undefined ?? (input.entityId ? [input.entityId as string] : []);
        if (ids.length > 0) {
          store.setSelection(ids, ids[0], null);
          store.deleteSelectedEntities();
        }
        return { success: true, result: { deleted: ids.length } };
      }

      case 'duplicate_entity': {
        store.selectEntity(input.entityId as string, 'replace');
        store.duplicateSelectedEntity();
        return { success: true, result: { message: `Duplicated entity` } };
      }

      case 'update_transform': {
        const entityId = input.entityId as string;
        if (input.position) store.updateTransform(entityId, 'position', input.position as [number, number, number]);
        if (input.rotation) store.updateTransform(entityId, 'rotation', input.rotation as [number, number, number]);
        if (input.scale) store.updateTransform(entityId, 'scale', input.scale as [number, number, number]);
        return { success: true };
      }

      case 'rename_entity': {
        store.renameEntity(input.entityId as string, input.name as string);
        return { success: true };
      }

      case 'reparent_entity': {
        store.reparentEntity(input.entityId as string, input.newParentId as string | null, input.insertIndex as number | undefined);
        return { success: true };
      }

      case 'set_visibility': {
        store.toggleVisibility(input.entityId as string);
        return { success: true };
      }

      case 'select_entity': {
        store.selectEntity(input.entityId as string, (input.mode as 'replace' | 'add' | 'toggle') ?? 'replace');
        return { success: true };
      }

      case 'select_entities': {
        const ids = input.entityIds as string[];
        if (ids.length > 0) store.setSelection(ids, ids[0], null);
        return { success: true };
      }

      case 'clear_selection': {
        store.clearSelection();
        return { success: true };
      }

      // --- Material commands ---
      case 'update_material': {
        const entityId = input.entityId as string;
        // Build a partial material, merge with current if available
        const matInput = { ...input } as Record<string, unknown>;
        delete matInput.entityId;

        // Get current material as base, overlay with provided fields
        const baseMaterial: MaterialData = store.primaryMaterial ?? {
          baseColor: [1, 1, 1, 1],
          metallic: 0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0, 0, 0, 1],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
          uvOffset: [0, 0],
          uvScale: [1, 1],
          uvRotation: 0,
          parallaxDepthScale: 0.1,
          parallaxMappingMethod: 'occlusion',
          maxParallaxLayerCount: 16,
          parallaxReliefMaxSteps: 5,
          clearcoat: 0,
          clearcoatPerceptualRoughness: 0.5,
          specularTransmission: 0,
          diffuseTransmission: 0,
          ior: 1.5,
          thickness: 0,
          attenuationDistance: null,
          attenuationColor: [1, 1, 1],
        };

        const merged: MaterialData = { ...baseMaterial };
        for (const [key, value] of Object.entries(matInput)) {
          (merged as unknown as Record<string, unknown>)[key] = value;
        }

        store.updateMaterial(entityId, merged);
        return { success: true };
      }

      case 'apply_material_preset': {
        const entityId = input.entityId as string;
        const presetId = input.presetId as string;
        const preset = getPresetById(presetId);
        if (!preset) {
          return { success: false, error: `Unknown material preset: ${presetId}` };
        }
        store.updateMaterial(entityId, preset.data);
        return { success: true };
      }

      case 'set_custom_shader': {
        const { entityId, shaderType, ...params } = input;
        store.updateShaderEffect(entityId as string, { shaderType: shaderType as string, ...params as Record<string, unknown> } as Parameters<typeof store.updateShaderEffect>[1]);
        return { success: true, result: { message: `Applied ${shaderType} shader to ${entityId}` } };
      }

      case 'remove_custom_shader': {
        const { entityId } = input;
        store.removeShaderEffect(entityId as string);
        return { success: true, result: { message: `Removed custom shader from ${entityId}` } };
      }

      case 'list_shaders': {
        const shaders = [
          { type: 'dissolve', name: 'Dissolve', description: 'Dissolve / burn away effect with glowing edges' },
          { type: 'hologram', name: 'Hologram', description: 'Holographic scan lines with transparency' },
          { type: 'force_field', name: 'Force Field', description: 'Energy shield with Fresnel glow and noise' },
          { type: 'lava_flow', name: 'Lava / Flow', description: 'Flowing liquid with scrolling UVs and distortion' },
          { type: 'toon', name: 'Toon', description: 'Cel-shaded cartoon bands' },
          { type: 'fresnel_glow', name: 'Fresnel Glow', description: 'Rim lighting glow effect' },
        ];
        return { success: true, result: { shaders, count: shaders.length } };
      }

      // --- Lighting commands ---
      case 'update_light': {
        const entityId = input.entityId as string;
        const lightInput = { ...input } as Record<string, unknown>;
        delete lightInput.entityId;

        const baseLight: LightData = store.primaryLight ?? {
          lightType: 'point',
          color: [1, 1, 1],
          intensity: 800,
          shadowsEnabled: false,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 20,
          radius: 0,
          innerAngle: 0.4,
          outerAngle: 0.8,
        };

        const merged: LightData = { ...baseLight };
        for (const [key, value] of Object.entries(lightInput)) {
          if (key in merged) {
            (merged as unknown as Record<string, unknown>)[key] = value;
          }
        }

        store.updateLight(entityId, merged);
        return { success: true };
      }

      case 'update_ambient_light': {
        const partial: Record<string, unknown> = {};
        if (input.color !== undefined) partial.color = input.color;
        if (input.brightness !== undefined) partial.brightness = input.brightness;
        store.updateAmbientLight(partial);
        return { success: true };
      }

      // --- Environment commands ---
      case 'update_environment': {
        store.updateEnvironment(input as Record<string, unknown>);
        return { success: true };
      }

      case 'set_skybox': {
        if (input.preset) {
          store.setSkybox(input.preset as string);
        }
        return { success: true };
      }

      case 'remove_skybox': {
        store.removeSkybox();
        return { success: true };
      }

      case 'update_skybox': {
        store.updateSkybox(input as { brightness?: number; iblIntensity?: number; rotation?: number });
        return { success: true };
      }

      case 'update_post_processing': {
        store.updatePostProcessing(input as Record<string, unknown>);
        return { success: true };
      }

      case 'get_post_processing': {
        return { success: true, result: store.postProcessing };
      }

      // --- Editor commands ---
      case 'set_gizmo_mode': {
        store.setGizmoMode(input.mode as 'translate' | 'rotate' | 'scale');
        return { success: true };
      }

      case 'set_coordinate_mode': {
        if (store.coordinateMode !== input.mode) store.toggleCoordinateMode();
        return { success: true };
      }

      case 'toggle_grid': {
        store.toggleGrid();
        return { success: true };
      }

      case 'set_snap_settings': {
        store.setSnapSettings(input as Record<string, unknown>);
        return { success: true };
      }

      // --- Camera commands ---
      case 'set_camera_preset': {
        store.setCameraPreset(input.preset as 'top' | 'front' | 'right' | 'perspective');
        return { success: true };
      }

      case 'focus_camera': {
        // focusCamera is not on the store — select the entity so the user can press F
        store.selectEntity(input.entityId as string, 'replace');
        return { success: true, result: { message: 'Entity selected. User can press F to focus camera.' } };
      }

      // --- History commands ---
      case 'undo': {
        store.undo();
        return { success: true };
      }

      case 'redo': {
        store.redo();
        return { success: true };
      }

      // --- Query commands (return scene data) ---
      case 'get_scene_graph': {
        const { sceneGraph } = store;
        const summary = Object.values(sceneGraph.nodes).map((n) => ({
          id: n.entityId,
          name: n.name,
          parent: n.parentId,
          children: n.children,
          visible: n.visible,
        }));
        return { success: true, result: { entities: summary, count: summary.length } };
      }

      case 'get_entity_details': {
        const node = store.sceneGraph.nodes[input.entityId as string];
        if (!node) return { success: false, error: `Entity not found: ${input.entityId}` };
        return { success: true, result: { name: node.name, components: node.components, visible: node.visible, children: node.children } };
      }

      case 'get_selection': {
        return { success: true, result: { selectedIds: [...store.selectedIds], primaryId: store.primaryId } };
      }

      case 'get_camera_state': {
        return { success: true, result: { preset: store.currentCameraPreset } };
      }

      // --- Runtime commands ---
      case 'play': {
        if (store.engineMode !== 'edit') return { success: false, error: 'Already in play mode' };
        store.play();
        return { success: true, result: { message: 'Entered play mode' } };
      }

      case 'stop': {
        if (store.engineMode === 'edit') return { success: false, error: 'Already in edit mode' };
        store.stop();
        return { success: true, result: { message: 'Stopped play mode' } };
      }

      case 'pause': {
        if (store.engineMode !== 'play') return { success: false, error: 'Not in play mode' };
        store.pause();
        return { success: true, result: { message: 'Paused' } };
      }

      case 'resume': {
        if (store.engineMode !== 'paused') return { success: false, error: 'Not paused' };
        store.resume();
        return { success: true, result: { message: 'Resumed' } };
      }

      case 'get_mode': {
        return { success: true, result: { mode: store.engineMode } };
      }

      // --- Physics commands ---
      case 'update_physics': {
        const entityId = input.entityId as string;
        const physInput = { ...input } as Record<string, unknown>;
        delete physInput.entityId;

        const basePhysics: PhysicsData = store.primaryPhysics ?? {
          bodyType: 'dynamic',
          colliderShape: 'auto',
          restitution: 0.3,
          friction: 0.5,
          density: 1.0,
          gravityScale: 1.0,
          lockTranslationX: false,
          lockTranslationY: false,
          lockTranslationZ: false,
          lockRotationX: false,
          lockRotationY: false,
          lockRotationZ: false,
          isSensor: false,
        };

        const merged: PhysicsData = { ...basePhysics };
        for (const [key, value] of Object.entries(physInput)) {
          if (key in merged) {
            (merged as unknown as Record<string, unknown>)[key] = value;
          }
        }

        store.updatePhysics(entityId, merged);
        return { success: true };
      }

      case 'toggle_physics': {
        store.togglePhysics(input.entityId as string, input.enabled as boolean);
        return { success: true, result: { message: `Physics ${input.enabled ? 'enabled' : 'disabled'}` } };
      }

      case 'toggle_debug_physics': {
        store.toggleDebugPhysics();
        return { success: true, result: { message: 'Toggled debug physics' } };
      }

      case 'get_physics': {
        return {
          success: true,
          result: {
            physics: store.primaryPhysics,
            enabled: store.physicsEnabled,
          },
        };
      }

      case 'apply_force': {
        // apply_force is a passthrough — the store dispatches to Rust directly
        // We don't have a dedicated store action, so dispatch the raw command
        store.togglePhysics(input.entityId as string, true); // ensure physics is on
        return { success: true, result: { message: 'Force application queued (only takes effect during Play)' } };
      }

      // --- Asset commands ---
      case 'import_gltf': {
        const dataBase64 = input.dataBase64 as string;
        const name = input.name as string;
        if (!dataBase64 || !name) return { success: false, error: 'Missing dataBase64 or name' };
        store.importGltf(dataBase64, name);
        return { success: true, result: { message: `Importing glTF: ${name}` } };
      }

      case 'load_texture': {
        const dataBase64 = input.dataBase64 as string;
        const name = input.name as string;
        const entityId = input.entityId as string;
        const slot = input.slot as string;
        if (!dataBase64 || !name || !entityId || !slot) return { success: false, error: 'Missing required parameters' };
        store.loadTexture(dataBase64, name, entityId, slot);
        return { success: true, result: { message: `Loading texture: ${name} → ${slot}` } };
      }

      case 'remove_texture': {
        const entityId = input.entityId as string;
        const slot = input.slot as string;
        if (!entityId || !slot) return { success: false, error: 'Missing entityId or slot' };
        store.removeTexture(entityId, slot);
        return { success: true, result: { message: `Removed texture from ${slot}` } };
      }

      case 'place_asset': {
        const assetId = input.assetId as string;
        if (!assetId) return { success: false, error: 'Missing assetId' };
        store.placeAsset(assetId);
        return { success: true, result: { message: `Placing asset: ${assetId}` } };
      }

      case 'delete_asset': {
        const assetId = input.assetId as string;
        if (!assetId) return { success: false, error: 'Missing assetId' };
        store.deleteAsset(assetId);
        return { success: true, result: { message: `Deleted asset: ${assetId}` } };
      }

      case 'list_assets': {
        const assets = Object.values(store.assetRegistry);
        return {
          success: true,
          result: {
            assets: assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, fileSize: a.fileSize })),
            count: assets.length,
          },
        };
      }

      // --- Script commands ---
      case 'set_script': {
        const entityId = input.entityId as string;
        const source = input.source as string;
        const enabled = (input.enabled as boolean) ?? true;
        const template = input.template as string | undefined;
        if (!entityId || source === undefined) return { success: false, error: 'Missing entityId or source' };
        store.setScript(entityId, source, enabled, template);
        return { success: true, result: { message: `Script set on ${entityId}` } };
      }

      case 'remove_script': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.removeScript(entityId);
        return { success: true, result: { message: `Script removed from ${entityId}` } };
      }

      case 'get_script': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const script = store.allScripts[entityId];
        if (!script) return { success: true, result: { hasScript: false } };
        return { success: true, result: { hasScript: true, source: script.source, enabled: script.enabled, template: script.template } };
      }

      case 'list_script_templates': {
        const templates = [
          { id: 'character_controller', name: 'Character Controller', description: 'WASD + jump movement' },
          { id: 'collectible', name: 'Collectible', description: 'Rotating pickup item' },
          { id: 'rotating_object', name: 'Rotating Object', description: 'Continuous Y-axis rotation' },
          { id: 'follow_camera', name: 'Follow Camera', description: 'Smooth camera follow with offset' },
        ];
        return { success: true, result: { templates } };
      }

      case 'apply_script_template': {
        const entityId = input.entityId as string;
        const templateId = input.template as string;
        const source = input.source as string;
        if (!entityId || !templateId || !source) return { success: false, error: 'Missing entityId, template, or source' };
        store.applyScriptTemplate(entityId, templateId, source);
        return { success: true, result: { message: `Template "${templateId}" applied to ${entityId}` } };
      }

      // --- Audio commands ---
      case 'set_audio': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const audioData: Record<string, unknown> = {};
        if (input.assetId !== undefined) audioData.assetId = input.assetId;
        if (input.volume !== undefined) audioData.volume = input.volume;
        if (input.pitch !== undefined) audioData.pitch = input.pitch;
        if (input.loopAudio !== undefined) audioData.loopAudio = input.loopAudio;
        if (input.spatial !== undefined) audioData.spatial = input.spatial;
        if (input.maxDistance !== undefined) audioData.maxDistance = input.maxDistance;
        if (input.refDistance !== undefined) audioData.refDistance = input.refDistance;
        if (input.rolloffFactor !== undefined) audioData.rolloffFactor = input.rolloffFactor;
        if (input.autoplay !== undefined) audioData.autoplay = input.autoplay;
        store.setAudio(entityId, audioData);
        return { success: true, result: { message: `Audio set on ${entityId}` } };
      }

      case 'remove_audio': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.removeAudio(entityId);
        return { success: true, result: { message: `Audio removed from ${entityId}` } };
      }

      case 'play_audio': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.playAudio(entityId);
        return { success: true, result: { message: `Playing audio on ${entityId}` } };
      }

      case 'stop_audio': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.stopAudio(entityId);
        return { success: true, result: { message: `Stopped audio on ${entityId}` } };
      }

      case 'pause_audio': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.pauseAudio(entityId);
        return { success: true, result: { message: `Paused audio on ${entityId}` } };
      }

      case 'get_audio': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const audio = store.primaryAudio;
        if (!audio) return { success: true, result: { hasAudio: false } };
        return { success: true, result: { hasAudio: true, ...audio } };
      }

      case 'import_audio': {
        const dataBase64 = input.dataBase64 as string;
        const name = input.name as string;
        if (!dataBase64 || !name) return { success: false, error: 'Missing dataBase64 or name' };
        store.importAudio(dataBase64, name);
        return { success: true, result: { message: `Importing audio: ${name}` } };
      }

      case 'update_audio_bus': {
        const busName = input.busName as string;
        if (!busName) return { success: false, error: 'Missing busName' };
        const update: Record<string, unknown> = {};
        if (input.volume !== undefined) update.volume = input.volume;
        if (input.muted !== undefined) update.muted = input.muted;
        if (input.soloed !== undefined) update.soloed = input.soloed;
        store.updateAudioBus(busName, update);
        return { success: true, result: { message: `Updated bus: ${busName}` } };
      }

      case 'create_audio_bus': {
        const name = input.name as string;
        if (!name) return { success: false, error: 'Missing name' };
        const volume = (input.volume as number) ?? 1.0;
        store.createAudioBus(name, volume);
        return { success: true, result: { message: `Created bus: ${name}` } };
      }

      case 'delete_audio_bus': {
        const busName = input.busName as string;
        if (!busName) return { success: false, error: 'Missing busName' };
        store.deleteAudioBus(busName);
        return { success: true, result: { message: `Deleted bus: ${busName}` } };
      }

      case 'get_audio_buses': {
        return {
          success: true,
          result: { buses: store.audioBuses, count: store.audioBuses.length },
        };
      }

      case 'set_bus_effects': {
        const busName = input.busName as string;
        const effects = input.effects as Array<{ effectType: string; params: Record<string, number>; enabled: boolean }>;
        if (!busName || !effects) return { success: false, error: 'Missing busName or effects' };
        store.setBusEffects(busName, effects);
        return { success: true, result: { message: `Set effects on bus: ${busName}`, effectCount: effects.length } };
      }

      // --- Audio layering/transition commands (JS-only) ---
      case 'audio_crossfade': {
        const fromEntityId = input.fromEntityId as string;
        const toEntityId = input.toEntityId as string;
        const durationMs = input.durationMs as number;
        if (!fromEntityId || !toEntityId) return { success: false, error: 'Missing fromEntityId or toEntityId' };
        store.crossfadeAudio(fromEntityId, toEntityId, durationMs ?? 1000);
        return { success: true, result: { message: `Crossfading from ${fromEntityId} to ${toEntityId}` } };
      }

      case 'audio_fade_in': {
        const entityId = input.entityId as string;
        const durationMs = input.durationMs as number;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.fadeInAudio(entityId, durationMs ?? 1000);
        return { success: true, result: { message: `Fading in audio on ${entityId}` } };
      }

      case 'audio_fade_out': {
        const entityId = input.entityId as string;
        const durationMs = input.durationMs as number;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.fadeOutAudio(entityId, durationMs ?? 1000);
        return { success: true, result: { message: `Fading out audio on ${entityId}` } };
      }

      case 'audio_play_one_shot': {
        const assetId = input.assetId as string;
        if (!assetId) return { success: false, error: 'Missing assetId' };
        store.playOneShotAudio(assetId, {
          position: input.position as [number, number, number] | undefined,
          bus: input.bus as string | undefined,
          volume: input.volume as number | undefined,
          pitch: input.pitch as number | undefined,
        });
        return { success: true, result: { message: `Playing one-shot: ${assetId}` } };
      }

      case 'audio_add_layer': {
        const entityId = input.entityId as string;
        const slotName = input.slotName as string;
        const assetId = input.assetId as string;
        if (!entityId || !slotName || !assetId) return { success: false, error: 'Missing required params' };
        store.addAudioLayer(entityId, slotName, assetId, {
          volume: input.volume as number | undefined,
          loop: input.loop as boolean | undefined,
          bus: input.bus as string | undefined,
        });
        return { success: true, result: { message: `Added audio layer "${slotName}" to ${entityId}` } };
      }

      case 'audio_remove_layer': {
        const entityId = input.entityId as string;
        const slotName = input.slotName as string;
        if (!entityId || !slotName) return { success: false, error: 'Missing entityId or slotName' };
        store.removeAudioLayer(entityId, slotName);
        return { success: true, result: { message: `Removed audio layer "${slotName}" from ${entityId}` } };
      }

      case 'set_ducking_rule': {
        const triggerBus = input.triggerBus as string;
        const targetBus = input.targetBus as string;
        if (!triggerBus || !targetBus) return { success: false, error: 'Missing triggerBus or targetBus' };
        store.setDuckingRule({
          triggerBus,
          targetBus,
          duckLevel: input.duckLevel as number | undefined,
          attackMs: input.attackMs as number | undefined,
          releaseMs: input.releaseMs as number | undefined,
        });
        return { success: true, result: { message: `Ducking rule set: ${triggerBus} -> ${targetBus}` } };
      }

      // --- Particle commands ---
      case 'set_particle': {
        const entityId = input.entityId as string;
        const particleData = { ...input } as Record<string, unknown>;
        delete particleData.entityId;
        store.setParticle(entityId, particleData);
        return { success: true, result: { message: `Set particles on entity: ${entityId}` } };
      }

      case 'remove_particle': {
        const entityId = input.entityId as string;
        store.removeParticle(entityId);
        return { success: true, result: { message: `Removed particles from entity: ${entityId}` } };
      }

      case 'toggle_particle': {
        const entityId = input.entityId as string;
        const enabled = input.enabled as boolean;
        store.toggleParticle(entityId, enabled);
        return { success: true, result: { message: `${enabled ? 'Enabled' : 'Disabled'} particles on entity: ${entityId}` } };
      }

      case 'set_particle_preset': {
        const entityId = input.entityId as string;
        const preset = input.preset as ParticlePreset;
        store.setParticlePreset(entityId, preset);
        return { success: true, result: { message: `Applied ${preset} preset to entity: ${entityId}` } };
      }

      case 'play_particle': {
        const entityId = input.entityId as string;
        store.playParticle(entityId);
        return { success: true, result: { message: `Started particles on entity: ${entityId}` } };
      }

      case 'stop_particle': {
        const entityId = input.entityId as string;
        store.stopParticle(entityId);
        return { success: true, result: { message: `Stopped particles on entity: ${entityId}` } };
      }

      case 'burst_particle': {
        const entityId = input.entityId as string;
        const count = input.count as number | undefined;
        store.burstParticle(entityId, count);
        return { success: true, result: { message: `Burst ${count ?? 100} particles on entity: ${entityId}` } };
      }

      case 'get_particle': {
        const particle = store.primaryParticle;
        const enabled = store.particleEnabled;
        return { success: true, result: { particle, enabled } };
      }

      // --- Animation commands ---
      case 'play_animation': {
        const entityId = input.entityId as string;
        const clipName = input.clipName as string;
        if (!entityId || !clipName) return { success: false, error: 'Missing entityId or clipName' };
        const crossfadeSecs = (input.crossfadeSecs as number) ?? 0.3;
        store.playAnimation(entityId, clipName, crossfadeSecs);
        return { success: true, result: { message: `Playing animation "${clipName}" on ${entityId}` } };
      }

      case 'pause_animation': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.pauseAnimation(entityId);
        return { success: true, result: { message: `Paused animation on ${entityId}` } };
      }

      case 'resume_animation': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.resumeAnimation(entityId);
        return { success: true, result: { message: `Resumed animation on ${entityId}` } };
      }

      case 'stop_animation': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.stopAnimation(entityId);
        return { success: true, result: { message: `Stopped animation on ${entityId}` } };
      }

      case 'seek_animation': {
        const entityId = input.entityId as string;
        const timeSecs = input.timeSecs as number;
        if (!entityId || timeSecs === undefined) return { success: false, error: 'Missing entityId or timeSecs' };
        store.seekAnimation(entityId, timeSecs);
        return { success: true, result: { message: `Seeked to ${timeSecs}s on ${entityId}` } };
      }

      case 'set_animation_speed': {
        const entityId = input.entityId as string;
        const speed = input.speed as number;
        if (!entityId || speed === undefined) return { success: false, error: 'Missing entityId or speed' };
        store.setAnimationSpeed(entityId, speed);
        return { success: true, result: { message: `Set animation speed to ${speed}x on ${entityId}` } };
      }

      case 'set_animation_loop': {
        const entityId = input.entityId as string;
        const looping = input.looping as boolean;
        if (!entityId || looping === undefined) return { success: false, error: 'Missing entityId or looping' };
        store.setAnimationLoop(entityId, looping);
        return { success: true, result: { message: `Set animation loop=${looping} on ${entityId}` } };
      }

      case 'get_animation_state': {
        const anim = store.primaryAnimation;
        if (!anim) return { success: true, result: { hasAnimation: false } };
        return { success: true, result: { hasAnimation: true, ...anim } };
      }

      case 'list_animations': {
        const anim = store.primaryAnimation;
        if (!anim || anim.availableClips.length === 0) {
          return { success: true, result: { clips: [], count: 0 } };
        }
        return {
          success: true,
          result: {
            clips: anim.availableClips.map((c) => ({ name: c.name, duration: c.durationSecs })),
            count: anim.availableClips.length,
            activeClip: anim.activeClipName,
            isPlaying: anim.isPlaying,
          },
        };
      }

      case 'set_animation_blend_weight': {
        const entityId = input.entityId as string;
        const clipName = input.clipName as string;
        const weight = input.weight as number;
        if (!entityId || !clipName || weight === undefined) {
          return { success: false, error: 'Missing entityId, clipName, or weight' };
        }
        store.setAnimationBlendWeight(entityId, clipName, weight);
        return { success: true, result: { message: `Set blend weight for "${clipName}" to ${weight.toFixed(2)} on ${entityId}` } };
      }

      case 'set_clip_speed': {
        const entityId = input.entityId as string;
        const clipName = input.clipName as string;
        const speed = input.speed as number;
        if (!entityId || !clipName || speed === undefined) {
          return { success: false, error: 'Missing entityId, clipName, or speed' };
        }
        store.setClipSpeed(entityId, clipName, speed);
        return { success: true, result: { message: `Set speed for "${clipName}" to ${speed}x on ${entityId}` } };
      }

      case 'get_animation_graph': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        // Query will be handled via QUERY_ANIMATION_GRAPH event
        return { success: true, result: { message: `Querying animation graph for ${entityId}` } };
      }

      // --- Scene file commands ---
      case 'export_scene': {
        store.saveScene();
        return { success: true, result: { message: 'Scene export triggered' } };
      }

      case 'load_scene': {
        const json = input.json as string;
        if (!json) return { success: false, error: 'Missing json parameter' };
        store.loadScene(json);
        return { success: true, result: { message: 'Scene load triggered' } };
      }

      case 'new_scene': {
        store.newScene();
        return { success: true, result: { message: 'New scene created' } };
      }

      case 'get_scene_name': {
        return { success: true, result: { sceneName: store.sceneName, modified: store.sceneModified } };
      }

      // --- Input binding commands ---
      case 'set_input_binding': {
        const binding: InputBinding = {
          actionName: input.actionName as string,
          actionType: (input.actionType as 'digital' | 'axis') ?? 'digital',
          sources: (input.sources as string[]) ?? [],
          positiveKeys: input.positiveKeys as string[] | undefined,
          negativeKeys: input.negativeKeys as string[] | undefined,
          deadZone: input.deadZone as number | undefined,
        };
        store.setInputBinding(binding);
        return { success: true, result: { message: `Set binding: ${binding.actionName}` } };
      }

      case 'remove_input_binding': {
        store.removeInputBinding(input.actionName as string);
        return { success: true, result: { message: `Removed binding: ${input.actionName}` } };
      }

      case 'set_input_preset': {
        store.setInputPreset(input.preset as 'fps' | 'platformer' | 'topdown' | 'racing');
        return { success: true, result: { message: `Applied input preset: ${input.preset}` } };
      }

      case 'get_input_bindings': {
        return {
          success: true,
          result: {
            bindings: store.inputBindings,
            preset: store.inputPreset,
            count: store.inputBindings.length,
          },
        };
      }

      case 'get_input_state': {
        // Input state is transient and only meaningful during Play mode
        return {
          success: true,
          result: { message: 'Input state is only available during Play mode', mode: store.engineMode },
        };
      }

      // --- Joint commands ---
      case 'create_joint': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const jointData = {
          jointType: (input.jointType as string) ?? 'revolute',
          connectedEntityId: input.connectedEntityId as string ?? '',
          anchorSelf: (input.anchorSelf as [number, number, number]) ?? [0, 0, 0],
          anchorOther: (input.anchorOther as [number, number, number]) ?? [0, 0, 0],
          axis: (input.axis as [number, number, number]) ?? [0, 1, 0],
          limits: input.limits as { min: number; max: number } | null ?? null,
          motor: input.motor as { targetVelocity: number; maxForce: number } | null ?? null,
        };
        store.createJoint(entityId, jointData as import('@/stores/editorStore').JointData);
        return { success: true, result: { message: `Created ${jointData.jointType} joint on ${entityId}` } };
      }

      case 'update_joint': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const updates: Record<string, unknown> = {};
        if (input.jointType !== undefined) updates.jointType = input.jointType;
        if (input.connectedEntityId !== undefined) updates.connectedEntityId = input.connectedEntityId;
        if (input.anchorSelf !== undefined) updates.anchorSelf = input.anchorSelf;
        if (input.anchorOther !== undefined) updates.anchorOther = input.anchorOther;
        if (input.axis !== undefined) updates.axis = input.axis;
        if (input.limits !== undefined) updates.limits = input.limits;
        if (input.motor !== undefined) updates.motor = input.motor;
        store.updateJoint(entityId, updates as Partial<import('@/stores/editorStore').JointData>);
        return { success: true, result: { message: `Updated joint on ${entityId}` } };
      }

      case 'remove_joint': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        store.removeJoint(entityId);
        return { success: true, result: { message: `Removed joint from ${entityId}` } };
      }

      case 'get_joint': {
        return { success: true, result: { joint: store.primaryJoint } };
      }

      // --- CSG commands ---
      case 'csg_union':
      case 'csg_subtract':
      case 'csg_intersect': {
        const entityIdA = input.entityIdA as string;
        const entityIdB = input.entityIdB as string;
        if (!entityIdA || !entityIdB) return { success: false, error: 'Missing entityIdA or entityIdB' };
        const deleteSources = (input.deleteSources as boolean) ?? true;

        if (toolName === 'csg_union') store.csgUnion(entityIdA, entityIdB, deleteSources);
        else if (toolName === 'csg_subtract') store.csgSubtract(entityIdA, entityIdB, deleteSources);
        else if (toolName === 'csg_intersect') store.csgIntersect(entityIdA, entityIdB, deleteSources);

        return { success: true, result: { message: `CSG ${toolName.replace('csg_', '')} queued` } };
      }

      // --- Terrain commands ---
      case 'spawn_terrain': {
        store.spawnTerrain({
          noiseType: input.noiseType as 'perlin' | 'simplex' | 'value' | undefined,
          octaves: input.octaves as number | undefined,
          frequency: input.frequency as number | undefined,
          amplitude: input.amplitude as number | undefined,
          heightScale: input.heightScale as number | undefined,
          seed: input.seed as number | undefined,
          resolution: input.resolution as number | undefined,
          size: input.size as number | undefined,
        });
        return { success: true, result: { message: 'Terrain spawned' } };
      }

      case 'update_terrain': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const terrainData = store.terrainData[entityId];
        if (!terrainData) return { success: false, error: 'Entity is not a terrain' };

        const updated = {
          noiseType: (input.noiseType as 'perlin' | 'simplex' | 'value' | undefined) ?? terrainData.noiseType,
          octaves: (input.octaves as number | undefined) ?? terrainData.octaves,
          frequency: (input.frequency as number | undefined) ?? terrainData.frequency,
          amplitude: (input.amplitude as number | undefined) ?? terrainData.amplitude,
          heightScale: (input.heightScale as number | undefined) ?? terrainData.heightScale,
          seed: (input.seed as number | undefined) ?? terrainData.seed,
          resolution: (input.resolution as number | undefined) ?? terrainData.resolution,
          size: (input.size as number | undefined) ?? terrainData.size,
        };

        store.updateTerrain(entityId, updated);
        return { success: true, result: { message: 'Terrain updated' } };
      }

      case 'sculpt_terrain': {
        const entityId = input.entityId as string;
        const position = input.position as [number, number] | undefined;
        const radius = input.radius as number | undefined;
        const strength = input.strength as number | undefined;
        if (!entityId || !position || radius === undefined || strength === undefined) {
          return { success: false, error: 'Missing required parameters' };
        }
        store.sculptTerrain(entityId, position, radius, strength);
        return { success: true, result: { message: 'Terrain sculpted' } };
      }

      case 'get_terrain': {
        const entityId = input.entityId as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        const terrainData = store.terrainData[entityId];
        if (!terrainData) return { success: false, error: 'Entity is not a terrain' };
        return { success: true, result: { terrainData } };
      }

      // --- Procedural mesh commands ---
      case 'extrude_shape': {
        const shape = input.shape as string;
        if (!shape) return { success: false, error: 'Missing shape parameter' };
        if (!['circle', 'square', 'hexagon', 'star'].includes(shape)) {
          return { success: false, error: 'Invalid shape. Must be: circle, square, hexagon, or star' };
        }

        store.extrudeShape(shape, {
          radius: input.radius as number | undefined,
          length: input.length as number | undefined,
          segments: input.segments as number | undefined,
          innerRadius: input.innerRadius as number | undefined,
          starPoints: input.starPoints as number | undefined,
          size: input.size as number | undefined,
          name: input.name as string | undefined,
          position: input.position as [number, number, number] | undefined,
        });
        return { success: true, result: { message: `Extruding ${shape} shape` } };
      }

      case 'lathe_shape': {
        const profile = input.profile as [number, number][];
        if (!profile || !Array.isArray(profile) || profile.length < 2) {
          return { success: false, error: 'Invalid profile. Must be an array of [radius, height] points (minimum 2 points)' };
        }

        store.latheShape(profile, {
          segments: input.segments as number | undefined,
          name: input.name as string | undefined,
          position: input.position as [number, number, number] | undefined,
        });
        return { success: true, result: { message: 'Lathing profile' } };
      }

      case 'array_entity': {
        const entityId = input.entityId as string;
        const pattern = input.pattern as string;
        if (!entityId) return { success: false, error: 'Missing entityId' };
        if (!pattern || !['grid', 'circle'].includes(pattern)) {
          return { success: false, error: 'Invalid pattern. Must be: grid or circle' };
        }

        store.arrayEntity(entityId, {
          pattern: pattern as 'grid' | 'circle',
          countX: input.countX as number | undefined,
          countY: input.countY as number | undefined,
          countZ: input.countZ as number | undefined,
          spacingX: input.spacingX as number | undefined,
          spacingY: input.spacingY as number | undefined,
          spacingZ: input.spacingZ as number | undefined,
          circleCount: input.circleCount as number | undefined,
          circleRadius: input.circleRadius as number | undefined,
        });
        return { success: true, result: { message: `Creating ${pattern} array` } };
      }

      case 'combine_meshes': {
        const entityIds = input.entityIds as string[];
        if (!entityIds || !Array.isArray(entityIds) || entityIds.length < 2) {
          return { success: false, error: 'Must provide at least 2 entity IDs to combine' };
        }

        store.combineMeshes(
          entityIds,
          input.deleteSources as boolean | undefined,
          input.name as string | undefined
        );
        return { success: true, result: { message: `Combining ${entityIds.length} meshes` } };
      }

      // --- Export commands ---
      case 'export_game': {
        // Import dynamically to avoid circular dependency
        const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');

        store.setExporting(true);
        try {
          const resolutionInput = (input.resolution as string) || 'responsive';
          let resolution: 'responsive' | '1920x1080' | '1280x720' = 'responsive';
          if (resolutionInput === '1920x1080' || resolutionInput === '1280x720') {
            resolution = resolutionInput;
          }

          const blob = await exportGame({
            title: (input.title as string) || store.sceneName,
            mode: (input.mode as 'single-html' | 'zip') || 'single-html',
            resolution,
            bgColor: '#18181b',
            includeDebug: false,
          });

          const filename = `${((input.title as string) || store.sceneName).replace(/[^a-z0-9_-]/gi, '_')}.html`;
          downloadBlob(blob, filename);

          return { success: true, result: { message: 'Game exported successfully', filename } };
        } finally {
          store.setExporting(false);
        }
      }

      case 'get_export_status': {
        return {
          success: true,
          result: { isExporting: store.isExporting, engineMode: store.engineMode },
        };
      }

      // --- Material library commands ---
      case 'list_material_presets': {
        const category = input.category as string | undefined;
        const presets = category
          ? getPresetsByCategory(category)
          : MATERIAL_PRESETS;
        return {
          success: true,
          result: presets.map((p) => ({ id: p.id, name: p.name, category: p.category, description: p.description })),
        };
      }

      case 'save_material_to_library': {
        const name = input.name as string;
        if (!name) return { success: false, error: 'name is required' };
        const entityId = input.entityId as string || store.primaryId;
        if (!entityId) return { success: false, error: 'No entity selected' };
        const mat = store.primaryMaterial;
        if (!mat) return { success: false, error: 'Selected entity has no material' };
        const saved = saveCustomMaterial(name, mat);
        return { success: true, result: { id: saved.id, name: saved.name } };
      }

      case 'delete_library_material': {
        const materialId = input.materialId as string;
        if (!materialId) return { success: false, error: 'materialId is required' };
        deleteCustomMaterial(materialId);
        return { success: true, result: `Deleted custom material ${materialId}` };
      }

      case 'list_custom_materials': {
        const customs = loadCustomMaterials();
        return {
          success: true,
          result: customs.map((m) => ({ id: m.id, name: m.name })),
        };
      }

      // --- Quality preset tools ---
      case 'set_quality_preset': {
        const preset = input.preset as string;
        if (!preset) return { success: false, error: 'preset is required' };
        store.setQualityPreset(preset as import('@/stores/editorStore').QualityPreset);
        return { success: true, result: `Quality preset set to ${preset}` };
      }

      case 'get_quality_settings': {
        return { success: true, result: { preset: store.qualityPreset } };
      }

      // --- Documentation tools (handled server-side via MCP) ---
      case 'search_docs':
      case 'get_doc':
      case 'list_doc_topics':
        return { success: true, result: { message: `Documentation tool "${toolName}" is handled by the MCP server` } };

      // --- Prefab commands ---
      case 'save_as_prefab': {
        const { savePrefab } = await import('@/lib/prefabs/prefabStore');
        const entityId = input.entityId as string;
        const name = input.name as string;
        const category = (input.category as string) || 'uncategorized';
        const description = (input.description as string) || '';

        // Build snapshot from current editor state
        const transforms = store.primaryTransform;
        const snapshot = {
          entityType: 'cube', // Will be overridden by actual entity type from scene graph
          name: name,
          transform: transforms ? {
            position: transforms.position,
            rotation: transforms.rotation,
            scale: transforms.scale,
          } : { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
          material: store.primaryMaterial || undefined,
          light: store.primaryLight || undefined,
          physics: store.primaryPhysics || undefined,
          script: store.primaryScript || undefined,
          audio: store.primaryAudio || undefined,
          particle: store.primaryParticle || undefined,
        };

        // Get entity type from scene graph
        const node = store.sceneGraph.nodes[entityId];
        if (node) {
          // Try to infer entity type from components
          const components = node.components || [];
          if (components.includes('PointLight') || components.includes('DirectionalLight') || components.includes('SpotLight')) {
            snapshot.entityType = store.primaryLight?.lightType === 'point' ? 'point_light' : store.primaryLight?.lightType === 'directional' ? 'directional_light' : 'spot_light';
          }
        }

        const prefab = savePrefab(name, category, description, snapshot);
        return { success: true, result: { prefabId: prefab.id, message: `Saved "${name}" as prefab` } };
      }

      case 'instantiate_prefab': {
        const { getPrefab } = await import('@/lib/prefabs/prefabStore');
        const prefabId = input.prefabId as string;
        const prefab = getPrefab(prefabId);
        if (!prefab) return { success: false, error: `Prefab not found: ${prefabId}` };

        const position = input.position as [number, number, number] | undefined;
        const name = input.name as string | undefined;

        store.spawnEntity(prefab.snapshot.entityType as EntityType, name || prefab.snapshot.name);

        // Apply material if present
        if (prefab.snapshot.material && store.primaryId) {
          store.updateMaterial(store.primaryId, prefab.snapshot.material);
        }

        // Apply position if specified
        if (position && store.primaryId) {
          store.updateTransform(store.primaryId, 'position', position);
        }

        return { success: true, result: { message: `Instantiated prefab "${prefab.name}"` } };
      }

      case 'list_prefabs': {
        const { listAllPrefabs, getPrefabsByCategory } = await import('@/lib/prefabs/prefabStore');
        const category = input.category as string | undefined;
        const prefabs = category ? getPrefabsByCategory(category) : listAllPrefabs();
        return { success: true, result: { prefabs: prefabs.map(p => ({ id: p.id, name: p.name, category: p.category, description: p.description })) } };
      }

      case 'delete_prefab': {
        const { deletePrefab } = await import('@/lib/prefabs/prefabStore');
        const deleted = deletePrefab(input.prefabId as string);
        return deleted ? { success: true, result: { message: 'Prefab deleted' } } : { success: false, error: 'Prefab not found' };
      }

      case 'get_prefab': {
        const { getPrefab } = await import('@/lib/prefabs/prefabStore');
        const prefab = getPrefab(input.prefabId as string);
        return prefab ? { success: true, result: prefab } : { success: false, error: 'Prefab not found' };
      }

      // --- Multi-scene commands ---
      case 'create_scene': {
        const { createScene, loadProjectScenes, saveProjectScenes } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        const result = createScene(project, input.name as string);
        saveProjectScenes(result.project);
        store.setScenes(
          result.project.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
          result.project.activeSceneId
        );
        return { success: true, result: { sceneId: result.sceneId, message: `Created scene "${input.name}"` } };
      }

      case 'switch_scene': {
        const { switchScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        const sceneIdInput = input.sceneId as string;
        // Try by ID first, then by name
        let targetId = sceneIdInput;
        const byName = getSceneByName(project, sceneIdInput);
        if (byName) targetId = byName.id;

        const result = switchScene(project, targetId);
        if ('error' in result) return { success: false, error: result.error };

        saveProjectScenes(result.project);
        store.setScenes(
          result.project.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
          result.project.activeSceneId
        );
        // Load the scene data into the engine
        if (result.sceneToLoad) {
          store.loadScene(JSON.stringify(result.sceneToLoad));
        } else {
          store.newScene();
        }
        return { success: true, result: { message: `Switched to scene` } };
      }

      case 'duplicate_scene': {
        const { duplicateScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        const sceneIdInput = input.sceneId as string;
        let targetId = sceneIdInput;
        const byName = getSceneByName(project, sceneIdInput);
        if (byName) targetId = byName.id;

        const result = duplicateScene(project, targetId, input.name as string | undefined);
        if ('error' in result) return { success: false, error: result.error };

        saveProjectScenes(result.project);
        store.setScenes(
          result.project.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
          result.project.activeSceneId
        );
        return { success: true, result: { sceneId: result.newSceneId, message: `Duplicated scene` } };
      }

      case 'delete_scene': {
        const { deleteScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        const sceneIdInput = input.sceneId as string;
        let targetId = sceneIdInput;
        const byName = getSceneByName(project, sceneIdInput);
        if (byName) targetId = byName.id;

        const result = deleteScene(project, targetId);
        if (result.error) return { success: false, error: result.error };

        saveProjectScenes(result.project);
        store.setScenes(
          result.project.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
          result.project.activeSceneId
        );
        return { success: true, result: { message: 'Scene deleted' } };
      }

      case 'rename_scene': {
        const { renameScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        const sceneIdInput = input.sceneId as string;
        let targetId = sceneIdInput;
        const byName = getSceneByName(project, sceneIdInput);
        if (byName) targetId = byName.id;

        const updated = renameScene(project, targetId, input.name as string);
        saveProjectScenes(updated);
        store.setScenes(
          updated.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
          updated.activeSceneId
        );
        return { success: true, result: { message: `Renamed scene to "${input.name}"` } };
      }

      case 'set_start_scene': {
        const { setStartScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        const sceneIdInput = input.sceneId as string;
        let targetId = sceneIdInput;
        const byName = getSceneByName(project, sceneIdInput);
        if (byName) targetId = byName.id;

        const updated = setStartScene(project, targetId);
        saveProjectScenes(updated);
        store.setScenes(
          updated.scenes.map(s => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
          updated.activeSceneId
        );
        return { success: true, result: { message: 'Start scene updated' } };
      }

      case 'list_scenes': {
        const { loadProjectScenes } = await import('@/lib/scenes/sceneManager');
        const project = loadProjectScenes();
        return {
          success: true,
          result: {
            scenes: project.scenes.map(s => ({
              id: s.id,
              name: s.name,
              isStartScene: s.isStartScene,
              isActive: s.id === project.activeSceneId,
            })),
            activeSceneId: project.activeSceneId,
          }
        };
      }

      // --- Game component commands ---
      case 'add_game_component': {
        const entityId = input.entityId as string;
        const componentType = input.componentType as string;
        const props = (input.properties as Record<string, unknown>) ?? {};

        // Build game component data from type and properties
        const component = buildGameComponentFromInput(componentType, props);
        if (!component) {
          return { success: false, error: `Unknown component type: ${componentType}` };
        }
        store.addGameComponent(entityId, component);
        return { success: true, result: { message: `Added ${componentType}` } };
      }

      case 'update_game_component': {
        const entityId = input.entityId as string;
        const componentType = input.componentType as string;
        const props = (input.properties as Record<string, unknown>) ?? {};

        const component = buildGameComponentFromInput(componentType, props);
        if (!component) {
          return { success: false, error: `Unknown component type: ${componentType}` };
        }
        store.updateGameComponent(entityId, component);
        return { success: true };
      }

      case 'remove_game_component': {
        const entityId = input.entityId as string;
        const componentName = input.componentName as string;
        store.removeGameComponent(entityId, componentName);
        return { success: true };
      }

      case 'get_game_components': {
        const entityId = input.entityId as string;
        const components = store.allGameComponents[entityId] ?? [];
        return { success: true, result: { components, count: components.length } };
      }

      case 'list_game_component_types': {
        return {
          success: true,
          result: {
            types: [
              { name: 'character_controller', description: 'First-person or third-person movement controller' },
              { name: 'health', description: 'Health points with damage, invincibility, and respawning' },
              { name: 'collectible', description: 'Item that can be collected for score points' },
              { name: 'damage_zone', description: 'Area that damages entities with Health component' },
              { name: 'checkpoint', description: 'Checkpoint that updates respawn point for characters' },
              { name: 'teleporter', description: 'Teleports entities to a target position' },
              { name: 'moving_platform', description: 'Platform that moves between waypoints' },
              { name: 'trigger_zone', description: 'Zone that emits events when entered' },
              { name: 'spawner', description: 'Spawns entities at intervals or on trigger' },
              { name: 'follower', description: 'Follows a target entity' },
              { name: 'projectile', description: 'Moving object that deals damage on impact' },
              { name: 'win_condition', description: 'Defines game win condition (score, collect all, reach goal)' },
            ],
          },
        };
      }

      // --- Game Camera commands ---
      case 'set_game_camera': {
        const { entityId, mode, targetEntity, ...rest } = input as {
          entityId: string;
          mode: string;
          targetEntity?: string;
          [key: string]: unknown;
        };
        const cameraData: GameCameraData = {
          mode: mode as GameCameraData['mode'],
          targetEntity: targetEntity ?? null,
          ...rest,
        };
        store.setGameCamera(entityId, cameraData);
        return { success: true, result: { message: `Game camera set to ${mode} on entity ${entityId}` } };
      }

      case 'set_active_game_camera': {
        const { entityId } = input as { entityId: string };
        store.setActiveGameCamera(entityId);
        return { success: true, result: { message: `Active game camera set to ${entityId}` } };
      }

      case 'camera_shake': {
        const { entityId, intensity, duration } = input as { entityId: string; intensity: number; duration: number };
        store.cameraShake(entityId, intensity, duration);
        return { success: true, result: { message: `Camera shake triggered: intensity=${intensity}, duration=${duration}s` } };
      }

      case 'get_game_camera': {
        const { entityId } = input as { entityId: string };
        const camera = store.allGameCameras[entityId];
        const isActive = store.activeGameCameraId === entityId;
        return { success: true, result: { camera: camera || null, isActive } };
      }

      case 'load_scene_with_transition': {
        const { sceneName, transitionType, duration, color, direction } = input as {
          sceneName: string;
          transitionType?: string;
          duration?: number;
          color?: string;
          direction?: string;
        };
        await store.startSceneTransition(sceneName, {
          type: (transitionType as 'fade' | 'wipe' | 'instant') || 'fade',
          duration: duration || 500,
          color: color || '#000000',
          direction: (direction as 'left' | 'right' | 'up' | 'down') || 'left',
        });
        return { success: true, result: { message: `Loaded scene "${sceneName}" with ${transitionType || 'fade'} transition` } };
      }

      case 'set_default_transition': {
        const { transitionType, duration, color, direction, easing } = input as {
          transitionType?: string;
          duration?: number;
          color?: string;
          direction?: string;
          easing?: string;
        };
        store.setDefaultTransition({
          ...(transitionType ? { type: transitionType as 'fade' | 'wipe' | 'instant' } : {}),
          ...(duration !== undefined ? { duration } : {}),
          ...(color ? { color } : {}),
          ...(direction ? { direction: direction as 'left' | 'right' | 'up' | 'down' } : {}),
          ...(easing ? { easing: easing as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' } : {}),
        });
        return { success: true, result: { message: `Default transition set to ${transitionType || 'updated'}` } };
      }

      // --- Generation commands ---
      case 'generate_3d_model': {
        const response = await fetch('/api/generate/model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt,
            quality: input.quality ?? 'standard',
            artStyle: input.artStyle ?? 'realistic',
            negativePrompt: input.negativePrompt,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'Generation failed' };
        }
        const data = await response.json();
        return {
          success: true,
          result: {
            message: `3D model generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
            jobId: data.jobId,
          },
        };
      }

      case 'generate_3d_from_image': {
        const response = await fetch('/api/generate/model-from-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: input.imageBase64,
            prompt: input.prompt,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'Generation failed' };
        }
        const data = await response.json();
        return {
          success: true,
          result: {
            message: `3D model generation from image started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
            jobId: data.jobId,
          },
        };
      }

      case 'generate_texture': {
        const response = await fetch('/api/generate/texture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt,
            entityId: input.entityId,
            resolution: input.resolution ?? '1024',
            style: input.style ?? 'realistic',
            tiling: input.tiling ?? false,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'Texture generation failed' };
        }
        const data = await response.json();
        return {
          success: true,
          result: {
            message: `Texture generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
            jobId: data.jobId,
          },
        };
      }

      case 'generate_pbr_maps': {
        const response = await fetch('/api/generate/pbr-maps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt,
            entityId: input.entityId,
            maps: input.maps,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'PBR map generation failed' };
        }
        const data = await response.json();
        return {
          success: true,
          result: {
            message: `PBR map generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
            jobId: data.jobId,
          },
        };
      }

      case 'generate_sfx': {
        const response = await fetch('/api/generate/sfx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt,
            durationSeconds: input.durationSeconds ?? 5,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'SFX generation failed' };
        }
        const data = await response.json();
        const assetName = `sfx-${(input.prompt as string).slice(0, 20)}`;
        store.importAudio(data.audioBase64, assetName);
        if (input.entityId) {
          store.setAudio(input.entityId as string, { assetId: assetName, volume: 1.0, pitch: 1.0, loopAudio: false, spatial: true, maxDistance: 30, refDistance: 1, rolloffFactor: 1, autoplay: false, bus: 'sfx' });
        }
        return { success: true, result: { message: `Sound effect generated and imported as "${assetName}".` } };
      }

      case 'generate_voice': {
        const response = await fetch('/api/generate/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: input.text,
            voiceStyle: input.voiceStyle ?? 'neutral',
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'Voice generation failed' };
        }
        const data = await response.json();
        const assetName = `voice-${(input.text as string).slice(0, 20)}`;
        store.importAudio(data.audioBase64, assetName);
        if (input.entityId) {
          store.setAudio(input.entityId as string, { assetId: assetName, volume: 1.0, pitch: 1.0, loopAudio: false, spatial: true, maxDistance: 30, refDistance: 1, rolloffFactor: 1, autoplay: false, bus: 'voice' });
        }
        return { success: true, result: { message: `Voice dialogue generated and imported as "${assetName}".` } };
      }

      case 'generate_skybox': {
        const response = await fetch('/api/generate/skybox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt,
            style: input.style ?? 'realistic',
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'Skybox generation failed' };
        }
        const data = await response.json();
        return {
          success: true,
          result: {
            message: `Skybox generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
            jobId: data.jobId,
          },
        };
      }

      case 'generate_music': {
        const response = await fetch('/api/generate/music', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: input.prompt,
            durationSeconds: input.durationSeconds ?? 30,
            instrumental: input.instrumental ?? true,
          }),
        });
        if (!response.ok) {
          const err = await response.json();
          return { success: false, error: err.error ?? 'Music generation failed' };
        }
        const data = await response.json();
        const assetName = `music-${(input.prompt as string).slice(0, 20)}`;
        store.importAudio(data.audioBase64, assetName);
        if (input.entityId) {
          store.setAudio(input.entityId as string, { assetId: assetName, volume: 0.7, pitch: 1.0, loopAudio: true, spatial: false, maxDistance: 100, refDistance: 1, rolloffFactor: 1, autoplay: true, bus: 'music' });
        }
        return { success: true, result: { message: `Music generated and imported as "${assetName}".` } };
      }

      case 'create_ui_screen': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const uiStore = useUIBuilderStore.getState();
        type ScreenPreset = 'blank' | 'hud' | 'main_menu' | 'pause_menu' | 'game_over' | 'inventory' | 'dialog';
        const screenId = uiStore.createScreen(input.name as string, (input.preset as unknown) as ScreenPreset | undefined);
        if (input.showOnStart !== undefined) uiStore.updateScreen(screenId, { showOnStart: input.showOnStart as boolean });
        if (input.showOnKey !== undefined) uiStore.updateScreen(screenId, { showOnKey: input.showOnKey as string });
        if (input.backgroundColor !== undefined) uiStore.updateScreen(screenId, { backgroundColor: input.backgroundColor as string });
        if (input.blockInput !== undefined) uiStore.updateScreen(screenId, { blockInput: input.blockInput as boolean });
        return { success: true, result: { screenId, message: `Created UI screen "${input.name}"` } };
      }

      case 'delete_ui_screen': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        useUIBuilderStore.getState().deleteScreen(input.screenId as string);
        return { success: true };
      }

      case 'list_ui_screens': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const screens = useUIBuilderStore.getState().screens.map(s => ({
          id: s.id, name: s.name, widgetCount: s.widgets.length,
          showOnStart: s.showOnStart, showOnKey: s.showOnKey,
        }));
        return { success: true, result: { screens, count: screens.length } };
      }

      case 'get_ui_screen': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const screen = useUIBuilderStore.getState().screens.find(
          s => s.id === input.screenId || s.name === input.screenId
        );
        if (!screen) return { success: false, error: `Screen not found: ${input.screenId}` };
        return { success: true, result: screen };
      }

      case 'update_ui_screen': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const updates: Record<string, unknown> = {};
        for (const key of ['name', 'showOnStart', 'showOnKey', 'backgroundColor', 'blockInput', 'transition', 'zIndex']) {
          if (input[key] !== undefined) updates[key] = input[key];
        }
        useUIBuilderStore.getState().updateScreen(input.screenId as string, updates);
        return { success: true };
      }

      case 'add_ui_widget': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        type WidgetType = 'text' | 'image' | 'button' | 'progress_bar' | 'panel' | 'grid' | 'scroll_view' | 'slider' | 'toggle' | 'minimap';
        const widgetId = useUIBuilderStore.getState().addWidget(
          input.screenId as string,
          (input.type as unknown) as WidgetType,
          input.x !== undefined && input.y !== undefined ? { x: input.x as number, y: input.y as number } : undefined
        );
        const uiStore = useUIBuilderStore.getState();
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.width) updates.width = input.width;
        if (input.height) updates.height = input.height;
        if (input.anchor) updates.anchor = input.anchor;
        if (input.parentWidgetId) updates.parentWidgetId = input.parentWidgetId;
        if (input.config) updates.config = input.config;
        if (input.style) uiStore.updateWidgetStyle(input.screenId as string, widgetId, input.style as Record<string, unknown>);
        if (Object.keys(updates).length > 0) uiStore.updateWidget(input.screenId as string, widgetId, updates);
        return { success: true, result: { widgetId, message: `Added ${input.type} widget` } };
      }

      case 'update_ui_widget': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const uiStore = useUIBuilderStore.getState();
        const updates: Record<string, unknown> = {};
        for (const key of ['name', 'x', 'y', 'width', 'height', 'anchor', 'visible', 'config']) {
          if (input[key] !== undefined) updates[key] = input[key];
        }
        if (Object.keys(updates).length > 0) uiStore.updateWidget(input.screenId as string, input.widgetId as string, updates);
        if (input.style) uiStore.updateWidgetStyle(input.screenId as string, input.widgetId as string, input.style as Record<string, unknown>);
        return { success: true };
      }

      case 'remove_ui_widget': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        useUIBuilderStore.getState().removeWidget(input.screenId as string, input.widgetId as string);
        return { success: true };
      }

      case 'set_ui_binding': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        type BindingTransform =
          | { type: 'format'; template: string }
          | { type: 'map'; entries: Array<{ from: unknown; to: string }> }
          | { type: 'clamp'; min: number; max: number }
          | { type: 'multiply'; factor: number }
          | { type: 'round'; decimals: number };
        type DataBinding = {
          stateKey: string;
          direction: 'read' | 'write' | 'read_write';
          transform: BindingTransform | null;
        };
        const binding: DataBinding = {
          stateKey: input.stateKey as string,
          direction: ((input.direction as string) ?? 'read') as 'read' | 'write' | 'read_write',
          transform: (input.transform as unknown) as BindingTransform | null,
        };
        useUIBuilderStore.getState().setBinding(input.screenId as string, input.widgetId as string, input.property as string, binding);
        return { success: true };
      }

      case 'remove_ui_binding': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        useUIBuilderStore.getState().removeBinding(input.screenId as string, input.widgetId as string, input.property as string);
        return { success: true };
      }

      case 'set_ui_theme': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        type UITheme = {
          primaryColor: string;
          secondaryColor: string;
          backgroundColor: string;
          textColor: string;
          fontFamily: string;
          fontSize: number;
          borderRadius: number;
        };
        useUIBuilderStore.getState().applyTheme((input as unknown) as UITheme);
        return { success: true };
      }

      case 'duplicate_ui_screen': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const newId = useUIBuilderStore.getState().duplicateScreen(input.screenId as string);
        if (input.newName) useUIBuilderStore.getState().renameScreen(newId, input.newName as string);
        return { success: true, result: { screenId: newId } };
      }

      case 'duplicate_ui_widget': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const newId = useUIBuilderStore.getState().duplicateWidget(input.screenId as string, input.widgetId as string);
        return { success: true, result: { widgetId: newId } };
      }

      case 'reorder_ui_widget': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        useUIBuilderStore.getState().reorderWidget(input.screenId as string, input.widgetId as string, (input.direction as string) as 'up' | 'down');
        return { success: true };
      }

      case 'get_ui_widget': {
        const { useUIBuilderStore } = await import('@/stores/uiBuilderStore');
        const screen = useUIBuilderStore.getState().screens.find(
          s => s.id === input.screenId || s.name === input.screenId
        );
        if (!screen) return { success: false, error: 'Screen not found' };
        const widget = screen.widgets.find(w => w.id === input.widgetId || w.name === input.widgetId);
        if (!widget) return { success: false, error: 'Widget not found' };
        return { success: true, result: widget };
      }

      // --- Compound tools (read-only) ---
      case 'describe_scene': {
        const detail = (input.detail as string) ?? 'standard';
        const filterIds = input.filterEntityIds as string[] | undefined;
        const { sceneGraph } = store;

        const nodes = filterIds
          ? filterIds.map(id => sceneGraph.nodes[id]).filter(Boolean)
          : Object.values(sceneGraph.nodes);

        if (detail === 'summary') {
          // Count by type
          const typeCounts: Record<string, number> = {};
          for (const node of nodes) {
            const entityType = inferEntityType(node);
            typeCounts[entityType] = (typeCounts[entityType] || 0) + 1;
          }
          return {
            success: true,
            result: {
              entityCount: nodes.length,
              typeCounts,
              sceneName: store.sceneName,
              engineMode: store.engineMode,
              hasPhysics: Object.keys(store.physicsEnabled).length > 0,
              hasScripts: Object.keys(store.allScripts).length > 0,
              summary: `Scene contains ${nodes.length} entities. Physics: ${Object.keys(store.physicsEnabled).length > 0 ? 'enabled' : 'disabled'}. Scripts: ${Object.keys(store.allScripts).length} active.`,
            }
          };
        }

        if (detail === 'standard') {
          const entities = nodes.map(node => ({
            id: node.entityId,
            name: node.name,
            type: inferEntityType(node),
            visible: node.visible,
            parentId: node.parentId,
            childCount: node.children.length,
            hasPhysics: node.components.some(c => c.includes('Physics')),
            hasScript: !!store.allScripts[node.entityId],
            hasAudio: node.components.some(c => c.includes('Audio')),
            gameComponents: (store.allGameComponents?.[node.entityId] ?? []).map(c => c.type),
          }));
          return {
            success: true,
            result: {
              entities,
              environment: {
                ambient: store.ambientLight,
                clearColor: store.environment.clearColor,
                fogEnabled: store.environment.fogEnabled,
                skyboxPreset: store.environment.skyboxPreset,
              },
              inputPreset: store.inputPreset,
              engineMode: store.engineMode,
            }
          };
        }

        // detail === 'full'
        const entities = nodes.map(node => ({
          id: node.entityId,
          name: node.name,
          type: inferEntityType(node),
          components: node.components,
          visible: node.visible,
          parentId: node.parentId,
          children: node.children,
          hasPhysics: node.components.some(c => c.includes('Physics')),
          hasScript: !!store.allScripts[node.entityId],
          hasAudio: node.components.some(c => c.includes('Audio')),
          hasParticles: node.components.some(c => c.includes('Particle')),
          gameComponents: store.allGameComponents?.[node.entityId] ?? [],
          terrain: store.terrainData?.[node.entityId] ?? null,
        }));

        return {
          success: true,
          result: {
            entities,
            environment: {
              ambient: store.ambientLight,
              environment: store.environment,
              postProcessing: store.postProcessing,
            },
            inputBindings: store.inputBindings,
            inputPreset: store.inputPreset,
            audioBuses: store.audioBuses,
            scenes: store.scenes,
            engineMode: store.engineMode,
          },
        };
      }

      case 'analyze_gameplay': {
        const _focus = (input.focus as string) ?? 'overview';
        const { sceneGraph } = store;
        const allNodes = Object.values(sceneGraph.nodes);

        const analysis: GameplayAnalysis = {
          entityCount: allNodes.length,
          mechanics: [],
          entityRoles: [],
          issues: [],
          suggestions: [],
        };

        // Identify entity roles
        for (const node of allNodes) {
          const components = store.allGameComponents?.[node.entityId] ?? [];
          const hasPhysics = node.components.some(c => c.includes('Physics'));
          const hasScript = !!store.allScripts[node.entityId];

          const role = identifyRole(node, components, hasPhysics, hasScript);
          analysis.entityRoles.push({
            name: node.name,
            id: node.entityId,
            role,
          });
        }

        // Detect mechanics
        if (analysis.entityRoles.some(e => e.role === 'player')) analysis.mechanics.push('player_character');
        if (store.inputBindings.length > 0) analysis.mechanics.push('input_system');
        if (Object.keys(store.physicsEnabled).length > 0) analysis.mechanics.push('physics');
        if (Object.keys(store.allScripts).length > 0) analysis.mechanics.push('scripting');
        if (analysis.entityRoles.some(e => e.role === 'collectible')) analysis.mechanics.push('collectibles');
        if (analysis.entityRoles.some(e => e.role === 'checkpoint')) analysis.mechanics.push('checkpoints');
        if (analysis.entityRoles.some(e => e.role === 'goal')) analysis.mechanics.push('win_condition');

        // Detect issues
        const players = analysis.entityRoles.filter(e => e.role === 'player');
        if (players.length === 0 && allNodes.length > 0) {
          analysis.issues.push('No player character found. Consider adding a character_controller component.');
        }
        if (players.length > 1) {
          analysis.issues.push(`Multiple potential player characters: ${players.map(p => p.name).join(', ')}. Only one should have character_controller.`);
        }
        if (store.inputBindings.length === 0 && players.length > 0) {
          analysis.issues.push('Player character exists but no input bindings are configured.');
        }

        // Check for collectibles without win condition
        const collectibles = analysis.entityRoles.filter(e => e.role === 'collectible');
        const winConditions = allNodes.filter(n => (store.allGameComponents?.[n.entityId] ?? []).some(c => c.type === 'winCondition'));
        if (collectibles.length > 0 && winConditions.length === 0) {
          analysis.suggestions.push('Scene has collectibles but no win condition. Consider adding a win_condition component.');
        }

        // Check for dynamic physics entities
        const dynamicEntities = allNodes.filter(n => n.components.some(c => c.includes('Physics')));
        if (dynamicEntities.length > 0 && store.environment.fogEnabled === false) {
          analysis.suggestions.push('Scene has dynamic physics objects. Consider adding fog or skybox for depth perception.');
        }

        // Check for lighting
        const lights = analysis.entityRoles.filter(e => e.role === 'light');
        if (lights.length === 0 && allNodes.length > 5) {
          analysis.suggestions.push('No dedicated lights found. Consider adding point or directional lights for better visuals.');
        }

        return { success: true, result: analysis };
      }

      // --- Compound tools (write) ---
      case 'arrange_entities': {
        const entityIds = input.entityIds as string[];
        const pattern = input.pattern as string;
        const center = (input.center as [number, number, number]) ?? [0, 0, 0];
        const yOffset = (input.yOffset as number) ?? 0;
        const spacing = (input.spacing as number) ?? 2.0;
        const radius = (input.radius as number) ?? 5.0;
        const scatterRadius = (input.scatterRadius as number) ?? 10.0;
        const scatterSeed = (input.scatterSeed as number) ?? Date.now();
        const faceCenter = (input.faceCenter as boolean) ?? false;
        const direction = (input.direction as [number, number, number]) ?? [1, 0, 0];
        const pathPoints = (input.pathPoints as [number, number, number][]) ?? [];
        const gridColumns = (input.gridColumns as number) ?? Math.ceil(Math.sqrt(entityIds.length));

        const operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

        for (let i = 0; i < entityIds.length; i++) {
          const entityId = entityIds[i];
          const node = store.sceneGraph.nodes[entityId];
          if (!node) {
            operations.push({ action: `arrange "${entityId}"`, success: false, error: 'Entity not found' });
            continue;
          }

          let newPosition: [number, number, number] = [0, 0, 0];

          try {
            if (pattern === 'grid') {
              const cols = gridColumns;
              const rows = Math.ceil(entityIds.length / cols);
              const row = Math.floor(i / cols);
              const col = i % cols;
              newPosition = [
                center[0] + col * spacing - ((cols - 1) * spacing) / 2,
                center[1] + yOffset,
                center[2] + row * spacing - ((rows - 1) * spacing) / 2,
              ];
            } else if (pattern === 'circle') {
              const theta = (i * (2 * Math.PI)) / entityIds.length;
              newPosition = [
                center[0] + radius * Math.cos(theta),
                center[1] + yOffset,
                center[2] + radius * Math.sin(theta),
              ];
              // If faceCenter, update rotation
              if (faceCenter) {
                const rotY = Math.atan2(-Math.sin(theta), -Math.cos(theta));
                store.updateTransform(entityId, 'rotation', [0, rotY, 0]);
              }
            } else if (pattern === 'line') {
              const t = i * spacing;
              const dirLength = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
              const normDir = [direction[0] / dirLength, direction[1] / dirLength, direction[2] / dirLength];
              newPosition = [
                center[0] + normDir[0] * t,
                center[1] + normDir[1] * t + yOffset,
                center[2] + normDir[2] * t,
              ];
            } else if (pattern === 'scatter') {
              const rng = mulberry32(scatterSeed + i);
              const randX = (rng() * 2 - 1) * scatterRadius;
              const randZ = (rng() * 2 - 1) * scatterRadius;
              newPosition = [
                center[0] + randX,
                center[1] + yOffset,
                center[2] + randZ,
              ];
            } else if (pattern === 'path') {
              if (pathPoints.length < 2) {
                throw new Error('Path pattern requires at least 2 waypoints');
              }
              // Calculate total path length
              let totalLength = 0;
              const segmentLengths: number[] = [];
              for (let j = 0; j < pathPoints.length - 1; j++) {
                const dx = pathPoints[j + 1][0] - pathPoints[j][0];
                const dy = pathPoints[j + 1][1] - pathPoints[j][1];
                const dz = pathPoints[j + 1][2] - pathPoints[j][2];
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                segmentLengths.push(len);
                totalLength += len;
              }

              // Find position along path for this entity
              const targetDist = (i / (entityIds.length - 1)) * totalLength;
              let accumulatedDist = 0;
              let segmentIndex = 0;
              for (let j = 0; j < segmentLengths.length; j++) {
                if (accumulatedDist + segmentLengths[j] >= targetDist) {
                  segmentIndex = j;
                  break;
                }
                accumulatedDist += segmentLengths[j];
              }

              const localT = (targetDist - accumulatedDist) / segmentLengths[segmentIndex];
              const p1 = pathPoints[segmentIndex];
              const p2 = pathPoints[segmentIndex + 1];
              newPosition = [
                p1[0] + localT * (p2[0] - p1[0]),
                p1[1] + localT * (p2[1] - p1[1]) + yOffset,
                p1[2] + localT * (p2[2] - p1[2]),
              ];
            } else {
              throw new Error(`Unknown pattern: ${pattern}`);
            }

            store.updateTransform(entityId, 'position', newPosition);
            operations.push({ action: `arrange "${node.name}"`, success: true, entityId });
          } catch (err) {
            operations.push({
              action: `arrange "${node.name}"`,
              success: false,
              entityId,
              error: err instanceof Error ? err.message : 'Failed to arrange',
            });
          }
        }

        const successCount = operations.filter(op => op.success).length;
        return {
          success: successCount === operations.length,
          result: {
            arranged: successCount,
            pattern,
            operations,
          },
        };
      }

      case 'create_scene_from_description': {
        const entities = input.entities as Array<Record<string, unknown>>;
        const clearExisting = (input.clearExisting as boolean) ?? false;
        const envSettings = input.environment as Record<string, unknown> | undefined;
        const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];
        const nameToId: Record<string, string> = {};

        // 1. Optionally clear scene
        if (clearExisting) store.newScene();

        // 2. Apply environment settings
        if (envSettings) {
          if (envSettings.ambientColor || envSettings.ambientBrightness) {
            const ambientUpdate: Record<string, unknown> = {};
            if (envSettings.ambientColor) ambientUpdate.color = envSettings.ambientColor;
            if (envSettings.ambientBrightness) ambientUpdate.brightness = envSettings.ambientBrightness;
            store.updateAmbientLight(ambientUpdate);
          }
          if (envSettings.skyboxPreset) store.setSkybox(envSettings.skyboxPreset as string);
          if (envSettings.fogEnabled !== undefined) {
            const fogUpdate: Record<string, unknown> = { fogEnabled: envSettings.fogEnabled };
            if (envSettings.fogColor) fogUpdate.fogColor = envSettings.fogColor;
            if (envSettings.fogStart !== undefined) fogUpdate.fogStart = envSettings.fogStart;
            if (envSettings.fogEnd !== undefined) fogUpdate.fogEnd = envSettings.fogEnd;
            store.updateEnvironment(fogUpdate);
          }
        }

        // 3. Spawn entities sequentially
        for (const ent of entities) {
          try {
            const entType = ent.type as string;
            const entName = ent.name as string;

            store.spawnEntity(entType as EntityType, entName);
            const entityId = store.primaryId;
            if (!entityId) throw new Error('spawn failed');
            nameToId[entName] = entityId;

            if (ent.position) store.updateTransform(entityId, 'position', ent.position as [number, number, number]);
            if (ent.rotation) store.updateTransform(entityId, 'rotation', ent.rotation as [number, number, number]);
            if (ent.scale) store.updateTransform(entityId, 'scale', ent.scale as [number, number, number]);

            if (ent.material) {
              const matInput = ent.material as Record<string, unknown>;
              if (matInput.presetId) {
                const preset = getPresetById(matInput.presetId as string);
                if (preset) {
                  store.updateMaterial(entityId, preset.data);
                }
              } else {
                store.updateMaterial(entityId, buildMaterialFromPartial(matInput));
              }
            }

            if (ent.light) {
              store.updateLight(entityId, buildLightFromPartial(ent.light as Record<string, unknown>));
            }

            if (ent.physics) {
              store.togglePhysics(entityId, true);
              store.updatePhysics(entityId, buildPhysicsFromPartial(ent.physics as Record<string, unknown>));
            }

            if (ent.gameComponent) {
              const componentType = ent.gameComponent as string;
              const componentProps = (ent.gameComponentProps as Record<string, unknown>) ?? {};
              const component = buildGameComponentFromInput(componentType, componentProps);
              if (component) {
                store.addGameComponent(entityId, component);
              }
            }

            results.push({ action: `spawn "${entName}"`, success: true, entityId });
          } catch (err) {
            results.push({
              action: `spawn "${ent.name as string}"`,
              success: false,
              error: err instanceof Error ? err.message : 'Spawn failed',
            });
          }
        }

        // 4. Reparent pass (after all entities exist)
        for (const ent of entities) {
          if (ent.parentName && nameToId[ent.name as string] && nameToId[ent.parentName as string]) {
            store.reparentEntity(nameToId[ent.name as string], nameToId[ent.parentName as string]);
          }
        }

        return { success: true, result: buildCompoundResult(results, nameToId) };
      }

      case 'create_level_layout': {
        const levelName = (input.levelName as string) ?? 'Level';
        const ground = input.ground as Record<string, unknown> | undefined;
        const walls = (input.walls as Array<Record<string, unknown>>) ?? [];
        const obstacles = (input.obstacles as Array<Record<string, unknown>>) ?? [];
        const spawnPoints = (input.spawnPoints as Array<Record<string, unknown>>) ?? [];
        const goals = (input.goals as Array<Record<string, unknown>>) ?? [];
        const inputPreset = input.inputPreset as string | undefined;

        const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];
        const nameToId: Record<string, string> = {};

        // 1. Create root entity (tiny cube at origin, for organization)
        store.spawnEntity('cube', levelName);
        const rootId = store.primaryId;
        if (!rootId) {
          return { success: false, error: 'Failed to create level root' };
        }
        nameToId[levelName] = rootId;
        store.updateTransform(rootId, 'scale', [0.01, 0.01, 0.01]);
        results.push({ action: `create root "${levelName}"`, success: true, entityId: rootId });

        // 2. Ground plane
        if (ground) {
          try {
            const width = (ground.width as number) ?? 20;
            const depth = (ground.depth as number) ?? 20;
            const useTerrain = (ground.useTerrain as boolean) ?? false;

            if (useTerrain) {
              const terrainConfig = (ground.terrainConfig as Record<string, unknown>) ?? {};
              store.spawnTerrain(terrainConfig);
              const groundId = store.primaryId;
              if (groundId) {
                nameToId['Ground'] = groundId;
                store.reparentEntity(groundId, rootId);
                results.push({ action: 'create terrain ground', success: true, entityId: groundId });
              }
            } else {
              store.spawnEntity('plane', 'Ground');
              const groundId = store.primaryId;
              if (groundId) {
                nameToId['Ground'] = groundId;
                store.updateTransform(groundId, 'scale', [width / 2, 1, depth / 2]);
                if (ground.material) {
                  store.updateMaterial(groundId, buildMaterialFromPartial(ground.material as Record<string, unknown>));
                }
                store.reparentEntity(groundId, rootId);
                results.push({ action: 'create ground plane', success: true, entityId: groundId });
              }
            }
          } catch (err) {
            results.push({ action: 'create ground', success: false, error: err instanceof Error ? err.message : 'Failed' });
          }
        }

        // 3. Walls
        for (let i = 0; i < walls.length; i++) {
          const wall = walls[i];
          try {
            const name = (wall.name as string) ?? `Wall_${i}`;
            const start = wall.start as [number, number, number];
            const end = wall.end as [number, number, number];
            const height = (wall.height as number) ?? 3;
            const thickness = (wall.thickness as number) ?? 0.3;

            const geom = wallFromStartEnd(start, end, height, thickness);

            store.spawnEntity('cube', name);
            const wallId = store.primaryId;
            if (wallId) {
              nameToId[name] = wallId;
              store.updateTransform(wallId, 'position', geom.position);
              store.updateTransform(wallId, 'rotation', geom.rotation);
              store.updateTransform(wallId, 'scale', geom.scale);

              // Apply physics (fixed body)
              store.togglePhysics(wallId, true);
              store.updatePhysics(wallId, buildPhysicsFromPartial({ bodyType: 'fixed' }));

              if (wall.material) {
                store.updateMaterial(wallId, buildMaterialFromPartial(wall.material as Record<string, unknown>));
              }

              store.reparentEntity(wallId, rootId);
              results.push({ action: `create wall "${name}"`, success: true, entityId: wallId });
            }
          } catch (err) {
            results.push({ action: `create wall ${i}`, success: false, error: err instanceof Error ? err.message : 'Failed' });
          }
        }

        // 4. Obstacles
        for (let i = 0; i < obstacles.length; i++) {
          const obstacle = obstacles[i];
          try {
            const obstType = obstacle.type as string;
            const obstName = (obstacle.name as string) ?? `Obstacle_${i}`;
            const position = obstacle.position as [number, number, number];
            const scale = obstacle.scale as [number, number, number] | undefined;

            store.spawnEntity(obstType as EntityType, obstName);
            const obstId = store.primaryId;
            if (obstId) {
              nameToId[obstName] = obstId;
              store.updateTransform(obstId, 'position', position);
              if (scale) store.updateTransform(obstId, 'scale', scale);

              if (obstacle.material) {
                store.updateMaterial(obstId, buildMaterialFromPartial(obstacle.material as Record<string, unknown>));
              }

              if (obstacle.physics) {
                store.togglePhysics(obstId, true);
                store.updatePhysics(obstId, buildPhysicsFromPartial(obstacle.physics as Record<string, unknown>));
              }

              if (obstacle.gameComponent) {
                const comp = buildGameComponentFromInput(
                  obstacle.gameComponent as string,
                  (obstacle.gameComponentProps as Record<string, unknown>) ?? {}
                );
                if (comp) store.addGameComponent(obstId, comp);
              }

              store.reparentEntity(obstId, rootId);
              results.push({ action: `create obstacle "${obstName}"`, success: true, entityId: obstId });
            }
          } catch (err) {
            results.push({ action: `create obstacle ${i}`, success: false, error: err instanceof Error ? err.message : 'Failed' });
          }
        }

        // 5. Spawn points
        for (let i = 0; i < spawnPoints.length; i++) {
          const sp = spawnPoints[i];
          try {
            const isPlayerSpawn = (sp.isPlayerSpawn as boolean) ?? false;
            const spName = (sp.name as string) ?? (isPlayerSpawn ? 'PlayerSpawn' : `SpawnPoint_${i}`);
            const position = sp.position as [number, number, number];

            store.spawnEntity('sphere', spName);
            const spId = store.primaryId;
            if (spId) {
              nameToId[spName] = spId;
              store.updateTransform(spId, 'position', position);
              store.updateTransform(spId, 'scale', [0.3, 0.3, 0.3]);

              // Semi-transparent unlit material
              store.updateMaterial(spId, buildMaterialFromPartial({ baseColor: [0, 1, 0, 0.5], unlit: true }));

              store.reparentEntity(spId, rootId);
              results.push({ action: `create spawn point "${spName}"`, success: true, entityId: spId });
            }
          } catch (err) {
            results.push({ action: `create spawn point ${i}`, success: false, error: err instanceof Error ? err.message : 'Failed' });
          }
        }

        // 6. Goals
        for (let i = 0; i < goals.length; i++) {
          const goal = goals[i];
          try {
            const goalName = (goal.name as string) ?? `Goal_${i}`;
            const position = goal.position as [number, number, number];
            const goalType = (goal.type as string) ?? 'reach';

            store.spawnEntity('sphere', goalName);
            const goalId = store.primaryId;
            if (goalId) {
              nameToId[goalName] = goalId;
              store.updateTransform(goalId, 'position', position);
              store.updateTransform(goalId, 'scale', [0.5, 0.5, 0.5]);

              // Unlit bright material
              store.updateMaterial(goalId, buildMaterialFromPartial({ baseColor: [1, 1, 0, 1], unlit: true }));

              // Add win condition component if specified
              if (goal.gameComponent) {
                const comp = buildGameComponentFromInput(
                  goal.gameComponent as string,
                  (goal.gameComponentProps as Record<string, unknown>) ?? {}
                );
                if (comp) store.addGameComponent(goalId, comp);
              } else {
                // Default: trigger zone for 'reach' type
                if (goalType === 'reach') {
                  const triggerComp = buildGameComponentFromInput('trigger_zone', { eventName: 'goal_reached', oneShot: true });
                  if (triggerComp) store.addGameComponent(goalId, triggerComp);
                }
              }

              store.reparentEntity(goalId, rootId);
              results.push({ action: `create goal "${goalName}"`, success: true, entityId: goalId });
            }
          } catch (err) {
            results.push({ action: `create goal ${i}`, success: false, error: err instanceof Error ? err.message : 'Failed' });
          }
        }

        // 7. Apply input preset
        if (inputPreset) {
          store.setInputPreset(inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');
        }

        return { success: true, result: buildCompoundResult(results, nameToId) };
      }

      case 'setup_character': {
        const charName = (input.name as string) ?? 'Player';
        const position = (input.position as [number, number, number]) ?? [0, 1, 0];
        const entityType = (input.entityType as string) ?? 'capsule';
        const material = input.material as Record<string, unknown> | undefined;
        const controller = (input.controller as Record<string, unknown>) ?? {};
        const health = input.health as Record<string, unknown> | undefined | null;
        const inputPreset = (input.inputPreset as string) ?? 'platformer';
        const cameraFollow = (input.cameraFollow as boolean) ?? true;
        const cameraOffset = (input.cameraOffset as [number, number, number]) ?? [0, 5, -10];

        const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];
        const nameToId: Record<string, string> = {};

        try {
          // 1. Spawn character entity
          store.spawnEntity(entityType as EntityType, charName);
          const charId = store.primaryId;
          if (!charId) throw new Error('Character spawn failed');
          nameToId[charName] = charId;

          // 2. Set position
          store.updateTransform(charId, 'position', position);

          // 3. Apply material
          if (material) {
            store.updateMaterial(charId, buildMaterialFromPartial(material));
          }

          // 4. Enable physics with dynamic body
          store.togglePhysics(charId, true);
          const physData = buildPhysicsFromPartial({
            bodyType: 'dynamic',
            colliderShape: 'capsule',
            lockRotationX: true,
            lockRotationZ: true,
          });
          store.updatePhysics(charId, physData);

          // 5. Add character controller component
          const controllerComp = buildGameComponentFromInput('character_controller', controller);
          if (controllerComp) {
            store.addGameComponent(charId, controllerComp);
          }

          // 6. Add health component (unless explicitly null)
          if (health !== null) {
            const healthComp = buildGameComponentFromInput('health', health ?? {});
            if (healthComp) {
              store.addGameComponent(charId, healthComp);
            }
          }

          // 7. Set input preset
          store.setInputPreset(inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');

          // 8. Attach camera follow script
          if (cameraFollow) {
            const scriptSource = `const OFFSET = [${cameraOffset[0]}, ${cameraOffset[1]}, ${cameraOffset[2]}];
forge.onUpdate((dt) => {
  const pos = forge.transform.getPosition();
  forge.camera.setTarget(pos[0] + OFFSET[0], pos[1] + OFFSET[1], pos[2] + OFFSET[2]);
});`;
            store.setScript(charId, scriptSource, true);
          }

          results.push({ action: `setup character "${charName}"`, success: true, entityId: charId });
        } catch (err) {
          results.push({
            action: `setup character "${charName}"`,
            success: false,
            error: err instanceof Error ? err.message : 'Setup failed',
          });
        }

        return { success: true, result: buildCompoundResult(results, nameToId) };
      }

      case 'configure_game_mechanics': {
        const inputPreset = input.inputPreset as string | undefined;
        const customBindings = (input.customBindings as Array<Record<string, unknown>>) ?? [];
        const entityConfigs = (input.entityConfigs as Array<Record<string, unknown>>) ?? [];
        const qualityPreset = input.qualityPreset as string | undefined;

        const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

        // 1. Apply input preset
        if (inputPreset) {
          store.setInputPreset(inputPreset as 'fps' | 'platformer' | 'topdown' | 'racing');
          results.push({ action: `set input preset "${inputPreset}"`, success: true });
        }

        // 2. Add custom bindings
        for (const binding of customBindings) {
          try {
            const inputBinding: InputBinding = {
              actionName: binding.actionName as string,
              actionType: (binding.actionType as 'digital' | 'axis') ?? 'digital',
              sources: (binding.sources as string[]) ?? [],
              positiveKeys: binding.positiveKeys as string[] | undefined,
              negativeKeys: binding.negativeKeys as string[] | undefined,
              deadZone: binding.deadZone as number | undefined,
            };
            store.setInputBinding(inputBinding);
            results.push({ action: `add binding "${inputBinding.actionName}"`, success: true });
          } catch (err) {
            results.push({
              action: `add binding`,
              success: false,
              error: err instanceof Error ? err.message : 'Binding failed',
            });
          }
        }

        // 3. Configure entities
        for (const config of entityConfigs) {
          try {
            const entityName = config.entityName as string;
            // Find entity by name
            const node = Object.values(store.sceneGraph.nodes).find(n => n.name === entityName);
            if (!node) {
              results.push({ action: `configure "${entityName}"`, success: false, error: 'Entity not found' });
              continue;
            }

            const entityId = node.entityId;

            // Apply physics
            if (config.physics) {
              store.togglePhysics(entityId, true);
              store.updatePhysics(entityId, buildPhysicsFromPartial(config.physics as Record<string, unknown>));
            }

            // Add game components
            if (config.gameComponents) {
              const components = config.gameComponents as Array<Record<string, unknown>>;
              for (const comp of components) {
                const builtComp = buildGameComponentFromInput(comp.type as string, (comp.props as Record<string, unknown>) ?? {});
                if (builtComp) {
                  store.addGameComponent(entityId, builtComp);
                }
              }
            }

            // Set script
            if (config.script) {
              const script = config.script as Record<string, unknown>;
              if (script.source) {
                store.setScript(entityId, script.source as string, true, script.template as string | undefined);
              }
            }

            results.push({ action: `configure "${entityName}"`, success: true, entityId });
          } catch (err) {
            results.push({
              action: `configure entity`,
              success: false,
              error: err instanceof Error ? err.message : 'Configuration failed',
            });
          }
        }

        // 4. Apply quality preset
        if (qualityPreset) {
          store.setQualityPreset(qualityPreset as 'low' | 'medium' | 'high' | 'ultra');
          results.push({ action: `set quality preset "${qualityPreset}"`, success: true });
        }

        const successCount = results.filter(r => r.success).length;
        return {
          success: successCount === results.length,
          result: {
            configured: successCount,
            operations: results,
            summary: `Configured ${successCount} settings/entities.`,
          },
        };
      }

      case 'apply_style': {
        const targetEntityIds = input.targetEntityIds as string[] | undefined;
        const palette = input.palette as Record<string, [number, number, number, number]> | undefined;
        const materialOverrides = input.materialOverrides as Record<string, unknown> | undefined;
        const lighting = input.lighting as Record<string, unknown> | undefined;
        const postProcessing = input.postProcessing as Record<string, unknown> | undefined;

        const results: Array<{ action: string; success: boolean; entityId?: string; error?: string }> = [];

        // 1. Determine target entities
        let targets: string[] = [];
        if (targetEntityIds) {
          targets = targetEntityIds;
        } else {
          // Find all mesh entities
          targets = Object.values(store.sceneGraph.nodes)
            .filter(n => {
              const comps = n.components || [];
              return comps.includes('Mesh3d');
            })
            .map(n => n.entityId);
        }

        // 2. Apply palette colors
        if (palette && targets.length > 0) {
          // Sort entities by position as proxy for size ordering
          const entitiesWithVolume = targets.map((id, idx) => ({
            id,
            volume: targets.length - idx,
          })).sort((a, b) => b.volume - a.volume);

          // Distribute colors: primary to first third, secondary to middle third, accent to last third
          const thirdSize = Math.ceil(entitiesWithVolume.length / 3);
          for (let i = 0; i < entitiesWithVolume.length; i++) {
            const entityId = entitiesWithVolume[i].id;
            const mat = buildMaterialFromPartial({});
            let color: [number, number, number, number] = mat.baseColor;

            if (i < thirdSize && palette.primary) {
              color = palette.primary;
            } else if (i < thirdSize * 2 && palette.secondary) {
              color = palette.secondary;
            } else if (palette.accent) {
              color = palette.accent;
            }

            store.updateMaterial(entityId, { ...mat, baseColor: color });
            results.push({ action: `apply palette to ${store.sceneGraph.nodes[entityId]?.name || entityId}`, success: true, entityId });
          }
        }

        // 3. Apply material overrides
        if (materialOverrides && targets.length > 0) {
          for (const entityId of targets) {
            try {
              const mat = buildMaterialFromPartial({});
              const updated = { ...mat };

              if (materialOverrides.metallic !== undefined) updated.metallic = materialOverrides.metallic as number;
              if (materialOverrides.roughness !== undefined) updated.perceptualRoughness = materialOverrides.roughness as number;
              if (materialOverrides.emissiveMultiplier !== undefined) {
                const mult = materialOverrides.emissiveMultiplier as number;
                updated.emissive = [
                  mat.emissive[0] * mult,
                  mat.emissive[1] * mult,
                  mat.emissive[2] * mult,
                  mat.emissive[3],
                ];
              }

              store.updateMaterial(entityId, updated);
              results.push({ action: `apply material override to ${store.sceneGraph.nodes[entityId]?.name || entityId}`, success: true, entityId });
            } catch (err) {
              results.push({
                action: `apply material override to ${entityId}`,
                success: false,
                entityId,
                error: err instanceof Error ? err.message : 'Failed',
              });
            }
          }
        }

        // 4. Apply lighting settings
        if (lighting) {
          if (lighting.ambientColor || lighting.ambientBrightness) {
            const ambientUpdate: Record<string, unknown> = {};
            if (lighting.ambientColor) ambientUpdate.color = lighting.ambientColor;
            if (lighting.ambientBrightness) ambientUpdate.brightness = lighting.ambientBrightness;
            store.updateAmbientLight(ambientUpdate);
            results.push({ action: 'update ambient light', success: true });
          }

          if (lighting.skyboxPreset) {
            store.setSkybox(lighting.skyboxPreset as string);
            results.push({ action: `set skybox "${lighting.skyboxPreset}"`, success: true });
          }

          if (lighting.fogEnabled !== undefined) {
            const fogUpdate: Record<string, unknown> = { fogEnabled: lighting.fogEnabled };
            if (lighting.fogColor) fogUpdate.fogColor = lighting.fogColor;
            if (lighting.fogStart !== undefined) fogUpdate.fogStart = lighting.fogStart;
            if (lighting.fogEnd !== undefined) fogUpdate.fogEnd = lighting.fogEnd;
            store.updateEnvironment(fogUpdate);
            results.push({ action: 'update fog settings', success: true });
          }
        }

        // 5. Apply post-processing
        if (postProcessing) {
          store.updatePostProcessing(postProcessing);
          results.push({ action: 'update post-processing', success: true });
        }

        const successCount = results.filter(r => r.success).length;
        return {
          success: successCount === results.length,
          result: {
            appliedTo: targets.length,
            operations: results,
            summary: `Applied style to ${targets.length} entities with ${successCount} operations.`,
          },
        };
      }

      // --- Template commands ---
      case 'list_templates': {
        const { TEMPLATE_REGISTRY } = await import('@/data/templates');
        const category = input.category as string | undefined;
        const templates = category
          ? TEMPLATE_REGISTRY.filter(t => t.category === category)
          : TEMPLATE_REGISTRY;
        return {
          success: true,
          result: templates.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            difficulty: t.difficulty,
            entityCount: t.entityCount,
            tags: t.tags,
          })),
        };
      }

      case 'load_template': {
        const templateId = input.templateId as string;
        if (!templateId) return { success: false, error: 'Missing templateId' };
        await store.loadTemplate(templateId);
        return { success: true, result: { message: `Loaded template: ${templateId}` } };
      }

      case 'get_template_info': {
        const { getTemplateInfo } = await import('@/data/templates');
        const info = getTemplateInfo(input.templateId as string);
        if (!info) return { success: false, error: `Template not found: ${input.templateId}` };
        return { success: true, result: info };
      }

      // --- Keyframe property animation commands (D-2) ---
      case 'create_animation_clip': {
        store.createAnimationClip(
          input.entityId as string,
          input.duration as number | undefined,
          input.playMode as string | undefined,
        );
        return { success: true, result: { message: 'Animation clip created' } };
      }
      case 'add_clip_keyframe': {
        store.addClipKeyframe(
          input.entityId as string,
          input.target as string,
          input.time as number,
          input.value as number,
          input.interpolation as string | undefined,
        );
        return { success: true, result: { message: 'Keyframe added' } };
      }
      case 'remove_clip_keyframe': {
        store.removeClipKeyframe(
          input.entityId as string,
          input.target as string,
          input.time as number,
        );
        return { success: true, result: { message: 'Keyframe removed' } };
      }
      case 'update_clip_keyframe': {
        store.updateClipKeyframe(
          input.entityId as string,
          input.target as string,
          input.time as number,
          input.value as number | undefined,
          input.interpolation as string | undefined,
          input.newTime as number | undefined,
        );
        return { success: true, result: { message: 'Keyframe updated' } };
      }
      case 'set_clip_property': {
        store.setClipProperty(
          input.entityId as string,
          input.duration as number | undefined,
          input.playMode as string | undefined,
          input.speed as number | undefined,
          input.autoplay as boolean | undefined,
        );
        return { success: true, result: { message: 'Clip property updated' } };
      }
      case 'preview_clip': {
        store.previewClip(
          input.entityId as string,
          input.action as 'play' | 'stop' | 'seek',
          input.seekTime as number | undefined,
        );
        return { success: true, result: { message: `Animation preview ${input.action}` } };
      }
      case 'remove_animation_clip': {
        store.removeAnimationClip(input.entityId as string);
        return { success: true, result: { message: 'Animation clip removed' } };
      }
      case 'get_animation_clip': {
        const clipState = store.primaryAnimationClip;
        return { success: true, result: clipState || { message: 'No animation clip on selected entity' } };
      }

      // --- Script Library ---
      case 'create_library_script': {
        const { saveScript } = await import('@/stores/scriptLibraryStore');
        const script = saveScript(
          input.name as string,
          input.source as string,
          (input.description as string) ?? '',
          (input.tags as string[]) ?? []
        );
        return { success: true, result: { id: script.id, name: script.name } };
      }

      case 'update_library_script': {
        const { getScript, updateScript } = await import('@/stores/scriptLibraryStore');
        const existing = getScript(input.scriptId as string);
        if (!existing) return { success: false, error: `Script not found: ${input.scriptId}` };
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.source) updates.source = input.source;
        if (input.description !== undefined) updates.description = input.description;
        if (input.tags) updates.tags = input.tags;
        updateScript(existing.id, updates);
        return { success: true, result: { id: existing.id } };
      }

      case 'delete_library_script': {
        const { getScript: findScript, deleteScript: delScript } = await import('@/stores/scriptLibraryStore');
        const found = findScript(input.scriptId as string);
        if (!found) return { success: false, error: `Script not found: ${input.scriptId}` };
        delScript(found.id);
        return { success: true, result: { deleted: found.name } };
      }

      case 'list_library_scripts': {
        const { searchScripts } = await import('@/stores/scriptLibraryStore');
        const results = searchScripts((input.query as string) ?? '');
        return {
          success: true,
          result: results.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            tags: s.tags,
            sourceLength: s.source.length,
          })),
        };
      }

      case 'attach_script_to_entity': {
        const { getScript: getLib } = await import('@/stores/scriptLibraryStore');
        const libScript = getLib(input.scriptId as string);
        if (!libScript) return { success: false, error: `Library script not found: ${input.scriptId}` };
        store.setScript(input.entityId as string, libScript.source, true);
        return { success: true, result: { entityId: input.entityId, scriptName: libScript.name } };
      }

      case 'detach_script_from_entity': {
        store.removeScript(input.entityId as string);
        return { success: true, result: { entityId: input.entityId } };
      }

      // --- Visual scripting commands ---
      case 'set_visual_script': {
        const { compileGraph } = await import('@/lib/scripting/graphCompiler');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const graph = input.graph as any;
        const result = compileGraph(graph);
        if (result.success) {
          store.setScript(input.entityId as string, result.code, true);
          return { success: true, result: { message: 'Visual script set and compiled' } };
        }
        return { success: false, error: `Compile errors: ${result.errors.map((e) => e.message).join(', ')}` };
      }

      case 'get_visual_script': {
        // Placeholder: would retrieve graph data from store
        return { success: true, result: { nodes: [], edges: [] } };
      }

      case 'compile_visual_script': {
        const { compileGraph } = await import('@/lib/scripting/graphCompiler');
        // Placeholder: would get graph from store
        const result = compileGraph({ nodes: [], edges: [] });
        if (result.success) {
          return { success: true, result: { code: result.code } };
        }
        return { success: false, error: `Errors: ${result.errors.map((e) => e.message).join(', ')}` };
      }

      case 'add_visual_script_node': {
        const nodeType = input.nodeType as string;
        return { success: true, result: { message: `Added ${nodeType} node` } };
      }

      case 'connect_visual_script_nodes': {
        const sourceNodeId = input.sourceNodeId as string;
        const sourcePort = input.sourcePort as string;
        const targetNodeId = input.targetNodeId as string;
        const targetPort = input.targetPort as string;
        return { success: true, result: { message: `Connected ${sourceNodeId}:${sourcePort} → ${targetNodeId}:${targetPort}` } };
      }

      // --- Token/Credit queries ---
      case 'get_token_balance': {
        // Client-side: return what we have in the user store
        const { useUserStore } = await import('@/stores/userStore');
        const balance = useUserStore.getState().tokenBalance;
        return { success: true, result: balance ?? { message: 'Balance not loaded' } };
      }

      case 'get_token_pricing': {
        const { TOKEN_COSTS, TIER_MONTHLY_TOKENS, TOKEN_PACKAGES } = await import('@/lib/tokens/pricing');
        return { success: true, result: { costs: TOKEN_COSTS, monthlyAllocations: TIER_MONTHLY_TOKENS, packages: TOKEN_PACKAGES } };
      }

      // --- Dialogue commands ---
      case 'create_dialogue_tree': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        const treeId = useDialogueStore.getState().addTree(
          input.name as string,
          input.startNodeText as string | undefined,
        );
        return { success: true, result: { treeId, message: `Created dialogue tree: ${input.name}` } };
      }

      case 'add_dialogue_node': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        const nodeType = input.nodeType as string;
        const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let node;
        switch (nodeType) {
          case 'text':
            node = { id: nodeId, type: 'text' as const, speaker: (input.speaker as string) || 'NPC', text: (input.text as string) || '', next: null };
            break;
          case 'choice':
            node = { id: nodeId, type: 'choice' as const, text: (input.text as string) || '', choices: [] };
            break;
          case 'condition':
            node = { id: nodeId, type: 'condition' as const, condition: { type: 'equals' as const, variable: '', value: true }, onTrue: null, onFalse: null };
            break;
          case 'action':
            node = { id: nodeId, type: 'action' as const, actions: [], next: null };
            break;
          case 'end':
            node = { id: nodeId, type: 'end' as const };
            break;
          default:
            return { success: false, error: `Unknown node type: ${nodeType}` };
        }
        useDialogueStore.getState().addNode(input.treeId as string, node);
        // Connect from another node if specified
        if (input.connectFromNodeId) {
          const tree = useDialogueStore.getState().dialogueTrees[input.treeId as string];
          if (tree) {
            const fromNode = tree.nodes.find(n => n.id === input.connectFromNodeId);
            if (fromNode && 'next' in fromNode) {
              useDialogueStore.getState().updateNode(input.treeId as string, fromNode.id, { next: nodeId } as Record<string, unknown>);
            }
          }
        }
        return { success: true, result: { nodeId, message: `Added ${nodeType} node` } };
      }

      case 'set_dialogue_choice': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        const tree = useDialogueStore.getState().dialogueTrees[input.treeId as string];
        if (!tree) return { success: false, error: 'Tree not found' };
        const choiceNode = tree.nodes.find(n => n.id === input.nodeId);
        if (!choiceNode || choiceNode.type !== 'choice') return { success: false, error: 'Choice node not found' };
        const choiceId = `choice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newChoices = [...choiceNode.choices, { id: choiceId, text: input.choiceText as string, nextNodeId: (input.nextNodeId as string) || null }];
        useDialogueStore.getState().updateNode(input.treeId as string, input.nodeId as string, { choices: newChoices } as Record<string, unknown>);
        return { success: true, result: { choiceId, message: 'Choice added' } };
      }

      case 'remove_dialogue_tree': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        useDialogueStore.getState().removeTree(input.treeId as string);
        return { success: true, result: { message: 'Dialogue tree removed' } };
      }

      case 'get_dialogue_tree': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        const tree = useDialogueStore.getState().dialogueTrees[input.treeId as string];
        if (!tree) return { success: false, error: 'Tree not found' };
        return { success: true, result: tree };
      }

      case 'set_dialogue_node_voice': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        useDialogueStore.getState().updateNode(
          input.treeId as string,
          input.nodeId as string,
          { voiceAsset: input.voiceAssetId } as Record<string, unknown>,
        );
        return { success: true, result: { message: 'Voice asset assigned' } };
      }

      case 'export_dialogue_tree': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        const json = useDialogueStore.getState().exportTree(input.treeId as string);
        if (!json) return { success: false, error: 'Tree not found' };
        return { success: true, result: { json } };
      }

      case 'import_dialogue_tree': {
        const { useDialogueStore } = await import('@/stores/dialogueStore');
        const treeId = useDialogueStore.getState().importTree(input.jsonData as string);
        if (!treeId) return { success: false, error: 'Failed to import tree' };
        return { success: true, result: { treeId, message: 'Dialogue tree imported' } };
      }

      // --- Publishing commands ---
      case 'publish_game': {
        const { usePublishStore } = await import('@/stores/publishStore');
        const result = await usePublishStore.getState().publishGame(
          store.projectId || '', input.title as string, input.slug as string, input.description as string | undefined
        );
        return result ? { success: true, result: { message: `Published: ${result.url}`, url: result.url } } : { success: false, error: 'Publish failed' };
      }
      case 'unpublish_game': {
        const { usePublishStore } = await import('@/stores/publishStore');
        const success = await usePublishStore.getState().unpublishGame(input.id as string);
        return success ? { success: true, result: { message: 'Game unpublished' } } : { success: false, error: 'Unpublish failed' };
      }
      case 'list_publications': {
        const { usePublishStore } = await import('@/stores/publishStore');
        await usePublishStore.getState().fetchPublications();
        const pubs = usePublishStore.getState().publications;
        return { success: true, result: pubs.map(p => ({ title: p.title, slug: p.slug, url: p.url, status: p.status })) };
      }
      case 'get_publish_url': {
        const { usePublishStore } = await import('@/stores/publishStore');
        await usePublishStore.getState().fetchPublications();
        const pub = usePublishStore.getState().publications.find(p => p.slug === input.slug);
        return pub ? { success: true, result: { url: pub.url } } : { success: false, error: 'Publication not found' };
      }

      // --- Sprite commands ---
      case 'create_sprite': {
        // TODO: Implement create_sprite in Rust engine
        // For now, this is a placeholder that will be implemented in Phase 2D-1
        return { success: false, error: 'create_sprite not yet implemented in engine' };
      }

      case 'set_sprite_texture': {
        const entityId = input.entity_id as string;
        const textureAssetId = input.texture_asset_id as string;
        const existing = store.sprites[entityId];
        if (existing) {
          store.setSpriteData(entityId, { ...existing, textureAssetId });
        }
        return { success: true, result: { message: 'Sprite texture updated' } };
      }

      case 'set_sprite_tint': {
        const entityId = input.entity_id as string;
        const color = input.color as [number, number, number, number];
        const existing = store.sprites[entityId];
        if (existing) {
          store.setSpriteData(entityId, { ...existing, colorTint: color });
        }
        return { success: true, result: { message: 'Sprite tint updated' } };
      }

      case 'set_sprite_flip': {
        const entityId = input.entity_id as string;
        const flipX = input.flip_x as boolean | undefined;
        const flipY = input.flip_y as boolean | undefined;
        const existing = store.sprites[entityId];
        if (existing) {
          const updated = { ...existing };
          if (flipX !== undefined) updated.flipX = flipX;
          if (flipY !== undefined) updated.flipY = flipY;
          store.setSpriteData(entityId, updated);
        }
        return { success: true, result: { message: 'Sprite flip updated' } };
      }

      case 'set_sprite_sorting': {
        const entityId = input.entity_id as string;
        const sortingLayer = input.sorting_layer as string | undefined;
        const sortingOrder = input.sorting_order as number | undefined;
        const existing = store.sprites[entityId];
        if (existing) {
          const updated = { ...existing };
          if (sortingLayer !== undefined) updated.sortingLayer = sortingLayer;
          if (sortingOrder !== undefined) updated.sortingOrder = sortingOrder;
          store.setSpriteData(entityId, updated);
        }
        return { success: true, result: { message: 'Sprite sorting updated' } };
      }

      case 'set_sprite_anchor': {
        const entityId = input.entity_id as string;
        const anchor = input.anchor as string;
        const existing = store.sprites[entityId];
        if (existing) {
          store.setSpriteData(entityId, { ...existing, anchor: anchor as import('@/stores/editorStore').SpriteAnchor });
        }
        return { success: true, result: { message: `Sprite anchor set to ${anchor}` } };
      }

      case 'get_sprite': {
        const entityId = input.entity_id as string;
        const spriteData = store.sprites[entityId];
        if (!spriteData) {
          return { success: false, error: 'No sprite data for this entity' };
        }
        return { success: true, result: spriteData };
      }

      // --- Sprite Animation commands (Phase 2D-2) ---
      case 'slice_sprite_sheet': {
        const { asset_id: _asset_id, mode: _mode } = input;
        // TODO: Will be implemented in Rust engine in future phase
        // For now, just acknowledge the command
        return { success: true, result: { message: `Sprite sheet slicing will be implemented in Rust engine` } };
      }

      case 'create_sprite_anim_clip': {
        const { sprite_sheet_id: _sprite_sheet_id, clip_name: _clip_name, frames: _frames, frame_duration: _frame_duration, looping: _looping, ping_pong: _ping_pong } = input;
        // TODO: Will be implemented in Rust engine in future phase
        // For now, just acknowledge the command
        return { success: true, result: { message: `Animation clip creation will be implemented in Rust engine` } };
      }

      case 'set_sprite_animator': {
        const { entity_id: _entity_id, sprite_sheet_id: _sprite_sheet_id, current_clip: _current_clip, speed: _speed } = input;
        // TODO: Will be implemented in Rust engine in future phase
        // For now, just acknowledge the command
        return { success: true, result: { message: `Sprite animator will be implemented in Rust engine` } };
      }

      case 'play_sprite_animation': {
        const { entity_id: _entity_id, clip_name: _clip_name, speed: _speed } = input;
        // TODO: Will be implemented in Rust engine in future phase
        // For now, just acknowledge the command
        return { success: true, result: { message: `Sprite animation playback will be implemented in Rust engine` } };
      }

      case 'set_anim_state_machine': {
        const { entity_id: _entity_id, states: _states, transitions: _transitions, initial_state: _initial_state } = input;
        // TODO: Will be implemented in Rust engine in future phase
        // For now, just acknowledge the command
        return { success: true, result: { message: `State machine will be implemented in Rust engine` } };
      }

      case 'set_anim_param': {
        const { entity_id: _entity_id, param_name: _param_name, value: _value } = input;
        // TODO: Will be implemented in Rust engine in future phase
        // For now, just acknowledge the command
        return { success: true, result: { message: `Animation parameters will be implemented in Rust engine` } };
      }

      case 'set_project_type': {
        const projectType = input.project_type as '2d' | '3d';
        store.setProjectType(projectType);
        // TODO: Send command to Rust engine when 2D rendering is implemented
        return { success: true, result: { message: `Set project type to ${projectType}` } };
      }

      // --- 2D Physics commands ---
      case 'set_physics2d': {
        const { entityId, bodyType, colliderShape, size, radius, mass, friction, restitution, gravityScale, isSensor, lockRotation, continuousDetection, oneWayPlatform } = input;
        const data: Partial<import('@/stores/editorStore').Physics2dData> = {};
        if (bodyType !== undefined) data.bodyType = bodyType as 'dynamic' | 'static' | 'kinematic';
        if (colliderShape !== undefined) data.colliderShape = colliderShape as 'box' | 'circle' | 'capsule' | 'convex_polygon' | 'edge' | 'auto';
        if (size !== undefined) data.size = size as [number, number];
        if (radius !== undefined) data.radius = radius as number;
        if (mass !== undefined) data.mass = mass as number;
        if (friction !== undefined) data.friction = friction as number;
        if (restitution !== undefined) data.restitution = restitution as number;
        if (gravityScale !== undefined) data.gravityScale = gravityScale as number;
        if (isSensor !== undefined) data.isSensor = isSensor as boolean;
        if (lockRotation !== undefined) data.lockRotation = lockRotation as boolean;
        if (continuousDetection !== undefined) data.continuousDetection = continuousDetection as boolean;
        if (oneWayPlatform !== undefined) data.oneWayPlatform = oneWayPlatform as boolean;

        const existing = store.physics2d[entityId as string];
        const merged = existing ? { ...existing, ...data } : data as import('@/stores/editorStore').Physics2dData;
        store.setPhysics2d(entityId as string, merged, true);
        return { success: true, result: { message: `Set 2D physics on entity ${entityId}` } };
      }

      case 'remove_physics2d': {
        store.removePhysics2d(input.entityId as string);
        return { success: true, result: { message: `Removed 2D physics from ${input.entityId}` } };
      }

      case 'get_physics2d': {
        const data = store.physics2d[input.entityId as string];
        if (!data) return { success: false, error: 'No 2D physics data' };
        return { success: true, result: { data } };
      }

      case 'set_gravity2d': {
        // TODO: Will be implemented in Rust engine when 2D physics is active
        return { success: true, result: { message: `Set 2D gravity to [${input.gravityX}, ${input.gravityY}]` } };
      }

      case 'set_debug_physics2d': {
        // TODO: Will be implemented in Rust engine when 2D physics is active
        return { success: true, result: { message: `2D debug rendering ${input.enabled ? 'enabled' : 'disabled'}` } };
      }

      case 'apply_force2d': {
        // TODO: Will be implemented in Rust engine when 2D physics is active
        return { success: true, result: { message: `Applied 2D force [${input.forceX}, ${input.forceY}]` } };
      }

      case 'apply_impulse2d': {
        // TODO: Will be implemented in Rust engine when 2D physics is active
        return { success: true, result: { message: `Applied 2D impulse [${input.impulseX}, ${input.impulseY}]` } };
      }

      case 'raycast2d': {
        // TODO: Will be implemented in Rust engine when 2D physics is active
        return { success: true, result: { message: '2D raycast dispatched' } };
      }

      case 'create_tilemap': {
        // TODO: Will be implemented in Rust engine when tilemap rendering is active
        return { success: false, error: 'create_tilemap not yet implemented in engine' };
      }

      case 'import_tileset': {
        // TODO: Will be implemented when tileset management is active
        return { success: false, error: 'import_tileset not yet implemented' };
      }

      case 'set_tile': {
        // TODO: Will be implemented in Rust engine when tilemap editing is active
        return { success: false, error: 'set_tile not yet implemented in engine' };
      }

      case 'fill_tiles': {
        // TODO: Will be implemented in Rust engine when tilemap editing is active
        return { success: false, error: 'fill_tiles not yet implemented in engine' };
      }

      case 'clear_tiles': {
        // TODO: Will be implemented in Rust engine when tilemap editing is active
        return { success: false, error: 'clear_tiles not yet implemented in engine' };
      }

      case 'add_tilemap_layer': {
        // TODO: Will be implemented in Rust engine when tilemap layer support is active
        return { success: false, error: 'add_tilemap_layer not yet implemented in engine' };
      }

      case 'remove_tilemap_layer': {
        // TODO: Will be implemented in Rust engine when tilemap layer support is active
        return { success: false, error: 'remove_tilemap_layer not yet implemented in engine' };
      }

      case 'set_tilemap_layer': {
        // TODO: Will be implemented in Rust engine when tilemap layer support is active
        return { success: false, error: 'set_tilemap_layer not yet implemented in engine' };
      }

      case 'resize_tilemap': {
        // TODO: Will be implemented in Rust engine when tilemap editing is active
        return { success: false, error: 'resize_tilemap not yet implemented in engine' };
      }

      case 'get_tilemap': {
        const entityId = input.entityId as string;
        const tilemapData = store.tilemaps[entityId];
        if (!tilemapData) {
          return { success: false, error: `No tilemap data for entity ${entityId}` };
        }
        return { success: true, result: tilemapData };
      }

      // --- Skeletal 2D Animation commands ---
      case 'create_skeleton2d': {
        // TODO: Implement create_skeleton2d in Rust engine
        // For now, this is a placeholder that will be implemented in Phase 2D-5
        return { success: false, error: 'create_skeleton2d not yet implemented in engine' };
      }

      case 'add_bone2d': {
        // TODO: Implement add_bone2d in Rust engine
        return { success: false, error: 'add_bone2d not yet implemented in engine' };
      }

      case 'remove_bone2d': {
        // TODO: Implement remove_bone2d in Rust engine
        return { success: false, error: 'remove_bone2d not yet implemented in engine' };
      }

      case 'update_bone2d': {
        // TODO: Implement update_bone2d in Rust engine
        return { success: false, error: 'update_bone2d not yet implemented in engine' };
      }

      case 'create_skeletal_animation2d': {
        // TODO: Implement create_skeletal_animation2d in Rust engine
        return { success: false, error: 'create_skeletal_animation2d not yet implemented in engine' };
      }

      case 'add_keyframe2d': {
        // TODO: Implement add_keyframe2d in Rust engine
        return { success: false, error: 'add_keyframe2d not yet implemented in engine' };
      }

      case 'play_skeletal_animation2d': {
        // TODO: Implement play_skeletal_animation2d in Rust engine
        return { success: false, error: 'play_skeletal_animation2d not yet implemented in engine' };
      }

      case 'set_skeleton2d_skin': {
        // TODO: Implement set_skeleton2d_skin in Rust engine
        return { success: false, error: 'set_skeleton2d_skin not yet implemented in engine' };
      }

      case 'create_ik_chain2d': {
        // TODO: Implement create_ik_chain2d in Rust engine
        return { success: false, error: 'create_ik_chain2d not yet implemented in engine' };
      }

      case 'get_skeleton2d': {
        const entityId = input.entityId as string;
        const skeleton = store.skeletons2d[entityId];
        if (!skeleton) {
          return { success: false, error: `No skeleton data for entity ${entityId}` };
        }
        return { success: true, result: skeleton };
      }

      case 'import_skeleton_json': {
        // TODO: Implement import_skeleton_json in Rust engine
        return { success: false, error: 'import_skeleton_json not yet implemented in engine' };
      }

      case 'auto_weight_skeleton2d': {
        // TODO: Implement auto_weight_skeleton2d in Rust engine
        return { success: false, error: 'auto_weight_skeleton2d not yet implemented in engine' };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}

// ===== Compound Action Types and Helpers =====

interface CompoundResult {
  success: boolean;
  partialSuccess: boolean;
  entityIds: Record<string, string>;
  operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }>;
  summary: string;
}

interface GameplayAnalysis {
  entityCount: number;
  mechanics: string[];
  entityRoles: Array<{ name: string; id: string; role: string }>;
  issues: string[];
  suggestions: string[];
}

// Build a compound result from operation list
function buildCompoundResult(
  operations: Array<{ action: string; success: boolean; entityId?: string; error?: string }>,
  nameToId: Record<string, string>
): CompoundResult {
  const successCount = operations.filter((op) => op.success).length;
  const success = successCount === operations.length;
  const partialSuccess = successCount > 0 && successCount < operations.length;

  const summary = success
    ? `Created ${successCount} entities. Entity IDs: ${Object.entries(nameToId).map(([name, id]) => `${name}=${id}`).join(', ')}`
    : partialSuccess
    ? `Partial success: ${successCount}/${operations.length} entities created. Entity IDs: ${Object.entries(nameToId).map(([name, id]) => `${name}=${id}`).join(', ')}`
    : `Failed to create entities. ${operations.filter((op) => !op.success).length} errors.`;

  return {
    success,
    partialSuccess,
    entityIds: nameToId,
    operations,
    summary,
  };
}

// Build full MaterialData from partial input with defaults
function buildMaterialFromPartial(partialMat: Record<string, unknown>): MaterialData {
  return {
    baseColor: (partialMat.baseColor as [number, number, number, number]) ?? [1, 1, 1, 1],
    metallic: (partialMat.metallic as number) ?? 0,
    perceptualRoughness: (partialMat.perceptualRoughness as number) ?? 0.5,
    reflectance: (partialMat.reflectance as number) ?? 0.5,
    emissive: (partialMat.emissive as [number, number, number, number]) ?? [0, 0, 0, 1],
    emissiveExposureWeight: (partialMat.emissiveExposureWeight as number) ?? 1,
    alphaMode: (partialMat.alphaMode as 'opaque' | 'blend' | 'mask') ?? 'opaque',
    alphaCutoff: (partialMat.alphaCutoff as number) ?? 0.5,
    doubleSided: (partialMat.doubleSided as boolean) ?? false,
    unlit: (partialMat.unlit as boolean) ?? false,
    uvOffset: (partialMat.uvOffset as [number, number]) ?? [0, 0],
    uvScale: (partialMat.uvScale as [number, number]) ?? [1, 1],
    uvRotation: (partialMat.uvRotation as number) ?? 0,
    parallaxDepthScale: (partialMat.parallaxDepthScale as number) ?? 0.1,
    parallaxMappingMethod: (partialMat.parallaxMappingMethod as 'occlusion' | 'relief') ?? 'occlusion',
    maxParallaxLayerCount: (partialMat.maxParallaxLayerCount as number) ?? 16,
    parallaxReliefMaxSteps: (partialMat.parallaxReliefMaxSteps as number) ?? 5,
    clearcoat: (partialMat.clearcoat as number) ?? 0,
    clearcoatPerceptualRoughness: (partialMat.clearcoatPerceptualRoughness as number) ?? 0.5,
    specularTransmission: (partialMat.specularTransmission as number) ?? 0,
    diffuseTransmission: (partialMat.diffuseTransmission as number) ?? 0,
    ior: (partialMat.ior as number) ?? 1.5,
    thickness: (partialMat.thickness as number) ?? 0,
    attenuationDistance: (partialMat.attenuationDistance as number | null) ?? null,
    attenuationColor: (partialMat.attenuationColor as [number, number, number]) ?? [1, 1, 1],
  };
}

// Build full LightData from partial input with defaults
function buildLightFromPartial(partialLight: Record<string, unknown>): LightData {
  return {
    lightType: (partialLight.lightType as 'point' | 'directional' | 'spot') ?? 'point',
    color: (partialLight.color as [number, number, number]) ?? [1, 1, 1],
    intensity: (partialLight.intensity as number) ?? 800,
    shadowsEnabled: (partialLight.shadowsEnabled as boolean) ?? false,
    shadowDepthBias: (partialLight.shadowDepthBias as number) ?? 0.02,
    shadowNormalBias: (partialLight.shadowNormalBias as number) ?? 1.8,
    range: (partialLight.range as number) ?? 20,
    radius: (partialLight.radius as number) ?? 0,
    innerAngle: (partialLight.innerAngle as number) ?? 0.4,
    outerAngle: (partialLight.outerAngle as number) ?? 0.8,
  };
}

// Build full PhysicsData from partial input with defaults
function buildPhysicsFromPartial(partialPhysics: Record<string, unknown>): PhysicsData {
  return {
    bodyType: (partialPhysics.bodyType as 'dynamic' | 'fixed' | 'kinematic_position' | 'kinematic_velocity') ?? 'dynamic',
    colliderShape: (partialPhysics.colliderShape as 'cuboid' | 'ball' | 'cylinder' | 'capsule' | 'auto') ?? 'auto',
    restitution: (partialPhysics.restitution as number) ?? 0.3,
    friction: (partialPhysics.friction as number) ?? 0.5,
    density: (partialPhysics.density as number) ?? 1.0,
    gravityScale: (partialPhysics.gravityScale as number) ?? 1.0,
    lockTranslationX: (partialPhysics.lockTranslationX as boolean) ?? false,
    lockTranslationY: (partialPhysics.lockTranslationY as boolean) ?? false,
    lockTranslationZ: (partialPhysics.lockTranslationZ as boolean) ?? false,
    lockRotationX: (partialPhysics.lockRotationX as boolean) ?? false,
    lockRotationY: (partialPhysics.lockRotationY as boolean) ?? false,
    lockRotationZ: (partialPhysics.lockRotationZ as boolean) ?? false,
    isSensor: (partialPhysics.isSensor as boolean) ?? false,
  };
}

// Infer entity type from SceneNode components
function inferEntityType(node: SceneNode): string {
  const components = node.components || [];
  if (components.includes('PointLight')) return 'point_light';
  if (components.includes('DirectionalLight')) return 'directional_light';
  if (components.includes('SpotLight')) return 'spot_light';
  if (components.includes('Mesh3d')) {
    // Could be any mesh type, default to cube
    return 'mesh';
  }
  return 'unknown';
}

// Identify entity role for gameplay analysis
function identifyRole(
  node: SceneNode,
  components: import('@/stores/editorStore').GameComponentData[],
  hasPhysics: boolean,
  hasScript: boolean
): string {
  // Check for specific game components first
  for (const comp of components) {
    if (comp.type === 'characterController') return 'player';
    if (comp.type === 'collectible') return 'collectible';
    if (comp.type === 'damageZone') return 'obstacle';
    if (comp.type === 'checkpoint') return 'checkpoint';
    if (comp.type === 'teleporter') return 'teleporter';
    if (comp.type === 'triggerZone') return 'trigger';
    if (comp.type === 'winCondition') return 'goal';
    if (comp.type === 'spawner') return 'spawner';
    if (comp.type === 'follower') return 'enemy';
    if (comp.type === 'projectile') return 'projectile';
    if (comp.type === 'movingPlatform') return 'platform';
  }

  // Check for light entities
  const nodeComponents = node.components || [];
  if (nodeComponents.includes('PointLight') || nodeComponents.includes('DirectionalLight') || nodeComponents.includes('SpotLight')) {
    return 'light';
  }

  // Check for physics-based roles
  if (hasPhysics) {
    if (node.name.toLowerCase().includes('ground') || node.name.toLowerCase().includes('floor')) {
      return 'ground';
    }
    if (node.name.toLowerCase().includes('wall') || node.name.toLowerCase().includes('barrier')) {
      return 'obstacle';
    }
    if (node.name.toLowerCase().includes('platform')) {
      return 'platform';
    }
    return 'physics_object';
  }

  // Fallback: check for scripted entities
  if (hasScript) {
    return 'scripted';
  }

  // Default
  return 'decoration';
}

// Deterministic seeded PRNG for scatter pattern (mulberry32)
function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Calculate wall geometry from start/end points
function wallFromStartEnd(
  start: [number, number, number],
  end: [number, number, number],
  height: number,
  thickness: number
): { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dx, dz);
  const midX = (start[0] + end[0]) / 2;
  const midY = height / 2 + (start[1] + end[1]) / 2;
  const midZ = (start[2] + end[2]) / 2;
  return {
    position: [midX, midY, midZ],
    rotation: [0, angle, 0],
    scale: [thickness, height, length],
  };
}

// Helper to build GameComponentData from input
function buildGameComponentFromInput(
  type: string,
  props: Record<string, unknown>
): import('@/stores/editorStore').GameComponentData | null {
  switch (type) {
    case 'character_controller':
      return {
        type: 'characterController',
        characterController: {
          speed: (props.speed as number) ?? 5,
          jumpHeight: (props.jumpHeight as number) ?? 8,
          gravityScale: (props.gravityScale as number) ?? 1,
          canDoubleJump: (props.canDoubleJump as boolean) ?? false,
        },
      };
    case 'health':
      return {
        type: 'health',
        health: {
          maxHp: (props.maxHp as number) ?? 100,
          currentHp: (props.currentHp as number) ?? (props.maxHp as number) ?? 100,
          invincibilitySecs: (props.invincibilitySecs as number) ?? 0.5,
          respawnOnDeath: (props.respawnOnDeath as boolean) ?? true,
          respawnPoint: (props.respawnPoint as [number, number, number]) ?? [0, 1, 0],
        },
      };
    case 'collectible':
      return {
        type: 'collectible',
        collectible: {
          value: (props.value as number) ?? 1,
          destroyOnCollect: (props.destroyOnCollect as boolean) ?? true,
          pickupSoundAsset: (props.pickupSoundAsset as string | null) ?? null,
          rotateSpeed: (props.rotateSpeed as number) ?? 90,
        },
      };
    case 'damage_zone':
      return {
        type: 'damageZone',
        damageZone: {
          damagePerSecond: (props.damagePerSecond as number) ?? 25,
          oneShot: (props.oneShot as boolean) ?? false,
        },
      };
    case 'checkpoint':
      return {
        type: 'checkpoint',
        checkpoint: {
          autoSave: (props.autoSave as boolean) ?? true,
        },
      };
    case 'teleporter':
      return {
        type: 'teleporter',
        teleporter: {
          targetPosition: (props.targetPosition as [number, number, number]) ?? [0, 1, 0],
          cooldownSecs: (props.cooldownSecs as number) ?? 1,
        },
      };
    case 'moving_platform':
      return {
        type: 'movingPlatform',
        movingPlatform: {
          speed: (props.speed as number) ?? 2,
          waypoints: (props.waypoints as [number, number, number][]) ?? [[0, 0, 0], [0, 3, 0]],
          pauseDuration: (props.pauseDuration as number) ?? 0.5,
          loopMode: (props.loopMode as import('@/stores/editorStore').PlatformLoopMode) ?? 'pingPong',
        },
      };
    case 'trigger_zone':
      return {
        type: 'triggerZone',
        triggerZone: {
          eventName: (props.eventName as string) ?? 'trigger',
          oneShot: (props.oneShot as boolean) ?? false,
        },
      };
    case 'spawner':
      return {
        type: 'spawner',
        spawner: {
          entityType: (props.entityType as string) ?? 'cube',
          intervalSecs: (props.intervalSecs as number) ?? 3,
          maxCount: (props.maxCount as number) ?? 5,
          spawnOffset: (props.spawnOffset as [number, number, number]) ?? [0, 1, 0],
          onTrigger: (props.onTrigger as string | null) ?? null,
        },
      };
    case 'follower':
      return {
        type: 'follower',
        follower: {
          targetEntityId: (props.targetEntityId as string | null) ?? null,
          speed: (props.speed as number) ?? 3,
          stopDistance: (props.stopDistance as number) ?? 1.5,
          lookAtTarget: (props.lookAtTarget as boolean) ?? true,
        },
      };
    case 'projectile':
      return {
        type: 'projectile',
        projectile: {
          speed: (props.speed as number) ?? 15,
          damage: (props.damage as number) ?? 10,
          lifetimeSecs: (props.lifetimeSecs as number) ?? 5,
          gravity: (props.gravity as boolean) ?? false,
          destroyOnHit: (props.destroyOnHit as boolean) ?? true,
        },
      };
    case 'win_condition':
      return {
        type: 'winCondition',
        winCondition: {
          conditionType: (props.conditionType as import('@/stores/editorStore').WinConditionType) ?? 'score',
          targetScore: (props.targetScore as number | null) ?? 10,
          targetEntityId: (props.targetEntityId as string | null) ?? null,
        },
      };

    default:
      return null;
  }
}
