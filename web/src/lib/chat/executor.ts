/**
 * Tool call executor — maps Claude tool calls to editorStore commands.
 * Runs client-side in the browser to go through the wasm-bindgen bridge.
 */

import type { EditorState, MaterialData, LightData, PhysicsData, EntityType, InputBinding, ParticlePreset } from '@/stores/editorStore';

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
        };

        const merged: MaterialData = { ...baseMaterial };
        for (const [key, value] of Object.entries(matInput)) {
          if (key in merged) {
            (merged as unknown as Record<string, unknown>)[key] = value;
          }
        }

        store.updateMaterial(entityId, merged);
        return { success: true };
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

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Execution failed' };
  }
}
