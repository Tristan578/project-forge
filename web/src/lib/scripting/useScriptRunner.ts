import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore } from '@/stores/editorStore';

interface ScriptRunnerOptions {
  wasmModule: {
    handle_command?: (command: string, payload: unknown) => unknown;
  } | null;
}

export function useScriptRunner({ wasmModule }: ScriptRunnerOptions) {
  const engineMode = useEditorStore((s) => s.engineMode);
  const workerRef = useRef<Worker | null>(null);
  const addScriptLog = useEditorStore((s) => s.addScriptLog);

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

      worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'commands':
            for (const cmd of msg.commands) {
              const { cmd: cmdName, ...payload } = cmd;
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
        }
      };

      // Gather scripts from store's scene graph entities that have scripts
      // The script data is stored in the Rust engine. We need to collect it.
      // For now, we'll collect from the primaryScript state if selected,
      // and from any entity data we have. In practice, the engine should
      // emit all scripts on Play.
      const store = useEditorStore.getState();
      const scripts: { entityId: string; source: string; enabled: boolean }[] = [];

      // Collect all entities with scripts from scene graph
      // Note: Script data is stored on the Rust side. The SCRIPT_CHANGED events
      // populate primaryScript, but we don't have all scripts cached.
      // For the initial implementation, we rely on the engine emitting a
      // PLAY_SCRIPTS event with all script data. If that doesn't exist yet,
      // we use what we have locally.
      if (store.primaryScript && store.primaryId) {
        scripts.push({
          entityId: store.primaryId,
          source: store.primaryScript.source,
          enabled: store.primaryScript.enabled,
        });
      }

      // Also include any scripts from allScripts cache
      for (const [eid, script] of Object.entries(store.allScripts)) {
        if (!scripts.find(s => s.entityId === eid)) {
          scripts.push({ entityId: eid, source: script.source, enabled: script.enabled });
        }
      }

      worker.postMessage({
        type: 'init',
        scripts,
        entities: {},
        inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
      });

      workerRef.current = worker;
    }

    // Stop worker when leaving Play mode
    if (engineMode === 'edit' && workerRef.current) {
      workerRef.current.postMessage({ type: 'stop' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [engineMode, wasmModule, dispatchCommand, addScriptLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'stop' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);
}
