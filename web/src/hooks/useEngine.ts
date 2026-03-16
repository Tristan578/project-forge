import { useEffect, useRef, useCallback, useState } from 'react';
import { logInitEvent, type InitPhase } from '@/lib/initLog';
import { emitStatusEvent } from './useEngineStatus';
import { captureException, setTag } from '@/lib/monitoring/sentry-client';
import { showError } from '@/lib/toast';

export type WasmModule = {
  init_engine: (canvasId: string) => void;
  handle_command: (command: string, payload: unknown) => unknown;
  set_init_callback: (callback: (phase: string, message?: string, error?: string) => void) => void;
  set_event_callback: (callback: (event: unknown) => void) => void;
};

let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;
let panicInterceptorInstalled = false;

// --- Engine crash state (module-level for cross-component access) ---
let _engineCrashed = false;
let _engineCrashMessage: string | null = null;
type CrashListener = (message: string) => void;
const _crashListeners = new Set<CrashListener>();

/** Subscribe to engine crash events. Returns an unsubscribe function. */
export function onEngineCrash(listener: CrashListener): () => void {
  _crashListeners.add(listener);
  return () => { _crashListeners.delete(listener); };
}

/** Whether the WASM engine has crashed and not yet recovered. */
export function isEngineCrashed(): boolean {
  return _engineCrashed;
}

/** The panic message from the last WASM crash, or null if none. */
export function getEngineCrashMessage(): string | null {
  return _engineCrashMessage;
}

/** Mark the engine as crashed and notify all listeners. */
function setEngineCrashed(message: string): void {
  _engineCrashed = true;
  _engineCrashMessage = message;
  wasmModule = null;
  for (const listener of _crashListeners) {
    try { listener(message); } catch { /* prevent listener errors from breaking the loop */ }
  }
}

/** Clear crash state (used after recovery). */
function clearEngineCrash(): void {
  _engineCrashed = false;
  _engineCrashMessage = null;
}

/**
 * Install a global interceptor for WASM panics.
 * After detecting a panic, sets engineCrashed state so components can react.
 */
function installPanicInterceptor(): void {
  if (panicInterceptorInstalled || typeof window === 'undefined') return;
  panicInterceptorInstalled = true;

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);

    const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    if (msg.includes('panicked at') || msg.includes('wasm-bindgen')) {
      captureException(new Error(`WASM panic: ${msg.slice(0, 500)}`), {
        source: 'console_error_panic_hook',
        fullMessage: msg.slice(0, 2000),
        engineBackend: detectWebGPU() ? 'webgpu' : 'webgl2',
      });
      setEngineCrashed(msg.slice(0, 500));
    }
  };
}

function emitEvent(phase: InitPhase, message?: string, error?: string) {
  const event = logInitEvent(phase, message, error);
  emitStatusEvent(event);
}

function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

const ENGINE_CDN_BASE = (process.env.NEXT_PUBLIC_ENGINE_CDN_URL || '').replace(/\/+$/, '');

async function loadWasmFromPath(basePath: string, jsFile: string, wasmFile: string): Promise<WasmModule> {
  const wasm = await import(/* webpackIgnore: true */ `${basePath}${jsFile}`);
  await wasm.default(`${basePath}${wasmFile}`);
  const mod = wasm as unknown as WasmModule;
  if (mod.set_init_callback) {
    mod.set_init_callback((phase: string, message?: string, error?: string) => {
      emitEvent(phase as InitPhase, message, error);
    });
  }
  return mod;
}

async function loadWasm(): Promise<WasmModule> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).__SKIP_ENGINE) {
    throw new Error('Engine loading skipped (__SKIP_ENGINE is set)');
  }
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  installPanicInterceptor();

  initPromise = (async () => {
    const useWebGPU = detectWebGPU();
    const backend = useWebGPU ? 'webgpu' : 'webgl2';
    emitEvent('wasm_loading', `Fetching WASM module (${backend})...`);

    const basePath = `${ENGINE_CDN_BASE}/engine-pkg-${backend}/`;
    const jsFile = 'forge_engine.js';
    const wasmFile = 'forge_engine_bg.wasm';

    try {
      wasmModule = await loadWasmFromPath(basePath, jsFile, wasmFile);
      emitEvent('wasm_loaded', `WASM JS module loaded (${backend}), initializing...`);
      return wasmModule;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (useWebGPU) {
        emitEvent('wasm_loading', 'WebGPU load failed, falling back to WebGL2...');
        const fallbackPath = `${ENGINE_CDN_BASE}/engine-pkg-webgl2/`;
        try {
          wasmModule = await loadWasmFromPath(fallbackPath, jsFile, wasmFile);
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

export function resetEngine(): void {
  wasmModule = null;
  initPromise = null;
  clearEngineCrash();
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

  useEffect(() => {
    onReadyRef.current = options?.onReady;
    onErrorRef.current = options?.onError;
  }, [options?.onReady, options?.onError]);

  useEffect(() => {
    if (initializedRef.current) return;
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
        setTag('engine.backend', detectWebGPU() ? 'webgpu' : 'webgl2');
        setTag('engine.canvas', canvasId);
        try {
          wasm.init_engine(canvasId);
          setIsReady(true);
          if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__FORGE_ENGINE_READY = true;
          }
          onReadyRef.current?.();
        } catch (err) {
          const engineError = err instanceof Error ? err : new Error(String(err));
          emitEvent('error', 'Engine initialization failed', engineError.message);
          captureException(engineError, { phase: 'init_engine', canvasId, backend: detectWebGPU() ? 'webgpu' : 'webgl2' });
          setError(engineError);
          onErrorRef.current?.(engineError);
          initializedRef.current = false;
        }
      })
      .catch((err) => {
        const loadError = err instanceof Error ? err : new Error(String(err));
        captureException(loadError, { phase: 'wasm_load', backend: detectWebGPU() ? 'webgpu' : 'webgl2', cdnBase: ENGINE_CDN_BASE || '(same-origin)' });
        if (!loadError.message.includes('__SKIP_ENGINE')) {
          showError('Engine failed to load. Please refresh the page.');
        }
        setError(loadError);
        onErrorRef.current?.(loadError);
        initializedRef.current = false;
      });
  }, [canvasId]);

  const sendCommand = useCallback(
    <T = unknown>(command: string, payload: unknown): T | undefined => {
      if (!wasmModule) { console.warn('Engine not initialized'); return undefined; }
      try {
        return wasmModule.handle_command(command, payload) as T;
      } catch (err) {
        const cmdError = err instanceof Error ? err : new Error(String(err));
        captureException(cmdError, {
          phase: 'handle_command', command,
          payload: typeof payload === 'object' ? (() => { try { return JSON.stringify(payload).slice(0, 500); } catch { return '[unserializable]'; } })() : String(payload),
        });
        throw err;
      }
    },
    []
  );

  return { isReady, error, sendCommand, wasmModule };
}

export { wasmModule, loadWasm };

export function getWasmModule(): WasmModule | null {
  return wasmModule;
}
