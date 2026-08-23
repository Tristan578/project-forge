import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore, setPlayTickCallback } from '@/stores/editorStore';
import { useDialogueStore, getTree } from '@/stores/dialogueStore';
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
import { DeltaSerializer, type SceneSnapshot } from '@/lib/engine/deltaSerializer';
import { checkCommandPayload } from '@/lib/engine/commandPayloadGuard';
import { getGroundedStates, clearGroundedStates } from '@/lib/scripting/groundedRegistry';
import { isScriptAllowedCommand } from '@/lib/scripting/scriptAllowlist';

const WATCHDOG_TIMEOUT_MS = 5000;
const OCCLUSION_RAYCAST_INTERVAL_MS = 250; // Check occlusion 4x per second

// Module-level collision callback (replaces window.__scriptCollisionCallback)
let _scriptCollisionCallback: ((event: { entityA: string; entityB: string; started: boolean }) => void) | null = null;

export function getScriptCollisionCallback() {
  return _scriptCollisionCallback;
}

/** A game event forwarded from the engine to the script worker (e.g. `game_win`). */
export interface ScriptGameEvent {
  eventName: string;
  sourceEntityId: string | null;
  targetEntityId: string | null;
}

// Module-level game-event callback, mirroring the collision-callback bridge. Set
// while in Play mode; consumed by the engine GAME_EVENT handler in gameEvents.ts.
let _scriptGameEventCallback: ((event: ScriptGameEvent) => void) | null = null;

export function getScriptGameEventCallback() {
  return _scriptGameEventCallback;
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
  const gameEventCallbackRef = useRef<((event: ScriptGameEvent) => void) | null>(null);
  const routerRef = useRef<AsyncChannelRouter | null>(null);
  const entityDeltaRef = useRef<DeltaSerializer | null>(null);
  const entityInfoDeltaRef = useRef<DeltaSerializer | null>(null);

  const dispatchCommand = useCallback(
    (command: string, payload: unknown): unknown => {
      // The one dispatch path that carries genuinely untrusted structure: a
      // user script running in the worker builds this payload, and
      // `structuredClone` happily posts a value far deeper than
      // `serde_wasm_bindgen` can walk to build what the Rust guard checks. That
      // walk happens before any engine code runs, and on wasm32 overflowing it
      // is an unrecoverable trap — the engine instance dies mid-game.
      const tooBig = checkCommandPayload(command, payload);
      if (tooBig) {
        console.error(`[ScriptRunner] Refused command '${command}': ${tooBig}`);
        return { success: false, error: tooBig };
      }
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
      // Multiplayer channel — stub handler until networking backend exists.
      // Throws so script catch blocks work correctly; the error message is
      // forwarded to the worker as { success: false, error: "..." }.
      router.register('multiplayer', async () => {
        throw new Error('Multiplayer is not yet available. This feature will be enabled in a future update.');
      });

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
              if (!isScriptAllowedCommand(cmdName)) {
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
            // `msg.treeId` comes off a worker `postMessage`, i.e. from a user
            // script — so `__proto__` reaches here. A bare index would return the
            // truthy `Object.prototype` and spread its (absent) `variables` into
            // an `updateTree` call for a tree that does not exist.
            const tree = getTree(dStore.dialogueTrees, msg.treeId);
            if (tree) {
              dStore.updateTree(msg.treeId, { variables: { ...tree.variables, [msg.key]: msg.value } });
            }
            break;
          }
          case 'game_win': {
            // Script-initiated win (forge.game.win()). Set the win state once and
            // broadcast back to the worker so every script's onWin handler fires.
            const gStore = useEditorStore.getState();
            if (!gStore.gameWon) {
              gStore.setGameWon(true);
              workerRef.current?.postMessage({
                type: 'GAME_EVENT',
                eventName: 'game_win',
                sourceEntityId: null,
                targetEntityId: null,
              });
            }
            break;
          }
          case 'game_set_score': {
            const score = typeof msg.score === 'number' ? msg.score : 0;
            useEditorStore.getState().setGameScore(score);
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
        // Whatever the engine has already reported. `play` enters the engine on
        // the rAF loop and this is a React effect, so a character standing on
        // the floor at play start has usually already emitted its one and only
        // (id, true) by now — and the engine emits CHANGES, so clearing here
        // would lose it until the character next left the ground and returned.
        // The stale-previous-session case this used to guard is closed by the
        // stop and unmount clears below (PF-1214, review finding #8).
        groundedStates: getGroundedStates(),
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

      // Initialize delta serializers for play-tick optimization
      // Keyframe every 60 frames (~1s at 60fps) for safety against drift
      entityDeltaRef.current = new DeltaSerializer(60);
      entityInfoDeltaRef.current = new DeltaSerializer(300); // entityInfos change rarely

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

        // Delta-encode entities and entityInfos to reduce per-frame serialization cost.
        // Instead of sending the full scene every frame, only changed components are sent.
        // The worker receives deltas and reconstructs full state locally.
        const entitiesSnapshot = tickData.entities as SceneSnapshot;
        const entityInfosSnapshot = tickData.entityInfos as SceneSnapshot;

        const entitiesDelta = entityDeltaRef.current
          ? entityDeltaRef.current.computeDelta(entitiesSnapshot)
          : null;
        const entityInfosDelta = entityInfoDeltaRef.current
          ? entityInfoDeltaRef.current.computeDelta(entityInfosSnapshot)
          : null;

        worker.postMessage({
          type: 'tick',
          dt,
          elapsed: elapsedRef.current,
          // Send deltas when available, fall back to full state
          entities: entitiesDelta ? undefined : tickData.entities,
          entitiesDelta: entitiesDelta || undefined,
          entityInfos: entityInfosDelta ? undefined : tickData.entityInfos,
          entityInfosDelta: entityInfosDelta || undefined,
          inputState: tickData.inputState,
          audioPlayingStates: audioManager.getPlayingStates(),
          tilemapStates: tickTilemapStates,
          // Kinematic ground contact, accumulated from CHARACTER_GROUNDED_CHANGED.
          // Small by construction: one entry per character, not per entity.
          groundedStates: getGroundedStates(),
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

      // Set up game event callback (engine win/score events → script worker)
      gameEventCallbackRef.current = (event: ScriptGameEvent) => {
        worker.postMessage({
          type: 'GAME_EVENT',
          eventName: event.eventName,
          sourceEntityId: event.sourceEntityId,
          targetEntityId: event.targetEntityId,
        });
      };

      workerRef.current = worker;
    }

    // Stop worker when leaving Play mode
    if (engineMode === 'edit' && workerRef.current) {
      setPlayTickCallback(null);
      collisionEventCallbackRef.current = null;
      gameEventCallbackRef.current = null;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      // Reset delta serializers
      if (entityDeltaRef.current) {
        entityDeltaRef.current.reset();
        entityDeltaRef.current = null;
      }
      if (entityInfoDeltaRef.current) {
        entityInfoDeltaRef.current.reset();
        entityInfoDeltaRef.current = null;
      }
      // Reset async channel router
      if (routerRef.current) {
        routerRef.current.reset();
        routerRef.current = null;
      }
      clearGroundedStates();
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

  // Export game-event callback via module-level variable (mirrors collision bridge)
  useEffect(() => {
    if (engineMode === 'play' && gameEventCallbackRef.current) {
      _scriptGameEventCallback = gameEventCallbackRef.current;
    } else {
      _scriptGameEventCallback = null;
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
      clearGroundedStates();
      // Reset async channel router to abort in-flight operations and prevent leaks
      if (routerRef.current) {
        routerRef.current.reset();
        routerRef.current = null;
      }
      // Reset delta serializers
      if (entityDeltaRef.current) {
        entityDeltaRef.current.reset();
        entityDeltaRef.current = null;
      }
      if (entityInfoDeltaRef.current) {
        entityInfoDeltaRef.current.reset();
        entityInfoDeltaRef.current = null;
      }
    };
  }, []);
}
