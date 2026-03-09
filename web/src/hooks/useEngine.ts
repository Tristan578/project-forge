import { useEffect, useRef, useCallback, useState } from 'react';
import { logInitEvent, type InitPhase } from '@/lib/initLog';
import { emitStatusEvent } from './useEngineStatus';
import { captureException } from '@/lib/monitoring/sentry-client';
import * as Sentry from '@sentry/nextjs';

export type WasmModule = {
  init_engine: (canvasId: string) => void;
  handle_command: (command: string, payload: unknown) => unknown;
  set_init_callback: (callback: (phase: string, message?: string, error?: string) => void) => void;
  set_event_callback: (callback: (event: unknown) => void) => void;
};

let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;
let panicInterceptorInstalled = false;

/**
 * Install a global interceptor for WASM panics.
 * Rust's console_error_panic_hook writes panics to console.error —
 * this catches them and forwards to Sentry with structured context.
 */
function installPanicInterceptor(): void {
  if (panicInterceptorInstalled || typeof window === 'undefined') return;
  panicInterceptorInstalled = true;

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);

    // Detect Rust/WASM panics from console_error_panic_hook
    const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    if (msg.includes('panicked at') || msg.includes('wasm-bindgen')) {
      captureException(new Error(`WASM panic: ${msg.slice(0, 500)}`), {
        source: 'console_error_panic_hook',
        fullMessage: msg.slice(0, 2000),
        engineBackend: detectWebGPU() ? 'webgpu' : 'webgl2',
      });
    }
  };
}

// Emit event helper that logs and notifies listeners
function emitEvent(phase: InitPhase, message?: string, error?: string) {
  const event = logInitEvent(phase, message, error);
  emitStatusEvent(event);
}

/** Detect whether the browser supports WebGPU. */
function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Base URL for WASM engine files. When NEXT_PUBLIC_ENGINE_CDN_URL is set
 * (e.g. "https://cdn.spawnforge.ai"), files are loaded from the CDN.
 * Otherwise falls back to same-origin paths (local dev / self-hosted).
 */
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
  // Skip WASM loading when engine is explicitly disabled (CI E2E @ui tests)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).__SKIP_ENGINE) {
    throw new Error('Engine loading skipped (__SKIP_ENGINE is set)');
  }
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  // Intercept WASM panics before loading
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

      // If WebGPU failed, try falling back to WebGL2
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

        // Set Sentry context for all subsequent errors in this session
        Sentry.setTag('engine.backend', detectWebGPU() ? 'webgpu' : 'webgl2');
        Sentry.setTag('engine.canvas', canvasId);

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
          captureException(engineError, {
            phase: 'init_engine',
            canvasId,
            backend: detectWebGPU() ? 'webgpu' : 'webgl2',
          });
          setError(engineError);
          onErrorRef.current?.(engineError);
          initializedRef.current = false;
        }
      })
      .catch((err) => {
        const loadError = err instanceof Error ? err : new Error(String(err));
        captureException(loadError, {
          phase: 'wasm_load',
          backend: detectWebGPU() ? 'webgpu' : 'webgl2',
          cdnBase: ENGINE_CDN_BASE || '(same-origin)',
        });
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
      try {
        return wasmModule.handle_command(command, payload) as T;
      } catch (err) {
        const cmdError = err instanceof Error ? err : new Error(String(err));
        captureException(cmdError, {
          phase: 'handle_command',
          command,
          payload: typeof payload === 'object' ? JSON.stringify(payload).slice(0, 500) : String(payload),
        });
        throw err;
      }
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
