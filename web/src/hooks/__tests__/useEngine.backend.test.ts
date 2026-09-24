// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/initLog', () => ({ logInitEvent: vi.fn() }));
vi.mock('@/hooks/useEngineStatus', () => ({ emitStatusEvent: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn(), setTag: vi.fn() }));
vi.mock('@/lib/monitoring/cdnAnalytics', () => ({ fetchWasmWithMetrics: vi.fn(async () => new Response()) }));
vi.mock('@/lib/analytics/posthog', () => ({ trackEvent: vi.fn(), AnalyticsEvent: { EDITOR_SESSION_STARTED: 'editor_session_started' } }));

const gpuInit = vi.fn();
const glInit = vi.fn();
const gpuDownload = vi.fn(async () => {});
const glDownload = vi.fn(async () => {});
let engine: typeof import('../useEngine');
let stability: typeof import('@/lib/perf/captureStability');

beforeAll(async () => {
  vi.resetModules();
  // Point the real computed import at resolvable test files. Only WASM exports
  // are mocked: backend selection, fallback, readiness and the getter are real.
  vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', '/src/hooks/__tests__/fixtures');
  vi.stubEnv('NEXT_PUBLIC_ENGINE_VERSION', '');
  vi.doMock('/src/hooks/__tests__/fixtures/latest/engine-pkg-webgpu/forge_engine.js', () => ({
    default: gpuDownload, init_engine: gpuInit, set_init_callback: vi.fn(),
    set_event_callback: vi.fn(), handle_command: vi.fn(), handle_command_batch: vi.fn(),
  }));
  vi.doMock('/src/hooks/__tests__/fixtures/latest/engine-pkg-webgl2/forge_engine.js', () => ({
    default: glDownload, init_engine: glInit, set_init_callback: vi.fn(),
    set_event_callback: vi.fn(), handle_command: vi.fn(), handle_command_batch: vi.fn(),
  }));
  engine = await import('../useEngine');
  stability = await import('@/lib/perf/captureStability');
});

beforeEach(() => {
  engine.resetEngine();
  vi.clearAllMocks();
  gpuDownload.mockResolvedValue(undefined);
  glDownload.mockResolvedValue(undefined);
  localStorage.removeItem('forge:preferred-backend');
  delete window.__SKIP_ENGINE;
  const canvas = document.createElement('canvas');
  canvas.id = 'forge-canvas';
  document.body.append(canvas);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  vi.stubGlobal('navigator', {
    gpu: { requestAdapter: vi.fn(async () => ({ requestDevice: async () => ({ destroy: vi.fn() }) })) },
  });
});

afterEach(() => {
  cleanup();
  engine.resetEngine();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('/src/hooks/__tests__/fixtures/latest/engine-pkg-webgpu/forge_engine.js');
  vi.doUnmock('/src/hooks/__tests__/fixtures/latest/engine-pkg-webgl2/forge_engine.js');
});

describe('actual engine backend reporting', () => {
  it('reports WebGPU only after that module initializes', async () => {
    expect(engine.getActiveEngineBackend()).toBe('unknown');
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(gpuInit).toHaveBeenCalledWith('forge-canvas');
    expect(glInit).not.toHaveBeenCalled();
    expect(engine.getActiveEngineBackend()).toBe('webgpu');
  });

  it('reports WebGL2 after WebGPU loading fails despite a successful adapter probe', async () => {
    gpuDownload.mockRejectedValue(new Error('WebGPU module failed'));
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(gpuDownload).toHaveBeenCalled();
    expect(gpuInit).not.toHaveBeenCalled();
    expect(glInit).toHaveBeenCalledWith('forge-canvas');
    expect(engine.getActiveEngineBackend()).toBe('webgl2');
  });

  it('returns unknown after a ready engine crashes and after reset', async () => {
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(engine.getActiveEngineBackend()).toBe('webgpu');
    const changed = vi.fn();
    const unsubscribe = stability.onCaptureWorkloadChange(changed);
    const crash = new Event('unhandledrejection');
    Object.defineProperty(crash, 'reason', { value: new WebAssembly.RuntimeError('unreachable') });
    await act(async () => { window.dispatchEvent(crash); });
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(engine.isEngineCrashed()).toBe(true);
    expect(engine.getActiveEngineBackend()).toBe('unknown');
    engine.resetEngine();
    expect(engine.isEngineCrashed()).toBe(false);
    expect(engine.getActiveEngineBackend()).toBe('unknown');
  });

  it('clears a previously ready backend on reset without a crash', async () => {
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(engine.getActiveEngineBackend()).toBe('webgpu');
    const changed = vi.fn();
    const unsubscribe = stability.onCaptureWorkloadChange(changed);
    engine.resetEngine();
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(engine.getActiveEngineBackend()).toBe('unknown');
  });
});

describe('performance-capture readiness and memory (#10013)', () => {
  beforeEach(() => {
    performance.clearMarks(engine.ENGINE_READY_MARK);
  });

  it('marks the first engine ready on the performance timeline', async () => {
    expect(engine.getEngineReadyMs()).toBe('unknown');
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const readyMs = engine.getEngineReadyMs();
    expect(typeof readyMs).toBe('number');
    expect(readyMs as number).toBeGreaterThanOrEqual(0);
    expect(performance.getEntriesByName(engine.ENGINE_READY_MARK, 'mark')).toHaveLength(1);
  });

  it('keeps the wasm-bindgen memory from the init output, and forgets it on reset', async () => {
    const memory = { buffer: { byteLength: 64 * 1024 * 1024 } };
    gpuDownload.mockResolvedValue({ memory } as never);
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(engine.getEngineWasmMemory()).toBe(memory);
    act(() => engine.resetEngine());
    expect(engine.getEngineWasmMemory()).toBeNull();
  });

  it('reports no memory when the init output carries none', async () => {
    const { result } = renderHook(() => engine.useEngine('forge-canvas'));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(engine.getEngineWasmMemory()).toBeNull();
  });
});
