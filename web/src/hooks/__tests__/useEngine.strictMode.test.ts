// @vitest-environment jsdom
/**
 * Initialization ownership under effect replay (#10208).
 *
 * React StrictMode (Next.js development) runs every effect as
 * setup → cleanup → setup. `useEngine` used to set a boolean "initialized"
 * ref BEFORE the asynchronous WASM load, and its cleanup only flipped a
 * `cancelled` flag: the replayed setup saw the ref and returned, the first
 * continuation saw `cancelled` and returned, and `init_engine` never ran.
 * The viewport stayed on "Starting engine..." in development while the same
 * build booted in production.
 *
 * Same harness as `useEngine.backend.test.ts`: the real computed import is
 * pointed at fixture modules, and the WASM download is a promise these tests
 * hold open so the load resolves only after the effect has been replayed.
 *
 * Replay comes from Testing Library's `reactStrictMode` option, NOT from a
 * `<StrictMode>` wrapper: measured here, a wrapper around `renderHook`'s
 * host component runs the hook's effect ONCE (setups=1, teardowns=0), while
 * the option runs it twice (setups=2). A wrapper-based version of this suite
 * passed against the unfixed hook.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, renderHook, waitFor } from '@testing-library/react';

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

/** A download the test releases by hand, so the load settles when we say. */
function heldDownload() {
  let release!: () => void;
  let fail!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
  return { gate, release, fail };
}

function addCanvas(id: string) {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  document.body.append(canvas);
}

beforeAll(async () => {
  configure({ reactStrictMode: true });
  vi.resetModules();
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
});

beforeEach(() => {
  engine.resetEngine();
  vi.clearAllMocks();
  gpuDownload.mockResolvedValue(undefined);
  glDownload.mockResolvedValue(undefined);
  localStorage.removeItem('forge:preferred-backend');
  delete window.__SKIP_ENGINE;
  addCanvas('forge-canvas');
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
  configure({ reactStrictMode: false });
  vi.unstubAllEnvs();
  vi.doUnmock('/src/hooks/__tests__/fixtures/latest/engine-pkg-webgpu/forge_engine.js');
  vi.doUnmock('/src/hooks/__tests__/fixtures/latest/engine-pkg-webgl2/forge_engine.js');
});

describe('useEngine initialization ownership (#10208)', () => {
  it('initializes exactly once when StrictMode replays the effect while the load is pending', async () => {
    const held = heldDownload();
    gpuDownload.mockImplementation(() => held.gate);
    const onReady = vi.fn();

    const { result } = renderHook(() => engine.useEngine('forge-canvas', { onReady }));
    // Setup, cleanup and the replayed setup have all run; the module has not
    // arrived, so nothing may have started yet.
    expect(gpuInit).not.toHaveBeenCalled();

    await act(async () => { held.release(); });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(gpuInit).toHaveBeenCalledTimes(1);
    expect(gpuInit).toHaveBeenCalledWith('forge-canvas');
    expect(onReady).toHaveBeenCalledTimes(1);
    // The replay reused the one in-flight load rather than starting a second.
    expect(gpuDownload).toHaveBeenCalledTimes(1);
  });

  it('does not initialize a canvas whose hook unmounted while the load was pending', async () => {
    const held = heldDownload();
    gpuDownload.mockImplementation(() => held.gate);
    const onReady = vi.fn();

    const { unmount } = renderHook(() => engine.useEngine('forge-canvas', { onReady }));
    unmount();
    await act(async () => { held.release(); });
    // Let the continuation run to completion.
    await act(async () => { await Promise.resolve(); });

    expect(gpuInit).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('initializes the canvas the hook currently targets when the id changes mid-load', async () => {
    const held = heldDownload();
    gpuDownload.mockImplementation(() => held.gate);
    addCanvas('second-canvas');

    const { result, rerender } = renderHook(({ id }) => engine.useEngine(id), {
      initialProps: { id: 'forge-canvas' },
    });
    rerender({ id: 'second-canvas' });
    await act(async () => { held.release(); });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(gpuInit).toHaveBeenCalledTimes(1);
    expect(gpuInit).toHaveBeenCalledWith('second-canvas');
  });

  it('never starts a second attempt once Bevy owns a canvas', async () => {
    addCanvas('second-canvas');
    const { result, rerender } = renderHook(({ id }) => engine.useEngine(id), {
      initialProps: { id: 'forge-canvas' },
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(gpuInit).toHaveBeenCalledTimes(1);

    // A canvas change after init_engine cannot move a live Bevy app; the
    // attempt that started owns it and the effect must not re-enter.
    rerender({ id: 'second-canvas' });
    await act(async () => { await Promise.resolve(); });

    expect(gpuInit).toHaveBeenCalledTimes(1);
    expect(glInit).not.toHaveBeenCalled();
  });

  it('recovers ownership after a rejected attempt so a later run can initialize', async () => {
    const onError = vi.fn();
    gpuDownload.mockRejectedValue(new Error('WebGPU module failed'));
    glDownload.mockRejectedValue(new Error('WebGL2 module failed'));
    addCanvas('second-canvas');

    const { result, rerender } = renderHook(({ id }) => engine.useEngine(id, { onError }), {
      initialProps: { id: 'forge-canvas' },
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(gpuInit).not.toHaveBeenCalled();

    // The failed load is cleared the way the retry button does it, then a new
    // effect run (a new canvas) must be able to start one clean attempt.
    engine.resetEngine();
    gpuDownload.mockResolvedValue(undefined);
    rerender({ id: 'second-canvas' });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(gpuInit).toHaveBeenCalledTimes(1);
    expect(gpuInit).toHaveBeenCalledWith('second-canvas');
  });
});
