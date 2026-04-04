import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from 'react';
import { logInitEvent, type InitPhase } from '@/lib/initLog';
import { emitStatusEvent } from './useEngineStatus';
import { addBreadcrumb, captureException, setTag } from '@/lib/monitoring/sentry-client';
import { showError } from '@/lib/toast';
import { fetchWasmWithMetrics } from '@/lib/monitoring/cdnAnalytics';
import { GPU_INIT_TIMEOUT_MS, WASM_FETCH_TIMEOUT_MS } from '@/lib/config/timeouts';

/** Loading progress state exported for UI components to display progress feedback. */
export type LoadingPhase = 'idle' | 'detecting' | 'downloading' | 'initializing' | 'ready' | 'error';

export interface LoadingState {
  phase: LoadingPhase;
  progress?: number;
  error?: string;
}

// Re-export for backwards compatibility (tests import from this module)
export { GPU_INIT_TIMEOUT_MS, WASM_FETCH_TIMEOUT_MS } from '@/lib/config/timeouts';

let currentLoadingState: LoadingState = { phase: 'idle' };
type LoadingStateListener = (state: LoadingState) => void;
const loadingListeners: Set<LoadingStateListener> = new Set();

function setLoadingState(state: LoadingState): void {
  currentLoadingState = state;
  loadingListeners.forEach((listener) => listener(state));
}

/** Hook to subscribe to WASM loading progress state. */
export function useLoadingState(): LoadingState {
  return useSyncExternalStore(
    (onStoreChange) => {
      loadingListeners.add(onStoreChange);
      return () => { loadingListeners.delete(onStoreChange); };
    },
    () => currentLoadingState,
    () => currentLoadingState,
  );
}

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

// --- Recovery signal (allows useEngine hook to re-trigger onReady after recovery) ---
let _recoveryCount = 0;
type RecoveryListener = () => void;
const _recoveryListeners = new Set<RecoveryListener>();

function signalRecoveryComplete(): void {
  _recoveryCount++;
  for (const listener of _recoveryListeners) {
    try { listener(); } catch { /* prevent listener errors from breaking the loop */ }
  }
}

/** Subscribe to engine recovery completions. Returns an unsubscribe function. */
export function onEngineRecovered(listener: RecoveryListener): () => void {
  _recoveryListeners.add(listener);
  return () => { _recoveryListeners.delete(listener); };
}

/**
 * Install a global interceptor for WASM panics.
 * After detecting a panic, sets engineCrashed state so components can react.
 *
 * Catches panics from two sources:
 * 1. console.error from Rust's `console_error_panic_hook` (panicked at / wasm-bindgen)
 * 2. Unhandled RuntimeError from WASM traps (out-of-bounds, unreachable, etc.)
 */
function installPanicInterceptor(): void {
  if (panicInterceptorInstalled || typeof window === 'undefined') return;
  panicInterceptorInstalled = true;

  // Source 1: console.error from Rust panic hook
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);

    const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    if (msg.includes('panicked at') || msg.includes('wasm-bindgen')) {
      captureException(new Error(`WASM panic: ${msg.slice(0, 500)}`), {
        source: 'console_error_panic_hook',
        fullMessage: msg.slice(0, 2000),
        engineBackend: resolvedBackend,
      });
      setEngineCrashed(msg.slice(0, 500));
    }
  };

  // Source 2: Unhandled RuntimeError from WASM traps (unreachable, OOB, etc.)
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof WebAssembly.RuntimeError || (reason instanceof Error && reason.message.includes('unreachable'))) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      captureException(new Error(`WASM RuntimeError: ${msg.slice(0, 500)}`), {
        source: 'unhandled_wasm_runtime_error',
        fullMessage: msg.slice(0, 2000),
        engineBackend: resolvedBackend,
      });
      if (!_engineCrashed) {
        setEngineCrashed(`WASM RuntimeError: ${msg.slice(0, 500)}`);
      }
    }
  });
}

function emitEvent(phase: InitPhase, message?: string, error?: string) {
  const event = logInitEvent(phase, message, error);
  emitStatusEvent(event);
}

/** Race a promise against a timeout. Rejects with a descriptive error on timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Detect whether the browser supports WebGPU. */
function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Request a WebGPU adapter + device with a timeout.
 * Returns true if WebGPU is available and the device was acquired successfully.
 * Returns false if WebGPU is not supported or device init fails/times out.
 */
export async function probeWebGPU(): Promise<boolean> {
  if (!detectWebGPU()) return false;

  try {
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter(),
      GPU_INIT_TIMEOUT_MS,
      'WebGPU adapter request',
    );
    if (!adapter) return false;

    const device = await withTimeout(
      adapter.requestDevice(),
      GPU_INIT_TIMEOUT_MS,
      'WebGPU device request',
    );
    // Clean up the device immediately -- the engine will create its own
    device.destroy();
    return true;
  } catch {
    return false;
  }
}

/**
 * Base URL for WASM engine files. When NEXT_PUBLIC_ENGINE_CDN_URL is set
 * (e.g. "https://engine.spawnforge.ai"), files are loaded from the CDN.
 * Otherwise falls back to same-origin paths (local dev / self-hosted).
 *
 * When NEXT_PUBLIC_ENGINE_VERSION is also set (a git SHA injected at build
 * time), files are served from a versioned path
 * (e.g. "https://engine.spawnforge.ai/<sha>/engine-pkg-webgpu/") which
 * carries immutable Cache-Control headers uploaded by upload-wasm-to-r2.sh.
 * Without a version the /latest/ alias is used, which has a short TTL.
 */
const ENGINE_CDN_BASE = (process.env.NEXT_PUBLIC_ENGINE_CDN_URL || '').replace(/\/+$/, '');
const ENGINE_VERSION = (process.env.NEXT_PUBLIC_ENGINE_VERSION || '').trim();
/** Resolved prefix: "<cdn>/<version>" or "<cdn>/latest" or "" for same-origin. */
const ENGINE_CDN_ROOT = ENGINE_CDN_BASE
  ? ENGINE_VERSION
    ? `${ENGINE_CDN_BASE}/${ENGINE_VERSION}`
    : `${ENGINE_CDN_BASE}/latest`
  : '';

/**
 * Fetch the wasm-manifest.json from the given base path and return the
 * content hash. Returns null when the manifest is absent (e.g. local dev
 * without a WASM build, or legacy deployments). Never throws.
 *
 * Exported for unit testing only.
 */
export async function fetchWasmHash(basePath: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const manifestUrl = `${basePath}wasm-manifest.json`;
    const res = await fetch(manifestUrl, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { hash?: string };
    return typeof data.hash === 'string' && data.hash.length > 0 ? data.hash : null;
  } catch {
    return null;
  }
}

/**
 * Wrap a Response body in a ReadableStream that tracks download progress.
 * Emits progress callbacks with 0–100 integer values as bytes arrive.
 * Falls back to the original Response when the body is unavailable or
 * Content-Length is missing (progress will remain at 0).
 */
function wrapResponseWithProgress(
  response: Response,
  onProgress: (pct: number) => void,
): Response {
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (!response.body || !contentLength) return response;

  let received = 0;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        onProgress(100);
        return;
      }
      received += value.byteLength;
      onProgress(Math.min(Math.round((received / contentLength) * 100), 99));
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });

  // Clone headers but reconstruct a new Response around the tracked stream.
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function loadWasmFromPath(
  basePath: string,
  jsFile: string,
  wasmFile: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<WasmModule> {
  const wasm = await import(/* webpackIgnore: true */ `${basePath}${jsFile}`);

  // Append content hash as a query param so browsers re-fetch after deployments.
  // Falls back to the plain filename when no manifest exists.
  const hash = await fetchWasmHash(basePath, signal);
  const wasmUrl = hash ? `${basePath}${wasmFile}?v=${hash}` : `${basePath}${wasmFile}`;

  // Determine backend from the base path for CDN metrics
  const backend: 'webgpu' | 'webgl2' = basePath.includes('webgpu') ? 'webgpu' : 'webgl2';

  // Pre-fetch the .wasm binary with the abort signal so callers can cancel,
  // and wrap with a timeout to prevent infinite stalls.
  // Use fetchWasmWithMetrics to track CDN cache status and load timing.
  const fetchStart = performance.now();
  const rawResponse = await fetchWasmWithMetrics(wasmUrl, backend, fetchStart, signal);

  // Wrap the response body to stream real download progress percentages.
  const wasmInput = onProgress
    ? wrapResponseWithProgress(rawResponse, onProgress)
    : rawResponse;

  await withTimeout(
    wasm.default(wasmInput),
    WASM_FETCH_TIMEOUT_MS,
    'WASM fetch',
  );

  const mod = wasm as unknown as WasmModule;
  if (mod.set_init_callback) {
    mod.set_init_callback((phase: string, message?: string, error?: string) => {
      emitEvent(phase as InitPhase, message, error);
    });
  }
  return mod;
}

const PREFERRED_BACKEND_KEY = 'forge:preferred-backend';

/**
 * Persist a backend preference that survives page reload.
 * Pass 'webgpu' to force WebGPU, or 'webgl2' to force WebGL2.
 * To clear the preference (revert to auto-detection), call
 * `localStorage.removeItem('forge:preferred-backend')` directly.
 */
export function setPreferredBackend(backend: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PREFERRED_BACKEND_KEY, backend);
  }
}

let loadAbortController: AbortController | null = null;
/** Actual rendering backend chosen by loadWasm (not just capability detection). */
let resolvedBackend: 'webgpu' | 'webgl2' = 'webgl2';

async function loadWasm(): Promise<WasmModule> {
  // Skip WASM loading when engine is explicitly disabled (CI E2E @ui tests)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).__SKIP_ENGINE) {
    setLoadingState({ phase: 'error', error: 'Engine loading skipped' });
    throw new Error('Engine loading skipped (__SKIP_ENGINE is set)');
  }
  if (wasmModule) return wasmModule;
  if (initPromise) return initPromise;

  // Intercept WASM panics before loading
  installPanicInterceptor();

  loadAbortController = new AbortController();
  const { signal } = loadAbortController;

  const attempt = (async () => {
    // Phase 1: Detect GPU capability
    setLoadingState({ phase: 'detecting', progress: 0 });

    // Check for a user-set backend preference (e.g. from the WebGL2 fallback button)
    const preferredBackend =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PREFERRED_BACKEND_KEY)
        : null;

    const useWebGPU =
      preferredBackend === 'webgl2' ? false : await probeWebGPU();
    const backend = useWebGPU ? 'webgpu' : 'webgl2';
    resolvedBackend = backend;

    setLoadingState({ phase: 'detecting', progress: 100 });

    // Phase 2: Download WASM module
    setLoadingState({ phase: 'downloading', progress: 0 });
    emitEvent('wasm_loading', `Fetching WASM module (${backend})...`);

    const basePath = `${ENGINE_CDN_ROOT}/engine-pkg-${backend}/`;
    const jsFile = 'forge_engine.js';
    const wasmFile = 'forge_engine_bg.wasm';

    try {
      setLoadingState({ phase: 'downloading', progress: 0 });
      wasmModule = await loadWasmFromPath(basePath, jsFile, wasmFile, signal, (pct) => {
        setLoadingState({ phase: 'downloading', progress: pct });
      });
      setLoadingState({ phase: 'downloading', progress: 100 });
      emitEvent('wasm_loaded', `WASM JS module loaded (${backend}), initializing...`);

      // Phase 3: Initializing (will transition to 'ready' in useEngine hook)
      setLoadingState({ phase: 'initializing', progress: 0 });
      return wasmModule;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // If WebGPU failed, try falling back to WebGL2
      if (useWebGPU) {
        emitEvent('wasm_loading', 'WebGPU load failed, falling back to WebGL2...');
        setLoadingState({ phase: 'downloading', progress: 0 });
        const fallbackPath = `${ENGINE_CDN_ROOT}/engine-pkg-webgl2/`;
        try {
          wasmModule = await loadWasmFromPath(fallbackPath, jsFile, wasmFile, signal, (pct) => {
            setLoadingState({ phase: 'downloading', progress: pct });
          });
          resolvedBackend = 'webgl2';
          setLoadingState({ phase: 'initializing', progress: 0 });
          return wasmModule;
        } catch (fallbackErr) {
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          emitEvent('error', 'Failed to load both WebGPU and WebGL2 WASM modules', fallbackMsg);
          setLoadingState({ phase: 'error', error: fallbackMsg });
          // Reset so the next mount can try again (PF-585)
          initPromise = null;
          throw fallbackErr;
        }
      }

      emitEvent('error', 'Failed to load WASM module', errorMsg);
      setLoadingState({ phase: 'error', error: errorMsg });
      // Reset so the next mount can try again (PF-585)
      initPromise = null;
      throw err;
    }
  })();

  initPromise = attempt;
  return initPromise;
}

// Reset for retry
export function resetEngine(): void {
  if (loadAbortController) {
    loadAbortController.abort();
    loadAbortController = null;
  }
  wasmModule = null;
  initPromise = null;
  setLoadingState({ phase: 'idle' });
  clearEngineCrash();
}

/**
 * Attempt to recover the WASM engine after a panic without a full page reload.
 *
 * 1. Resets the WASM module
 * 2. Reloads the WASM binary
 * 3. Re-initializes the engine on the existing canvas
 *
 * The Zustand editor store persists in memory, so React components retain
 * scene graph, selection, etc. Components that depend on engine state
 * re-sync via their effects after re-initialization.
 *
 * Returns true if recovery succeeded, false if it failed (caller should
 * fall back to a full page reload).
 */
export async function recoverEngine(canvasId: string): Promise<boolean> {
  try {
    addBreadcrumb({
      category: 'engine',
      message: 'WASM engine recovery attempted',
      level: 'info',
      data: { canvasId },
    });

    // Step 1: Reset module state
    resetEngine();

    // Step 2: Reload WASM
    setLoadingState({ phase: 'downloading', progress: 0 });
    const wasm = await loadWasm();

    // Step 3: Re-initialize on existing canvas
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      setLoadingState({ phase: 'error', error: 'Canvas not found during recovery' });
      return false;
    }

    setLoadingState({ phase: 'initializing', progress: 0 });
    wasm.init_engine(canvasId);

    // Guard: if a new crash occurred during async recovery (e.g. the fresh
    // module panicked immediately), do not dismiss the crash overlay.
    if (_engineCrashed) {
      setLoadingState({ phase: 'error', error: 'Engine crashed again during recovery' });
      return false;
    }

    setLoadingState({ phase: 'ready', progress: 100 });

    // Signal recovery so useEngine hooks can re-trigger onReady
    signalRecoveryComplete();

    return true;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      source: 'recoverEngine',
      phase: 'recovery_failed',
    });
    setLoadingState({ phase: 'error', error: 'Recovery failed — please reload the page' });
    return false;
  }
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

    let cancelled = false;

    loadWasm()
      .then((wasm) => {
        if (cancelled) return;
        emitEvent('engine_starting', `Calling init_engine("${canvasId}")`);

        // Set Sentry context for all subsequent errors in this session
        setTag('engine.backend', resolvedBackend);
        setTag('engine.canvas', canvasId);

        try {
          wasm.init_engine(canvasId);
          // Note: For Bevy on WASM, init_engine may not return immediately
          // The 'ready' event will be emitted from Rust when first frame renders
          setIsReady(true);
          setLoadingState({ phase: 'ready', progress: 100 });
          // Expose readiness flag for E2E tests (Playwright)
          if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__FORGE_ENGINE_READY = true;
          }
          // Track editor session start (non-critical analytics)
          import('@/lib/analytics/posthog').then(({ trackEvent, AnalyticsEvent }) => {
            trackEvent(AnalyticsEvent.EDITOR_SESSION_STARTED, {
              backend: resolvedBackend,
            });
          }).catch(() => { /* analytics non-critical */ });
          onReadyRef.current?.();
        } catch (err) {
          const engineError = err instanceof Error ? err : new Error(String(err));
          emitEvent('error', 'Engine initialization failed', engineError.message);
          setLoadingState({ phase: 'error', error: engineError.message });
          captureException(engineError, {
            phase: 'init_engine',
            canvasId,
            backend: resolvedBackend,
          });
          setError(engineError);
          onErrorRef.current?.(engineError);
          initializedRef.current = false;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const loadError = err instanceof Error ? err : new Error(String(err));
        // AbortError is raised when the user navigates away mid-load. It is not
        // a real failure — suppress the error toast and Sentry capture. (#7689)
        if (loadError.name === 'AbortError') {
          initializedRef.current = false;
          return;
        }
        captureException(loadError, {
          phase: 'wasm_load',
          backend: resolvedBackend,
          cdnBase: ENGINE_CDN_ROOT || '(same-origin)',
          engineVersion: ENGINE_VERSION || 'latest',
        });
        if (!loadError.message.includes('__SKIP_ENGINE')) {
          showError('Engine failed to load. Please refresh the page.');
        }
        setError(loadError);
        onErrorRef.current?.(loadError);
        initializedRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [canvasId]);

  // Re-trigger onReady after successful engine recovery (recoverEngine bypasses
  // the initialization effect above, so the hook must listen for recovery separately)
  useEffect(() => {
    return onEngineRecovered(() => {
      setIsReady(true);
      setError(null);
      onReadyRef.current?.();
    });
  }, []);

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
          payload: typeof payload === 'object' ? (() => { try { return JSON.stringify(payload).slice(0, 500); } catch { return '[unserializable]'; } })() : String(payload),
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
