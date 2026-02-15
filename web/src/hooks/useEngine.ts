import { useEffect, useRef, useCallback, useState } from 'react';
import { logInitEvent, type InitPhase } from '@/lib/initLog';
import { emitStatusEvent } from './useEngineStatus';

export type WasmModule = {
  init_engine: (canvasId: string) => void;
  handle_command: (command: string, payload: unknown) => unknown;
  set_init_callback: (callback: (phase: string, message?: string, error?: string) => void) => void;
  set_event_callback: (callback: (event: unknown) => void) => void;
};

let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;

// Emit event helper that logs and notifies listeners
function emitEvent(phase: InitPhase, message?: string, error?: string) {
  const event = logInitEvent(phase, message, error);
  emitStatusEvent(event);
}

/** Detect whether the browser supports WebGPU. */
function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const useWebGPU = detectWebGPU();
    const backend = useWebGPU ? 'webgpu' : 'webgl2';

    emitEvent('wasm_loading', `Fetching WASM module (${backend})...`);

    // Choose pkg directory based on detected backend
    const basePath = `/engine-pkg-${backend}/`;
    const jsFile = 'forge_engine.js';
    const wasmFile = 'forge_engine_bg.wasm';

    try {
      // Dynamic import with bundler bypass
      const wasm = await import(/* webpackIgnore: true */ `${basePath}${jsFile}`);

      emitEvent('wasm_loaded', `WASM JS module loaded (${backend}), initializing...`);

      // Initialize with explicit WASM path (don't rely on import.meta.url)
      await wasm.default(`${basePath}${wasmFile}`);

      wasmModule = wasm as unknown as WasmModule;

      // Register callback for Rust-side events
      if (wasmModule.set_init_callback) {
        wasmModule.set_init_callback((phase: string, message?: string, error?: string) => {
          emitEvent(phase as InitPhase, message, error);
        });
      }

      return wasmModule;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // If WebGPU failed, try falling back to WebGL2
      if (useWebGPU) {
        emitEvent('wasm_loading', 'WebGPU load failed, falling back to WebGL2...');
        const fallbackPath = '/engine-pkg-webgl2/';
        try {
          const fallbackWasm = await import(/* webpackIgnore: true */ `${fallbackPath}${jsFile}`);
          await fallbackWasm.default(`${fallbackPath}${wasmFile}`);
          wasmModule = fallbackWasm as unknown as WasmModule;
          if (wasmModule.set_init_callback) {
            wasmModule.set_init_callback((phase: string, message?: string, error?: string) => {
              emitEvent(phase as InitPhase, message, error);
            });
          }
          return wasmModule;
        } catch (fallbackErr) {
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          emitEvent('error', 'Failed to load both WebGPU and WebGL2 WASM modules', fallbackMsg);
          throw fallbackErr;
        }
      }

      emitEvent('error', 'Failed to load WASM module', errorMsg);
      throw err;
    }
  })();

  return initPromise;
}

// Reset for retry
export function resetEngine(): void {
  wasmModule = null;
  initPromise = null;
}

export interface UseEngineOptions {
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export function useEngine(canvasId: string, options?: UseEngineOptions) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const initializedRef = useRef(false);
  const onReadyRef = useRef(options?.onReady);
  const onErrorRef = useRef(options?.onError);

  // Keep refs updated
  useEffect(() => {
    onReadyRef.current = options?.onReady;
    onErrorRef.current = options?.onError;
  }, [options?.onReady, options?.onError]);

  useEffect(() => {
    if (initializedRef.current) return;

    // SSR guard
    if (typeof document === 'undefined') return;

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      emitEvent('error', 'Canvas element not found', `No element with id="${canvasId}"`);
      return;
    }

    initializedRef.current = true;

    loadWasm()
      .then((wasm) => {
        emitEvent('engine_starting', `Calling init_engine("${canvasId}")`);

        try {
          wasm.init_engine(canvasId);
          // Note: For Bevy on WASM, init_engine may not return immediately
          // The 'ready' event will be emitted from Rust when first frame renders
          setIsReady(true);
          // Expose readiness flag for E2E tests (Playwright)
          if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__FORGE_ENGINE_READY = true;
          }
          onReadyRef.current?.();
        } catch (err) {
          const engineError = err instanceof Error ? err : new Error(String(err));
          emitEvent('error', 'Engine initialization failed', engineError.message);
          setError(engineError);
          onErrorRef.current?.(engineError);
          initializedRef.current = false;
        }
      })
      .catch((err) => {
        const loadError = err instanceof Error ? err : new Error(String(err));
        setError(loadError);
        onErrorRef.current?.(loadError);
        initializedRef.current = false;
      });
  }, [canvasId]);

  const sendCommand = useCallback(
    <T = unknown>(command: string, payload: unknown): T | undefined => {
      if (!wasmModule) {
        console.warn('Engine not initialized');
        return undefined;
      }
      return wasmModule.handle_command(command, payload) as T;
    },
    []
  );

  return { isReady, error, sendCommand, wasmModule };
}

// Export for use by other hooks
export { wasmModule, loadWasm };

// Getter for wasmModule (for hooks that need it outside of React context)
export function getWasmModule(): WasmModule | null {
  return wasmModule;
}
