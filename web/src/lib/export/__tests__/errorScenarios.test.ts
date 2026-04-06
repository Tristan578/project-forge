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
    // handler resolves via buildSceneFromStore, then advance past the 2 s timeout.
    scheduleSceneExportedEvent({ json: null }, 50);
    await vi.advanceTimersByTimeAsync(2500);

    const blob = await exportPromise;

    // Should still produce a Blob even when scene data is malformed.
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('falls back to buildSceneFromStore when engine never fires the export event (timeout)', async () => {
    // saveScene is a no-op — the timeout fallback fires after 2 s.
    // We use a fake timer to accelerate the test.
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
    });

    // Advance past the 2000 ms timeout inside getSceneData.
    await vi.advanceTimersByTimeAsync(2500);

    const blob = await exportPromise;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('uses sceneName from store in fallback scene data', async () => {
    vi.useFakeTimers();

    const customName = 'My Custom Game Name';
    mocks.getState.mockReturnValue(
      makeStoreState({ sceneName: customName })
    );

    const { exportGame } = await import('../exportEngine');

    const exportPromise = exportGame({
      title: customName,
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    });

    await vi.advanceTimersByTimeAsync(2500);
    const blob = await exportPromise;

    const html = await blob.text();
    expect(html).toContain(customName);

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

  it('produces a valid Blob when sceneGraph has no nodes', async () => {
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

    await vi.advanceTimersByTimeAsync(2500);
    const blob = await exportPromise;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('text/html');

    vi.useRealTimers();
  });

  it('does not throw when allScripts is empty', async () => {
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

    await vi.advanceTimersByTimeAsync(2500);
    await expect(exportPromise).resolves.toBeInstanceOf(Blob);

    vi.useRealTimers();
  });

  it('generates HTML that includes the game-canvas element', async () => {
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

    await vi.advanceTimersByTimeAsync(2500);
    const blob = await exportPromise;
    const html = await blob.text();

    expect(html).toContain('game-canvas');

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