import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore, setPlayTickCallback } from '@/stores/editorStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { audioManager } from '@/lib/audio/audioManager';

// Commands allowed from user scripts (maps to forge.* API surface)
const SCRIPT_ALLOWED_COMMANDS = new Set([
  'set_transform', 'spawn_entity', 'despawn_entity',
  'set_visibility', 'update_material',
  'apply_force', 'set_velocity', 'apply_impulse',
  'play_audio', 'stop_audio', 'set_audio_volume',
  'play_animation', 'set_animation_speed', 'stop_animation',
  'camera_follow', 'camera_stop_follow', 'camera_set_position', 'camera_look_at',
]);

const WATCHDOG_TIMEOUT_MS = 5000;

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
  const collisionEventCallbackRef = useRef<((event: { entityA: string; entityB: string; started: boolean }) => void) | null>(null);

  const dispatchCommand = useCallback(
    (command: string, payload: unknown) => {
      if (wasmModule?.handle_command) {
        try {
          wasmModule.handle_command(command, payload);
        } catch (error) {
          console.error(`[ScriptRunner] Command error '${command}':`, error);
        }
      }
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

      worker.postMessage({
        type: 'init',
        scripts,
        entities: {},
        entityInfos,
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
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

        worker.postMessage({
          type: 'tick',
          dt,
          elapsed: elapsedRef.current,
          entities: tickData.entities,
          entityInfos: tickData.entityInfos,
          inputState: tickData.inputState,
        });
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
    };
  }, []);
}
