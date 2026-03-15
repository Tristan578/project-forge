import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore, setPlayTickCallback } from '@/stores/editorStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { audioManager } from '@/lib/audio/audioManager';
import { extractWaveform } from '@/lib/audio/waveformExtractor';
import { AsyncChannelRouter } from '@/lib/scripting/asyncChannelRouter';
import {
  createPhysicsHandler,
  createAiHandler,
  createAssetHandler,
  createAudioHandler,
  createAnimationHandler,
} from '@/lib/scripting/channels';
import type { AsyncRequest } from '@/lib/scripting/asyncTypes';
import { showError } from '@/lib/toast';

// Commands allowed from user scripts (maps to forge.* API surface)
const SCRIPT_ALLOWED_COMMANDS = new Set([
  // Transform / entity lifecycle
  'update_transform', 'spawn_entity', 'delete_entities',
  'set_visibility', 'update_material',
  // 3D physics
  'apply_force', 'set_velocity', 'apply_impulse',
  // 2D physics
  'apply_force2d', 'apply_impulse2d', 'set_velocity2d',
  'set_angular_velocity2d', 'set_gravity2d',
  // Audio (routed to WASM)
  'play_audio', 'stop_audio', 'pause_audio', 'set_audio', 'update_audio_bus',
  // Audio layering (handled JS-side via audioManager but listed for completeness)
  'audio_add_layer', 'audio_remove_layer', 'audio_remove_all_layers',
  'audio_crossfade', 'audio_play_one_shot', 'audio_fade_in', 'audio_fade_out',
  'set_music_intensity', 'set_music_stems',
  // 3D animation
  'play_animation', 'pause_animation', 'resume_animation', 'stop_animation',
  'set_animation_speed', 'set_animation_loop',
  'set_animation_blend_weight', 'set_clip_speed',
  // Sprite animation
  'play_sprite_animation', 'stop_sprite_animation',
  'set_sprite_anim_speed', 'set_sprite_anim_param',
  // Particles
  'set_particle_preset', 'toggle_particle', 'burst_particle',
  // Camera
  'camera_follow', 'camera_stop_follow', 'camera_set_position', 'camera_look_at',
  // Tilemap
  'set_tile', 'fill_tiles', 'clear_tiles', 'resize_tilemap',
  // Skeletal 2D
  'create_skeleton2d', 'add_bone2d', 'remove_bone2d', 'update_bone2d',
  'set_skeleton2d_skin', 'play_skeletal_animation2d', 'stop_skeletal_animation2d',
  'set_ik_target2d',
  // Input
  'vibrate',
  // Audio snapshots & loop detection
  'audio_save_snapshot', 'audio_load_snapshot', 'audio_detect_loop_points',
  // Scene control
  'stop',
]);

const WATCHDOG_TIMEOUT_MS = 5000;
const OCCLUSION_RAYCAST_INTERVAL_MS = 250; // Check occlusion 4x per second

// Module-level collision callback (replaces window.__scriptCollisionCallback)
let _scriptCollisionCallback: ((event: { entityA: string; entityB: string; started: boolean }) => void) | null = null;

export function getScriptCollisionCallback() {
  return _scriptCollisionCallback;
}

interface ScriptRunnerOptions {
  wasmModule: {
    handle_command?: (command: string, payload: unknown) => unknown;
  } | null;
}

/**
 * Handle audio layering/transition commands JS-side (no WASM dispatch needed).
 * Returns true if the command was handled.
 */
function handleAudioCommand(cmdName: string, payload: Record<string, unknown>): boolean {
  switch (cmdName) {
    case 'audio_add_layer':
      audioManager.addLayer(
        payload.entityId as string,
        payload.slotName as string,
        payload.assetId as string,
        {
          volume: payload.volume as number | undefined,
          pitch: payload.pitch as number | undefined,
          loop: payload.loop as boolean | undefined,
          spatial: payload.spatial as boolean | undefined,
          bus: payload.bus as string | undefined,
        }
      );
      return true;
    case 'audio_remove_layer':
      audioManager.removeLayer(payload.entityId as string, payload.slotName as string);
      return true;
    case 'audio_remove_all_layers':
      audioManager.removeAllLayers(payload.entityId as string);
      return true;
    case 'audio_crossfade':
      audioManager.crossfade(
        payload.fromEntityId as string,
        payload.toEntityId as string,
        payload.durationMs as number
      );
      return true;
    case 'audio_play_one_shot':
      audioManager.playOneShot(payload.assetId as string, {
        position: payload.position as [number, number, number] | undefined,
        bus: payload.bus as string | undefined,
        volume: payload.volume as number | undefined,
        pitch: payload.pitch as number | undefined,
      });
      return true;
    case 'audio_fade_in':
      audioManager.fadeIn(payload.entityId as string, payload.durationMs as number);
      return true;
    case 'audio_fade_out':
      audioManager.fadeOut(payload.entityId as string, payload.durationMs as number);
      return true;
    case 'audio_save_snapshot':
      audioManager.saveSnapshot(
        payload.name as string,
        payload.crossfadeDurationMs as number | undefined
      );
      return true;
    case 'audio_load_snapshot':
      audioManager.loadSnapshot(
        payload.name as string,
        payload.durationMs as number | undefined
      );
      return true;
    case 'audio_detect_loop_points':
      audioManager.detectLoopPoints(
        payload.assetId as string,
        {
          maxResults: payload.maxResults as number | undefined,
          minLoopDuration: payload.minLoopDuration as number | undefined,
        }
      );
      return true;
    default:
      return false;
  }
}

export function useScriptRunner({ wasmModule }: ScriptRunnerOptions) {
  const engineMode = useEditorStore((s) => s.engineMode);
  const workerRef = useRef<Worker | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addScriptLog = useEditorStore((s) => s.addScriptLog);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const lastOcclusionCheckRef = useRef(0);
  const collisionEventCallbackRef = useRef<((event: { entityA: string; entityB: string; started: boolean }) => void) | null>(null);
  const routerRef = useRef<AsyncChannelRouter | null>(null);

  const dispatchCommand = useCallback(
    (command: string, payload: unknown): unknown => {
      if (wasmModule?.handle_command) {
        try {
          return wasmModule.handle_command(command, payload);
        } catch (error) {
          console.error(`[ScriptRunner] Command error '${command}':`, error);
        }
      }
      return undefined;
    },
    [wasmModule]
  );

  // Start worker when entering Play mode
  useEffect(() => {
    if (engineMode === 'play' && !workerRef.current && wasmModule) {
      const worker = new Worker(
        new URL('./scriptWorker.ts', import.meta.url),
        { type: 'module' }
      );

      // Initialize async channel router
      const router = new AsyncChannelRouter();
      router.setPlayMode(true);

      // Register channel handlers with their dependencies
      const fetchJson = async (url: string, init?: RequestInit) => {
        const resp = await fetch(url, init);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }
        return resp.json();
      };

      router.register('physics', createPhysicsHandler({ dispatchCommand }));
      router.register('animation', createAnimationHandler({ dispatchCommand }));
      router.register('audio', createAudioHandler({
        detectLoopPoints: (assetId: string) => Promise.resolve(audioManager.detectLoopPoints(assetId)),
        getWaveform: (assetId: string) => {
          const buffer = audioManager.getBuffer(assetId);
          if (!buffer) return Promise.resolve(null);
          return Promise.resolve(extractWaveform(buffer));
        },
      }));
      router.register('ai', createAiHandler({ fetchJson }));
      router.register('asset', createAssetHandler({ fetchJson }));
      // NOTE: 'multiplayer' channel is declared in asyncTypes.ts but intentionally not
      // registered here — no networking backend exists yet. Requests to it will fail with
      // "Unknown async channel" until multiplayer is implemented.

      routerRef.current = router;

      const setHudElements = useEditorStore.getState().setHudElements;

      worker.onmessage = async (e) => {
        // Clear watchdog on any response — worker is alive
        if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        const msg = e.data;
        switch (msg.type) {
          case 'commands':
            for (const cmd of msg.commands) {
              const { cmd: cmdName, ...payload } = cmd;
              if (handleAudioCommand(cmdName, payload)) {
                continue;
              }
              if (!SCRIPT_ALLOWED_COMMANDS.has(cmdName)) {
                console.warn(`[ScriptRunner] Blocked unauthorized command: ${cmdName}`);
                continue;
              }
              dispatchCommand(cmdName, payload);
            }
            break;
          case 'log':
            addScriptLog({
              entityId: msg.entityId,
              level: msg.level,
              message: msg.message,
              timestamp: Date.now(),
            });
            break;
          case 'error':
            addScriptLog({
              entityId: msg.entityId,
              level: 'error',
              message: `[line ${msg.line}] ${msg.message}`,
              timestamp: Date.now(),
            });
            break;
          case 'ui':
            setHudElements(msg.elements || []);
            break;
          case 'ui_screen': {
            try {
              const uiStore = (await import('@/stores/uiBuilderStore')).useUIBuilderStore;
              uiStore.getState().handleRuntimeScreenAction(msg.action, msg.target);
            } catch {
              // uiBuilderStore not available yet
            }
            break;
          }
          case 'ui_widget': {
            try {
              const uiStore = (await import('@/stores/uiBuilderStore')).useUIBuilderStore;
              uiStore.getState().handleRuntimeWidgetAction(msg);
            } catch {
              // uiBuilderStore not available yet
            }
            break;
          }
          case 'camera_set_mode': {
            const { mode } = msg;
            const store = useEditorStore.getState();
            const primaryId = store.activeGameCameraId || store.primaryId;
            if (primaryId) {
              const existing = store.allGameCameras[primaryId] || { mode: 'thirdPersonFollow', targetEntity: null };
              store.setGameCamera(primaryId, { ...existing, mode });
            }
            break;
          }
          case 'camera_set_target': {
            const { entityId: targetEntityId } = msg;
            const store = useEditorStore.getState();
            const primaryId = store.activeGameCameraId || store.primaryId;
            if (primaryId) {
              const existing = store.allGameCameras[primaryId] || { mode: 'thirdPersonFollow', targetEntity: null };
              store.setGameCamera(primaryId, { ...existing, targetEntity: targetEntityId });
            }
            break;
          }
          case 'camera_shake': {
            const { intensity, duration } = msg;
            const store = useEditorStore.getState();
            const cameraId = store.activeGameCameraId;
            if (cameraId) {
              store.cameraShake(cameraId, intensity, duration);
            }
            break;
          }
          case 'camera_set_property': {
            const { property, value } = msg;
            const store = useEditorStore.getState();
            const primaryId = store.activeGameCameraId || store.primaryId;
            if (primaryId) {
              const existing = store.allGameCameras[primaryId] || { mode: 'thirdPersonFollow', targetEntity: null };
              store.setGameCamera(primaryId, { ...existing, [property]: value });
            }
            break;
          }
          case 'scene_load': {
            const { sceneName, transition } = msg;
            useEditorStore.getState().startSceneTransition(sceneName, transition);
            break;
          }
          case 'scene_restart': {
            const store = useEditorStore.getState();
            const currentSceneName = store.scenes.find(s => s.id === store.activeSceneId)?.name;
            if (currentSceneName) {
              store.startSceneTransition(currentSceneName, { type: 'instant' });
            }
            break;
          }
          case 'dialogue_start': {
            useDialogueStore.getState().startDialogue(msg.treeId);
            break;
          }
          case 'dialogue_end': {
            useDialogueStore.getState().endDialogue();
            break;
          }
          case 'dialogue_advance': {
            useDialogueStore.getState().advanceDialogue();
            break;
          }
          case 'dialogue_skip': {
            useDialogueStore.getState().skipTypewriter();
            break;
          }
          case 'dialogue_set_variable': {
            const dStore = useDialogueStore.getState();
            const tree = dStore.dialogueTrees[msg.treeId];
            if (tree) {
              dStore.updateTree(msg.treeId, { variables: { ...tree.variables, [msg.key]: msg.value } });
            }
            break;
          }
          case 'async_request': {
            // Route async request through the channel router
            if (routerRef.current) {
              void routerRef.current.handleRequest(msg as unknown as AsyncRequest);
            }
            break;
          }
        }
      };

      // Gather scripts
      const store = useEditorStore.getState();
      const scripts: { entityId: string; source: string; enabled: boolean }[] = [];

      if (store.primaryScript && store.primaryId) {
        scripts.push({
          entityId: store.primaryId,
          source: store.primaryScript.source,
          enabled: store.primaryScript.enabled,
        });
      }

      for (const [eid, script] of Object.entries(store.allScripts)) {
        if (!scripts.find(s => s.entityId === eid)) {
          scripts.push({ entityId: eid, source: script.source, enabled: script.enabled });
        }
      }

      // Build initial entityInfos from scene graph
      const entityInfos: Record<string, { name: string; type: string; colliderRadius: number }> = {};
      for (const [eid, node] of Object.entries(store.sceneGraph.nodes)) {
        entityInfos[eid] = {
          name: node.name,
          type: node.components.find(c => c.startsWith('EntityType')) || 'unknown',
          colliderRadius: 0.5,
        };
      }

      // Build synced 2D state for the worker
      const tilemapStates: Record<string, { tileSize: [number, number]; mapSize: [number, number]; layers: { tiles: (number | null)[] }[]; origin: string }> = {};
      for (const [eid, tm] of Object.entries(store.tilemaps)) {
        tilemapStates[eid] = {
          tileSize: tm.tileSize,
          mapSize: tm.mapSize,
          layers: tm.layers.map(l => ({ tiles: l.tiles })),
          origin: tm.origin,
        };
      }

      const skeletonStates: Record<string, { bones: { name: string; parentBone: string | null; localPosition: [number, number]; localRotation: number; localScale: [number, number]; length: number }[]; activeSkin: string }> = {};
      for (const [eid, sk] of Object.entries(store.skeletons2d)) {
        skeletonStates[eid] = {
          bones: sk.bones.map(b => ({
            name: b.name,
            parentBone: b.parentBone,
            localPosition: b.localPosition,
            localRotation: b.localRotation,
            localScale: b.localScale,
            length: b.length,
          })),
          activeSkin: sk.activeSkin,
        };
      }

      worker.postMessage({
        type: 'init',
        scripts,
        entities: {},
        entityInfos,
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
        tilemapStates,
        skeletonStates,
        physics2dVelocities: {},
      });

      // Send scene info to worker
      const sceneNames = store.scenes.map(s => s.name);
      const activeScene = store.scenes.find(s => s.id === store.activeSceneId)?.name || 'Main';
      worker.postMessage({
        type: 'scene_info',
        currentScene: activeScene,
        allSceneNames: sceneNames,
      });

      // Set up play tick callback for forwarding engine ticks to worker
      elapsedRef.current = 0;
      lastTickRef.current = performance.now();

      setPlayTickCallback((data: unknown) => {
        const now = performance.now();
        const dt = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;
        elapsedRef.current += dt;

        const tickData = data as {
          entities: Record<string, unknown>;
          entityInfos: Record<string, unknown>;
          inputState: unknown;
        };

        // Start watchdog — if Worker doesn't respond in 5s, terminate it
        if (!watchdogRef.current) {
          watchdogRef.current = setTimeout(() => {
            console.error('[ScriptRunner] Worker timeout — possible infinite loop. Terminating.');
            showError('Script timed out — possible infinite loop detected. Play mode stopped.');
            addScriptLog({
              entityId: '',
              level: 'error',
              message: 'Script execution timed out (possible infinite loop). Play mode stopped.',
              timestamp: Date.now(),
            });
            workerRef.current?.terminate();
            workerRef.current = null;
            watchdogRef.current = null;
            setPlayTickCallback(null);
            // Stop play mode via store action
            useEditorStore.getState().setEngineMode('edit');
          }, WATCHDOG_TIMEOUT_MS);
        }

        // Gather 2D state for the worker (tilemap data can change during play via setTile)
        const currentStore = useEditorStore.getState();
        const tickTilemapStates: Record<string, { tileSize: [number, number]; mapSize: [number, number]; layers: { tiles: (number | null)[] }[]; origin: string }> = {};
        for (const [eid, tm] of Object.entries(currentStore.tilemaps)) {
          tickTilemapStates[eid] = {
            tileSize: tm.tileSize,
            mapSize: tm.mapSize,
            layers: tm.layers.map(l => ({ tiles: l.tiles })),
            origin: tm.origin,
          };
        }

        // Flush any pending async responses into the tick message
        const asyncResponses = routerRef.current?.flush();

        worker.postMessage({
          type: 'tick',
          dt,
          elapsed: elapsedRef.current,
          entities: tickData.entities,
          entityInfos: tickData.entityInfos,
          inputState: tickData.inputState,
          audioPlayingStates: audioManager.getPlayingStates(),
          tilemapStates: tickTilemapStates,
          asyncResponses,
        });

        // Dispatch audio occlusion raycasts (throttled)
        const tickNow = performance.now();
        if (tickNow - lastOcclusionCheckRef.current >= OCCLUSION_RAYCAST_INTERVAL_MS) {
          lastOcclusionCheckRef.current = tickNow;
          const occludables = audioManager.getOccludableEntities();
          const listenerPos = audioManager.getListenerPosition();
          if (listenerPos && occludables.length > 0 && wasmModule?.handle_command) {
            for (const eid of occludables) {
              const srcPos = audioManager.getSourcePosition(eid);
              if (!srcPos) continue;
              // Raycast from listener toward source
              const dx = srcPos[0] - listenerPos[0];
              const dy = srcPos[1] - listenerPos[1];
              const dz = srcPos[2] - listenerPos[2];
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist < 0.01) continue; // Too close, skip
              try {
                wasmModule.handle_command('raycast_query', {
                  requestId: `audio_occlusion:${eid}:${dist}`,
                  origin: listenerPos,
                  direction: [dx / dist, dy / dist, dz / dist],
                  maxDistance: dist,
                });
              } catch {
                // Ignore raycast dispatch errors
              }
            }
          }
        }
      });

      // Set up collision event callback
      collisionEventCallbackRef.current = (event: { entityA: string; entityB: string; started: boolean }) => {
        worker.postMessage({
          type: 'COLLISION_EVENT',
          entityA: event.entityA,
          entityB: event.entityB,
          started: event.started,
        });
      };

      workerRef.current = worker;
    }

    // Stop worker when leaving Play mode
    if (engineMode === 'edit' && workerRef.current) {
      setPlayTickCallback(null);
      collisionEventCallbackRef.current = null;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      // Reset async channel router
      if (routerRef.current) {
        routerRef.current.reset();
        routerRef.current = null;
      }
      workerRef.current.postMessage({ type: 'stop' });
      workerRef.current.terminate();
      workerRef.current = null;
      useEditorStore.getState().setHudElements([]);
    }
  }, [engineMode, wasmModule, dispatchCommand, addScriptLog]);

  // Export collision callback via module-level variable (not window global)
  useEffect(() => {
    if (engineMode === 'play' && collisionEventCallbackRef.current) {
      _scriptCollisionCallback = collisionEventCallbackRef.current;
    } else {
      _scriptCollisionCallback = null;
    }
  }, [engineMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        setPlayTickCallback(null);
        workerRef.current.postMessage({ type: 'stop' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
      // Reset async channel router to abort in-flight operations and prevent leaks
      if (routerRef.current) {
        routerRef.current.reset();
        routerRef.current = null;
      }
    };
  }, []);
}
