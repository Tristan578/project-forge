import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore, setPlayTickCallback } from '@/stores/editorStore';
import { audioManager } from '@/lib/audio/audioManager';

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
  const addScriptLog = useEditorStore((s) => s.addScriptLog);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);

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

      worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'commands':
            for (const cmd of msg.commands) {
              const { cmd: cmdName, ...payload } = cmd;
              if (handleAudioCommand(cmdName, payload)) {
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

        worker.postMessage({
          type: 'tick',
          dt,
          elapsed: elapsedRef.current,
          entities: tickData.entities,
          entityInfos: tickData.entityInfos,
          inputState: tickData.inputState,
        });
      });

      workerRef.current = worker;
    }

    // Stop worker when leaving Play mode
    if (engineMode === 'edit' && workerRef.current) {
      setPlayTickCallback(null);
      workerRef.current.postMessage({ type: 'stop' });
      workerRef.current.terminate();
      workerRef.current = null;
      useEditorStore.getState().setHudElements([]);
    }
  }, [engineMode, wasmModule, dispatchCommand, addScriptLog]);

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
