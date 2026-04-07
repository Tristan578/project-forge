// @vitest-environment jsdom
/**
 * PF-375: Error scenario tests for the export pipeline.
 *
 * Covers:
 *  - exportGame with missing / null scene data (engine event never fires,
 *    store falls back to buildSceneFromStore)
 *  - exportGame with an empty entity list (no nodes in sceneGraph)
 *  - downloadBlob with a zero-byte blob
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob } from '../exportEngine';

// ── Hoist mock references ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const saveScene = vi.fn();
  const getState = vi.fn();
  return { saveScene, getState };
});

// ── Module-level mocks ───────────────────────────────────────────────────────

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: mocks.getState,
  },
}));

// uiBuilderStore is require()'d dynamically inside exportEngine — mock it so
// the require() in the module under test never throws.
vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: {
    getState: () => ({
      serialize: () => ({ screens: [] }),
    }),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStoreState(overrides: Record<string, unknown> = {}) {
  return {
    allScripts: {},
    mobileTouchConfig: null,
    sceneName: 'Test Scene',
    sceneGraph: { nodes: {}, rootIds: [] },
    saveScene: mocks.saveScene,
    ambientLight: { color: [1, 1, 1], brightness: 300 },
    environment: {},
    primaryMaterial: null,
    primaryPhysics: null,
    physicsEnabled: false,
    ...overrides,
  };
}

/** Mock fetch that returns minimal WASM data so single-HTML export succeeds. */
function mockFetchWithWasm() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('forge_engine.js')) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('// wasm glue') });
    }
    if (typeof url === 'string' && url.includes('forge_engine_bg.wasm')) {
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: false });
  });
}

// Simulate the forge:scene-exported event being dispatched after saveScene().
// Must be called while fake timers are active; caller advances time via
// vi.advanceTimersByTimeAsync. The setTimeout here is intentional — it is
// scheduled through vi's fake timer infrastructure, not a real sleep.
function scheduleSceneExportedEvent(detail: unknown, delayMs = 50) {
  // eslint-disable-next-line no-restricted-syntax
  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('forge:scene-exported', { detail })
    );
  }, delayMs);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('exportGame: missing scene data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch to return minimal WASM data so single-HTML export succeeds.
    // These tests focus on scene data fallback, not WASM inlining.
    mockFetchWithWasm();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to store state when scene-exported event has null json', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(
      makeStoreState({ sceneName: 'Fallback Scene' })
    );

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'Test Game',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    });

    // Dispatch a bad event (no .detail.json) so the try/catch inside the
    // handler resolves via buildSceneFromStore — this still produces valid output
    // because the fallback runs before the 5 s timeout fires.
    scheduleSceneExportedEvent({ json: null }, 50);
    await vi.advanceTimersByTimeAsync(100);

    const blob = await exportPromise;

    // Should still produce a Blob even when scene data is malformed.
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('rejects when engine never fires the export event (timeout)', async () => {
    // saveScene is a no-op — the timeout fires after 5 s and rejects
    // with a clear error rather than producing an unplayable shell (#8185).
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(
      makeStoreState({ sceneName: 'No Event Scene' })
    );

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'Timeout Test',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#111111',
      includeDebug: false,
    }).catch((e: Error) => e);

    // Advance past the 5000 ms timeout inside getSceneData.
    await vi.advanceTimersByTimeAsync(5500);

    const result = await exportPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Engine did not respond');

    vi.useRealTimers();
  });

  it('rejects with descriptive error on timeout (not silent failure)', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(
      makeStoreState({ sceneName: 'My Custom Game Name' })
    );

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'My Custom Game Name',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    }).catch((e: Error) => e);

    await vi.advanceTimersByTimeAsync(5500);
    const result = await exportPromise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('5 seconds');
    expect((result as Error).message).toContain('engine is loaded');

    vi.useRealTimers();
  });
});

describe('exportGame: empty entity list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetch to return minimal WASM data so single-HTML export succeeds.
    mockFetchWithWasm();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a valid Blob when sceneGraph has no nodes (event fires)', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(
      makeStoreState({
        sceneName: 'Empty Scene',
        sceneGraph: { nodes: {}, rootIds: [] },
      })
    );

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'Empty Game',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    });

    // Dispatch a valid scene-exported event with empty entities
    scheduleSceneExportedEvent({ json: JSON.stringify({ name: 'Empty Scene', entities: [] }) }, 50);
    await vi.advanceTimersByTimeAsync(100);

    const blob = await exportPromise;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('text/html');

    vi.useRealTimers();
  });

  it('does not throw when allScripts is empty (event fires)', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(
      makeStoreState({ allScripts: {} })
    );

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'No Scripts',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    });

    scheduleSceneExportedEvent({ json: JSON.stringify({ name: 'No Scripts', entities: [] }) }, 50);
    await vi.advanceTimersByTimeAsync(100);

    await expect(exportPromise).resolves.toBeInstanceOf(Blob);

    vi.useRealTimers();
  });

  it('generates HTML that includes the game-canvas element (event fires)', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(makeStoreState());

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'Canvas Check',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    });

    scheduleSceneExportedEvent({ json: JSON.stringify({ name: 'Canvas Check', entities: [] }) }, 50);
    await vi.advanceTimersByTimeAsync(100);

    const blob = await exportPromise;
    const html = await blob.text();

    expect(html).toContain('game-canvas');

    vi.useRealTimers();
  });
});

describe('exportGame: WASM fetch failure (#8186)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // All WASM fetches fail — simulates CDN down or engine not built
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with WASM-unavailable error when fetch returns empty', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(makeStoreState({ sceneName: 'WASM Fail Scene' }));

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: 'WASM Fail',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    }).catch((e: Error) => e);

    // Dispatch valid scene data so getSceneData resolves
    scheduleSceneExportedEvent({ json: JSON.stringify({ name: 'WASM Fail Scene', entities: [] }) }, 50);
    await vi.advanceTimersByTimeAsync(100);

    const result = await exportPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('Failed to fetch WASM engine files');

    vi.useRealTimers();
  });
});

describe('exportGame: AbortSignal cancellation (#8266)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWithWasm();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with AbortError when signal is already aborted', async () => {
    mocks.getState.mockReturnValue(makeStoreState());

    const { exportGame } = await import('../exportEngine');

    const controller = new AbortController();
    controller.abort();

    const result = await exportGame({
      title: 'Abort Test',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
      signal: controller.signal,
    }).catch((e: Error) => e);

    expect(result).toBeInstanceOf(DOMException);
    expect((result as DOMException).name).toBe('AbortError');
  });

  it('rejects with AbortError when aborted during getSceneData', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(makeStoreState());

    const { exportGame } = await import('../exportEngine');

    const controller = new AbortController();

    const exportPromise = exportGame({
      title: 'Abort During Scene',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
      signal: controller.signal,
    }).catch((e: Error) => e);

    // Abort after 100ms (before the 5s timeout, before scene event fires)
    // eslint-disable-next-line no-restricted-syntax
    setTimeout(() => controller.abort(), 100);
    await vi.advanceTimersByTimeAsync(200);

    const result = await exportPromise;
    expect(result).toBeInstanceOf(DOMException);
    expect((result as DOMException).name).toBe('AbortError');

    vi.useRealTimers();
  });

  it('passes signal to fetch calls for WASM inlining', async () => {
    vi.useFakeTimers();

    mocks.getState.mockReturnValue(makeStoreState());

    const { exportGame } = await import('../exportEngine');

    const controller = new AbortController();

    const exportPromise = exportGame({
      title: 'Signal to Fetch',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
      signal: controller.signal,
    });

    // Let scene data resolve so we reach the WASM fetch stage
    scheduleSceneExportedEvent({ json: JSON.stringify({ name: 'Test', entities: [] }) }, 50);
    await vi.advanceTimersByTimeAsync(100);

    const blob = await exportPromise;
    expect(blob).toBeInstanceOf(Blob);

    // Verify fetch was called with signal option
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const hasSignal = fetchCalls.some((call: unknown[]) => {
      const opts = call[1] as { signal?: AbortSignal } | undefined;
      return opts?.signal === controller.signal;
    });
    expect(hasSignal).toBe(true);

    vi.useRealTimers();
  });
});

describe('downloadBlob: zero-byte blob', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let appendChildSpy: ReturnType<typeof vi.fn>;
  let removeChildSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:zero-url');
    revokeObjectURLSpy = vi.fn();
    global.URL.createObjectURL = createObjectURLSpy as unknown as (obj: Blob | MediaSource) => string;
    global.URL.revokeObjectURL = revokeObjectURLSpy as unknown as (url: string) => void;

    appendChildSpy = vi.spyOn(document.body, 'appendChild') as ReturnType<typeof vi.fn>;
    removeChildSpy = vi.spyOn(document.body, 'removeChild') as ReturnType<typeof vi.fn>;

    clickSpy = vi.fn();
    HTMLAnchorElement.prototype.click = clickSpy as unknown as () => void;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw for a zero-byte blob', () => {
    const zeroBlob = new Blob([], { type: 'text/html' });
    expect(() => downloadBlob(zeroBlob, 'empty.html')).not.toThrow();
  });

  it('creates an object URL even for a zero-byte blob', () => {
    const zeroBlob = new Blob([], { type: 'application/zip' });
    downloadBlob(zeroBlob, 'empty.zip');
    expect(createObjectURLSpy).toHaveBeenCalledWith(zeroBlob);
  });

  it('triggers click and revokes URL for a zero-byte blob', () => {
    const zeroBlob = new Blob([], { type: 'text/plain' });
    downloadBlob(zeroBlob, 'empty.txt');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:zero-url');
  });

  it('sets the correct download filename for a zero-byte blob', () => {
    const zeroBlob = new Blob([], { type: 'text/html' });
    downloadBlob(zeroBlob, 'zero-game.html');
    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe('zero-game.html');
  });

  it('cleans up (removeChild) after click even for zero-byte blob', () => {
    const zeroBlob = new Blob([], { type: 'text/html' });
    downloadBlob(zeroBlob, 'zero.html');
    expect(removeChildSpy).toHaveBeenCalledTimes(1);
    const added = appendChildSpy.mock.calls[0][0];
    const removed = removeChildSpy.mock.calls[0][0];
    expect(added).toBe(removed);
  });
});