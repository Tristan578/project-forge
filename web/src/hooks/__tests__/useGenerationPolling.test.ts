/**
 * Tests for useGenerationPolling hook — poll lifecycle, completion handling,
 * failure with refund, timeout after max polls, and cleanup.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateJob = vi.fn();
const mockJobs: Record<string, Record<string, unknown>> = {};
const {
  mockFetchBalance,
  mockShowSuccess,
  mockShowPersistentError,
  mockEnqueueFailedRefund,
  mockProcessFailedRefunds,
} = vi.hoisted(() => ({
  mockFetchBalance: vi.fn<() => Promise<void>>(),
  mockShowSuccess: vi.fn(),
  mockShowPersistentError: vi.fn(),
  mockEnqueueFailedRefund: vi.fn(),
  mockProcessFailedRefunds: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      // Real Zustand hands the selector a fresh `jobs` object on every store
      // update, which is what makes the hook's `[jobs]` effect re-run. Returning
      // the mutable `mockJobs` map by reference froze those deps, so no test
      // could exercise a state transition after mount. Snapshot it per read.
      selector({ jobs: { ...mockJobs }, updateJob: mockUpdateJob }),
    {
      getState: () => ({ jobs: mockJobs }),
    },
  ),
}));

const mockImportGltf = vi.fn();
const mockLoadTexture = vi.fn();
const mockSetCustomSkybox = vi.fn();
const mockImportAudio = vi.fn();
const mockSetAudio = vi.fn();
const mockSetSpriteSheet = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      importGltf: mockImportGltf,
      loadTexture: mockLoadTexture,
      setCustomSkybox: mockSetCustomSkybox,
      importAudio: mockImportAudio,
      setAudio: mockSetAudio,
      setSpriteSheet: mockSetSpriteSheet,
    }),
  },
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: {
    getState: () => ({ fetchBalance: mockFetchBalance }),
  },
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: mockShowSuccess,
  showPersistentError: mockShowPersistentError,
  showInfo: vi.fn(),
}));

vi.mock('@/lib/utils/refundQueue', () => ({
  enqueueFailedRefund: mockEnqueueFailedRefund,
  processFailedRefunds: mockProcessFailedRefunds,
}));

vi.mock('@/lib/generate/postProcess', () => ({
  postProcess: vi.fn(() => ({
    warnings: [],
    metadata: { assetName: 'TestAsset' },
  })),
  inferSfxCategory: vi.fn(() => 'impact'),
}));

vi.mock('@/lib/generate/modelQuality', () => ({
  analyzeModelQuality: vi.fn(() => ({
    validFormat: true,
    fileSize: 1024,
    sizeCategory: 'small',
    estimatedTriangles: 500,
    polyBudget: 'low',
    primitiveCount: 1,
    materialCount: 1,
    warnings: [],
  })),
}));

vi.mock('@/lib/sprites/sheetImporter', () => ({
  detectGridDimensions: vi.fn((_w: number, _h: number) => ({
    columns: 4,
    rows: 1,
    frameWidth: 64,
    frameHeight: 64,
  })),
  sliceSheet: vi.fn((_w: number, _h: number, _rows: number, _cols: number) => [
    { index: 0, x: 0, y: 0, width: 64, height: 64 },
    { index: 1, x: 64, y: 0, width: 64, height: 64 },
    { index: 2, x: 128, y: 0, width: 64, height: 64 },
    { index: 3, x: 192, y: 0, width: 64, height: 64 },
  ]),
  buildSpriteSheetData: vi.fn((_assetId: string, _result: unknown, _name: string) => ({
    assetId: 'SpriteSheet_test',
    sliceMode: { type: 'grid', columns: 4, rows: 1, tileSize: [64, 64], padding: [0, 0], offset: [0, 0] },
    frames: [
      { index: 0, x: 0, y: 0, width: 64, height: 64 },
      { index: 1, x: 64, y: 0, width: 64, height: 64 },
      { index: 2, x: 128, y: 0, width: 64, height: 64 },
      { index: 3, x: 192, y: 0, width: 64, height: 64 },
    ],
    clips: { idle: { name: 'idle', frames: [0, 1, 2, 3], frameDurations: { type: 'uniform', duration: 0.1 }, looping: true, pingPong: false } },
  })),
}));

import { useGenerationPolling } from '../useGenerationPolling';
// Imported, not retyped: the guidance sentence is the catalogue's, and a test
// that hardcoded it would pass while the two drifted apart.
import { RETRY_GUIDANCE } from '@/lib/generate/retryGuidance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    jobId: `job-${id}`,
    type: 'model',
    prompt: 'Test prompt',
    status: 'processing',
    progress: 0,
    provider: 'meshy',
    createdAt: Date.now(),
    ...overrides,
  };
}

function mockFetchResponse(data: Record<string, unknown>, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
    blob: () => Promise.resolve(new Blob(['test'], { type: 'application/octet-stream' })),
  });
}

describe('useGenerationPolling', () => {
  const OriginalFileReader = globalThis.FileReader;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetchBalance.mockResolvedValue(undefined);
    mockProcessFailedRefunds.mockResolvedValue(undefined);
    // Clear jobs
    Object.keys(mockJobs).forEach(k => delete mockJobs[k]);
  });

  afterEach(() => {
    globalThis.FileReader = OriginalFileReader;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Basic lifecycle
  // ---------------------------------------------------------------------------
  it('reconciles the token balance after queued refunds are processed on mount', async () => {
    renderHook(() => useGenerationPolling());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockProcessFailedRefunds).toHaveBeenCalledTimes(1);
    expect(mockFetchBalance).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile the token balance when queued-refund processing fails', async () => {
    const error = new Error('queue unavailable');
    mockProcessFailedRefunds.mockRejectedValueOnce(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useGenerationPolling());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetchBalance).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('processFailedRefunds error:', error);
  });

  it('does not poll when no active jobs exist', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderHook(() => useGenerationPolling());

    act(() => { vi.advanceTimersByTime(10_000); });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('starts polling immediately for active jobs', async () => {
    mockJobs['j1'] = makeJob('j1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-j1', status: 'processing', progress: 50 }),
    );

    renderHook(() => useGenerationPolling());

    // First poll is immediate
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/model/status?jobId=job-j1'),
    );
    fetchSpy.mockRestore();
  });

  it('keeps the legacy 3-second cadence for non-durable jobs', async () => {
    mockJobs['legacy'] = makeJob('legacy', { durable: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-legacy', status: 'processing', progress: 10 }),
    );

    const { unmount } = renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_999); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('uses sparse 30-second safety reads for durable jobs', async () => {
    mockJobs['durable'] = makeJob('durable', { durable: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-durable', status: 'processing', progress: 10 }),
    );

    const { unmount } = renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(269_999); });
    expect(fetchSpy).toHaveBeenCalledTimes(10);
    unmount();
  });

  it('rechecks durable jobs when the window regains focus or becomes visible', async () => {
    mockJobs['durable'] = makeJob('durable', { durable: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-durable', status: 'processing', progress: 10 }),
    );
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    const { unmount } = renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    visibilitySpy.mockRestore();
    unmount();
  });

  it('serializes interval and focus reads for the same durable job', async () => {
    mockJobs['durable'] = makeJob('durable', { durable: true });
    let resolveStatus!: (response: Response) => void;
    const pendingStatus = new Promise<Response>((resolve) => { resolveStatus = resolve; });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(pendingStatus);

    const { unmount } = renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStatus(new Response(JSON.stringify({
        jobId: 'job-durable', status: 'processing', progress: 10,
      }), { status: 200 }));
      await pendingStatus;
    });
    unmount();
  });

  it('updates progress on processing response', async () => {
    mockJobs['j1'] = makeJob('j1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-j1', status: 'processing', progress: 75 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockUpdateJob).toHaveBeenCalledWith('j1', {
      status: 'processing',
      progress: 75,
    });
    fetchSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Status endpoint routing
  // ---------------------------------------------------------------------------
  it('routes texture jobs to texture status endpoint', async () => {
    mockJobs['t1'] = makeJob('t1', { type: 'texture' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-t1', status: 'processing', progress: 0 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/texture/status'),
    );
    fetchSpy.mockRestore();
  });

  it('routes skybox jobs to skybox status endpoint', async () => {
    mockJobs['s1'] = makeJob('s1', { type: 'skybox' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-s1', status: 'processing', progress: 0 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/skybox/status'),
    );
    fetchSpy.mockRestore();
  });

  it('routes music jobs to music status endpoint', async () => {
    mockJobs['m1'] = makeJob('m1', { type: 'music' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-m1', status: 'processing', progress: 0 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/music/status'),
    );
    fetchSpy.mockRestore();
  });

  it('routes sprite jobs to sprite status endpoint', async () => {
    mockJobs['sp1'] = makeJob('sp1', { type: 'sprite' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-sp1', status: 'processing', progress: 0 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/sprite/status'),
    );
    fetchSpy.mockRestore();
  });

  it('routes sprite_sheet jobs to sprite-sheet status endpoint', async () => {
    mockJobs['ss1'] = makeJob('ss1', { type: 'sprite_sheet' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-ss1', status: 'processing', progress: 0 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/sprite-sheet/status'),
    );
    fetchSpy.mockRestore();
  });

  it('routes tileset jobs to tileset-gen status endpoint', async () => {
    mockJobs['ts1'] = makeJob('ts1', { type: 'tileset' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-ts1', status: 'processing', progress: 0 }),
    );

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/tileset-gen/status'),
    );
    fetchSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Failure handling
  // ---------------------------------------------------------------------------
  it('marks job as failed and triggers refund on failed status', async () => {
    mockJobs['f1'] = makeJob('f1', { usageId: 'usage-f1' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          jobId: 'job-f1',
          status: 'failed',
          error: 'Provider error',
          progress: 0,
        }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockUpdateJob).toHaveBeenCalledWith('f1', {
      status: 'failed',
      error: 'Provider error',
    });

    // Should trigger refund
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate/refund',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('usage-f1'),
      }),
    );
    expect(mockFetchBalance).toHaveBeenCalledTimes(2); // mount reconciliation + refund
    expect(mockShowSuccess).toHaveBeenCalledOnce();
    expect(mockShowSuccess).toHaveBeenCalledWith('Tokens refunded for the failed generation.');
    fetchSpy.mockRestore();
  });

  it('uses default error message when provider gives none', async () => {
    mockJobs['f2'] = makeJob('f2');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({
        jobId: 'job-f2',
        status: 'failed',
        progress: 0,
      }),
    } as Response));

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockUpdateJob).toHaveBeenCalledWith('f2', {
      status: 'failed',
      error: `Generation failed. ${RETRY_GUIDANCE}`,
    });
  });

  // ---------------------------------------------------------------------------
  // Completion-path failures must still refund (#8757 invariant, client side)
  // ---------------------------------------------------------------------------
  it('refunds and fails a completed texture job whose maps are an empty object', async () => {
    // Defense-in-depth: the status route now maps empty maps to `failed`, but the
    // poller must also reject a truthy-but-empty `{}` rather than silently completing
    // with zero textures applied. A `completed` with `maps: {}` must refund.
    mockJobs['te1'] = makeJob('te1', {
      type: 'texture',
      usageId: 'usage-te1',
      entityId: 'ent-te1',
      autoPlace: true,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          jobId: 'job-te1',
          status: 'completed',
          progress: 100,
          maps: {},
        }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // No textures should have been applied from an empty map set
    expect(mockLoadTexture).not.toHaveBeenCalled();
    // The job must end failed with the missing-maps error...
    expect(mockUpdateJob).toHaveBeenCalledWith('te1', {
      status: 'failed',
      error: 'No texture maps',
    });
    // ...and the user must be refunded (this is the path that used to silently
    // mark completed with no refund).
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate/refund',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('usage-te1'),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('refunds a completed job whose artifact download fails', async () => {
    // A status route can legitimately report `completed` and the artifact URL can
    // still 404/500 at download time. Before, handleCompletion's catch marked the job
    // failed WITHOUT refunding — charging the user for a result they never got. The
    // catch must now refund regardless of which completion step threw.
    mockJobs['dl1'] = makeJob('dl1', {
      type: 'model',
      usageId: 'usage-dl1',
      autoPlace: true,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      if (urlStr.includes('/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-dl1',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/model.glb',
          }),
        } as Response;
      }
      // The artifact download itself fails (e.g. expired signed URL).
      return { ok: false, status: 404 } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // Failed because the download threw...
    expect(mockUpdateJob).toHaveBeenCalledWith('dl1', expect.objectContaining({
      status: 'failed',
    }));
    // ...and refunded so the user is not charged for an undeliverable result.
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate/refund',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('usage-dl1'),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('toasts FIXED text for an internal diagnostic while the store keeps the real one', async () => {
    // `failJob`'s `userFacing: false` branch IS the review finding its docblock
    // says was fixed — 'No result URL', 'No texture maps' and 'Downloaded file
    // is not a valid GLB model' being promoted from a closed-by-default
    // dropdown to the primary user-facing channel. Nothing covered that branch,
    // so a regression that passed `err.message` straight through would have
    // left the suite green (lessons-learned #11).
    const FIXED =
      'That generation could not be finished. Your tokens have been refunded — try again, or pick a different style.';
    mockJobs['dl2'] = makeJob('dl2', { type: 'model', usageId: 'usage-dl2', autoPlace: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('refund')) return new Response('{}', { status: 200 });
      if (urlStr.includes('/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-dl2',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/model.glb',
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // The refund really did succeed here — the job carries a usageId and the
    // refund fetch returns 200 — which is the ONLY case in which this sentence
    // is true. The two cases in which it is NOT are covered immediately below.
    expect(mockShowPersistentError).toHaveBeenCalledWith(FIXED, {
      id: `generation-failed:${FIXED}`,
    });

    // The store still carries the real diagnostic — the dropdown and any bug
    // report show what actually happened...
    const failCall = mockUpdateJob.mock.calls.find(
      (c: unknown[]) => c[0] === 'dl2' && (c[1] as Record<string, unknown>).status === 'failed',
    );
    expect(failCall).toBeDefined();
    const stored = (failCall as unknown[])[1] as { error: string };
    expect(typeof stored.error).toBe('string');
    expect(stored.error.length).toBeGreaterThan(0);
    expect(stored.error).not.toBe(FIXED);
    // ...and it never reached the toast, which is the whole point.
    const toasted = mockShowPersistentError.mock.calls.map((c: unknown[]) => c[0]);
    expect(toasted).not.toContain(stored.error);
    fetchSpy.mockRestore();
  });

  /**
   * THE REFUND PROMISE, on the two paths where it was false.
   *
   * The sentence above was hardcoded, from a call site that runs after
   * `triggerRefund` — which returns without refunding when the job has no
   * `usageId` (BYOK and cache-hit jobs, never charged tokens), and which on
   * failure only queues the refund for a FUTURE session. Both told the user, in
   * an indefinite red toast, that money had already come back. The old test
   * exercised only `usageId: 'usage-dl2'` with the refund returning 200 and
   * pinned the sentence verbatim, so the false promise was locked in as
   * expected behaviour and neither branch was reachable by any assertion.
   */
  const NO_REFUND_CLAIM =
    'That generation could not be finished. Try again, or pick a different style.';

  it('does NOT promise a refund for a job that was never charged tokens (BYOK / cache hit)', async () => {
    // No usageId: `triggerRefund` returns immediately, nothing is refunded, and
    // nothing was charged either.
    mockJobs['byok1'] = makeJob('byok1', { type: 'model', autoPlace: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-byok1',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/model.glb',
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(mockShowPersistentError).toHaveBeenCalledWith(NO_REFUND_CLAIM, {
      id: `generation-failed:${NO_REFUND_CLAIM}`,
    });
    // The claim is absent, not merely different.
    const toasted = mockShowPersistentError.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(toasted.some((t) => t.includes('have been refunded'))).toBe(false);
    // ...and no refund was even attempted, which is why claiming one was wrong.
    expect(fetchSpy).not.toHaveBeenCalledWith('/api/generate/refund', expect.anything());
    fetchSpy.mockRestore();
  });

  it('does NOT promise a refund when the refund API failed and was queued for a later session', async () => {
    mockJobs['rf1'] = makeJob('rf1', { type: 'model', usageId: 'usage-rf1', autoPlace: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('refund')) return { ok: false, status: 500 } as Response;
      if (urlStr.includes('/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-rf1',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/model.glb',
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(mockEnqueueFailedRefund).toHaveBeenCalled();
    expect(mockShowPersistentError).toHaveBeenCalledWith(NO_REFUND_CLAIM, {
      id: `generation-failed:${NO_REFUND_CLAIM}`,
    });
    const toasted = mockShowPersistentError.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(toasted.some((t) => t.includes('have been refunded'))).toBe(false);
    fetchSpy.mockRestore();
  });

  it('dedupes N concurrent failures with the SAME message into one toast id', async () => {
    // The previous id was `generation-failed-${jobId}`, so N concurrent jobs had
    // N DISTINCT keys and still stacked N indefinite red toasts — the exact
    // outcome the id was added to prevent, with a docblock claiming otherwise
    // and a test asserting only the literal key (lessons-learned #11).
    // `toast.ts` states the mechanism: an id collapses failures that produce the
    // same MESSAGE, so the key has to be message-derived.
    mockJobs['b1'] = makeJob('b1', { type: 'model', autoPlace: true });
    mockJobs['b2'] = makeJob('b2', { type: 'model', autoPlace: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-b',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/model.glb',
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const ids = mockShowPersistentError.mock.calls.map(
      (c: unknown[]) => (c[1] as { id?: string } | undefined)?.id,
    );
    // Non-vacuous: both jobs really did fail and really did toast.
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(1);
    fetchSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // triggerRefund :460 guard — pins both sides of `if (!job?.usageId) return`
  // ---------------------------------------------------------------------------
  it('triggers refund with usageId when a job exhausts MAX_POLL_COUNT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-rg1', status: 'processing', progress: 50 }),
      } as Response;
    });

    mockJobs['rg1'] = makeJob('rg1', { usageId: 'usage-rg1' });
    renderHook(() => useGenerationPolling());

    for (let i = 0; i < 101; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate/refund',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('usage-rg1'),
      }),
    );
    expect(mockFetchBalance).toHaveBeenCalledTimes(2); // mount reconciliation + refund
    expect(mockShowSuccess).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it('does not trigger refund when a job without usageId exhausts MAX_POLL_COUNT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: () => Promise.resolve({ jobId: 'job-rg2', status: 'processing', progress: 50 }),
    } as Response));

    mockJobs['rg2'] = makeJob('rg2'); // no usageId
    renderHook(() => useGenerationPolling());

    for (let i = 0; i < 101; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    }

    const refundCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('refund'),
    );
    expect(refundCalls).toHaveLength(0);
    expect(mockShowSuccess).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('queues an exhausted refund without showing a false success confirmation', async () => {
    mockJobs['rf1'] = makeJob('rf1', { usageId: 'usage-rf1' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 500 });
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          jobId: 'job-rf1',
          status: 'failed',
          error: 'Provider error',
          progress: 0,
        }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => {
      // Let the immediate status poll reach the first refund attempt before
      // advancing the backoff clock; otherwise the async poll may not have
      // scheduled its first timer yet when a busy full-suite runner advances.
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/generate/refund',
      expect.objectContaining({ method: 'POST' }),
    );
    await act(async () => {
      // Jitter can stretch the 500 + 1,000 ms backoff to 1,875 ms. Stay below
      // the 3-second polling interval while crossing the true worst case.
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(mockFetchBalance).toHaveBeenCalledTimes(1); // mount reconciliation only
    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(mockEnqueueFailedRefund).toHaveBeenCalledTimes(1);
    expect(mockEnqueueFailedRefund).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'usage-rf1',
    }));
    expect(consoleSpy).toHaveBeenCalledWith(
      'Token refund failed after retries — queuing for next session:',
      expect.any(Error),
    );
  });

  // ---------------------------------------------------------------------------
  // Timeout (max polls)
  // ---------------------------------------------------------------------------
  it('times out after MAX_POLL_COUNT (100) polls', async () => {
    mockJobs['t1'] = makeJob('t1', { usageId: 'usage-t1' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          jobId: 'job-t1',
          status: 'processing',
          progress: 50,
        }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());

    // The legacy loop retains its five-minute overall timeout.
    for (let i = 0; i < 101; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    // The FALLBACK sentence, with a next step attached. This is the common
    // timeout case, not an edge one — `lastStatusErrorRef` is cleared on every
    // successful poll, so an ordinary slow provider that never reaches a
    // terminal state lands here. Before, it produced an indefinite red toast
    // reading 'Generation timed out' and nothing else, which is precisely the
    // defect `retryGuidance.ts` was added in this change to fix.
    const failCall = mockUpdateJob.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown>).error === `Generation timed out. ${RETRY_GUIDANCE}`,
    );
    expect(failCall).toBeDefined();
    expect(mockShowPersistentError).toHaveBeenCalledWith(
      `Generation timed out. ${RETRY_GUIDANCE}`,
      expect.anything(),
    );
  });

  it('attaches the next step to the bare provider-failure fallback too', async () => {
    // The `status: 'failed'` branch with no `error` from the provider. Same
    // reasoning as the timeout fallback: a terminal red toast naming a
    // condition and nothing to do about it.
    mockJobs['gf1'] = makeJob('gf1', { usageId: 'usage-gf1' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: 'job-gf1', status: 'failed' }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(mockShowPersistentError).toHaveBeenCalledWith(
      `Generation failed. ${RETRY_GUIDANCE}`,
      expect.anything(),
    );
    fetchSpy.mockRestore();
  });

  it('surfaces the status route message when the job gives up (#9736)', async () => {
    // The eight status routes were given sentences written for the user, and
    // nobody ever saw one: this poller threw on `!response.ok` before reading
    // the body, so a route returning 500 for five minutes produced a stalled
    // progress bar and then the bare 'Generation timed out'.
    const ROUTE_MESSAGE = 'Could not read the 3D Model generation status. Please try again.';
    mockJobs['t2'] = makeJob('t2', { usageId: 'usage-t2' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: ROUTE_MESSAGE }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());

    for (let i = 0; i < 101; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    const failCall = mockUpdateJob.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).error === ROUTE_MESSAGE,
    );
    expect(failCall).toBeDefined();

    // Writing it to the store is not showing it. `GenerationStatus` renders
    // only while a job is pending/processing/downloading, so marking the last
    // job failed unmounts the sole renderer at the instant the message is
    // written — the sentence reached the store and nobody else. The toast is
    // what makes it arrive.
    // Persistent, not the 4 s default: this is terminal, on a job that ran in
    // the background for up to five minutes, and once the toast expires no
    // surface renders `job.error` at all. Keyed by the MESSAGE, so N concurrent
    // timeouts collapse into one toast — the job id did not, because N jobs
    // produce N distinct keys.
    expect(mockShowPersistentError).toHaveBeenCalledWith(ROUTE_MESSAGE, {
      id: `generation-failed:${ROUTE_MESSAGE}`,
    });
  });

  it('toasts the provider failure reason when the status route reports failed', async () => {
    const PROVIDER_MESSAGE = 'The 3D model provider rejected the prompt.';
    mockJobs['t3'] = makeJob('t3', { usageId: 'usage-t3' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('refund')) {
        return new Response('{}', { status: 200 });
      }
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jobId: 'job-t3', status: 'failed', error: PROVIDER_MESSAGE }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mockShowPersistentError).toHaveBeenCalledWith(PROVIDER_MESSAGE, {
      id: `generation-failed:${PROVIDER_MESSAGE}`,
    });
  });

  // ---------------------------------------------------------------------------
  // Skybox completion — verifies the generated image is forwarded to the engine
  // ---------------------------------------------------------------------------
  it('applies completed skybox to the scene via setCustomSkybox', async () => {
    mockJobs['sky1'] = makeJob('sky1', { type: 'skybox' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/api/generate/skybox/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-sky1',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/skybox.png',
          }),
        } as Response;
      }
      // resultUrl download
      return {
        ok: true,
        blob: () => Promise.resolve(new Blob(['fake-png-data'], { type: 'image/png' })),
      } as Response;
    });

    // Mock FileReader for blobToBase64
    const mockReadAsDataURL = vi.fn();
    const origFileReader = globalThis.FileReader;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).FileReader = class {
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result = 'data:image/png;base64,AAAA';
      readAsDataURL = mockReadAsDataURL.mockImplementation(function (this: { onloadend: (() => void) | null }) {
        if (this.onloadend) this.onloadend();
      });
    };

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Should have called setCustomSkybox with the asset ID and base64 data
    expect(mockSetCustomSkybox).toHaveBeenCalledWith(
      expect.stringContaining('generated_skybox_sky1'),
      'data:image/png;base64,AAAA',
    );

    // Should mark as completed
    expect(mockUpdateJob).toHaveBeenCalledWith('sky1', expect.objectContaining({
      status: 'completed',
      resultUrl: 'https://example.com/skybox.png',
    }));

    fetchSpy.mockRestore();
    globalThis.FileReader = origFileReader;
  });

  // ---------------------------------------------------------------------------
  // HTTP error handling
  // ---------------------------------------------------------------------------
  it('continues polling on HTTP error (non-ok response)', async () => {
    mockJobs['h1'] = makeJob('h1');
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500 } as Response;
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          jobId: 'job-h1', status: 'processing', progress: 25,
        }),
      } as Response;
    });

    renderHook(() => useGenerationPolling());

    // First poll (error)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Second poll (success) after interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mockUpdateJob).toHaveBeenCalledWith('h1', {
      status: 'processing',
      progress: 25,
    });
  });

  // ---------------------------------------------------------------------------
  // Music completion — looping audio entity creation
  // ---------------------------------------------------------------------------
  it('imports audio and sets looping audio on entity when music completes with entityId', async () => {
    vi.useRealTimers();

    mockJobs['m2'] = makeJob('m2', {
      type: 'music',
      entityId: 'ent-music-1',
      prompt: 'epic battle theme',
    });

    const originalFileReader = globalThis.FileReader;
    class MockFileReader {
      result = 'data:audio/mpeg;base64,dGVzdA==';
      onloadend: (() => void) | null = null;
      onerror: ((_e: unknown) => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => { if (this.onloadend) this.onloadend(); });
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.FileReader = MockFileReader as any;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-m2',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/music.mp3',
          }),
        } as Response;
      }
      return {
        ok: true,
        blob: () => Promise.resolve(new Blob(['audio-data'], { type: 'audio/mpeg' })),
      } as Response;
    });

    renderHook(() => useGenerationPolling());

    await vi.waitFor(() => {
      expect(mockImportAudio).toHaveBeenCalledWith(
        'data:audio/mpeg;base64,dGVzdA==',
        expect.any(String),
      );
    });

    expect(mockSetAudio).toHaveBeenCalledWith('ent-music-1', expect.objectContaining({
      loopAudio: true,
      bus: 'music',
      autoplay: true,
      spatial: false,
      volume: 0.7,
    }));

    globalThis.FileReader = originalFileReader;
    vi.useFakeTimers();
  });

  // ---------------------------------------------------------------------------
  // Sprite sheet slicing on completion
  // ---------------------------------------------------------------------------
  it('slices sprite_sheet on completion and calls setSpriteSheet', async () => {
    mockJobs['ss1'] = makeJob('ss1', {
      type: 'sprite_sheet',
      entityId: 'entity-ss1',
      metadata: { frameCount: 4, frameSize: '64' },
    });

    const OriginalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      naturalWidth = 256;
      naturalHeight = 64;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    } as unknown as typeof Image;

    const origCreateObjectURL = globalThis.URL.createObjectURL;
    const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
    const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/api/generate/sprite-sheet/status')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            jobId: 'job-ss1',
            status: 'completed',
            progress: 100,
            resultUrl: 'https://example.com/spritesheet.png',
          }),
        } as Response;
      }
      return {
        ok: true,
        blob: () => Promise.resolve(new Blob(['fake-png'], { type: 'image/png' })),
      } as Response;
    });

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mockLoadTexture).toHaveBeenCalledWith(
      expect.any(String),
      'TestAsset',
      'entity-ss1',
      'base_color',
    );

    expect(mockSetSpriteSheet).toHaveBeenCalledWith(
      'entity-ss1',
      expect.objectContaining({
        assetId: 'SpriteSheet_test',
        frames: expect.arrayContaining([
          expect.objectContaining({ index: 0, x: 0, y: 0 }),
        ]),
      }),
    );

    const completedCall = mockUpdateJob.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed',
    );
    expect(completedCall).toBeDefined();
    const meta = (completedCall![1] as Record<string, Record<string, unknown>>).metadata;
    expect(meta).toHaveProperty('spriteSheet');

    globalThis.Image = OriginalImage;
    globalThis.URL.createObjectURL = origCreateObjectURL;
    globalThis.URL.revokeObjectURL = origRevokeObjectURL;
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  it('stops polling for completed jobs on re-render', async () => {
    mockJobs['c1'] = makeJob('c1', { status: 'completed' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Completed jobs should not be polled
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('resets the timeout clock when a job id is polled again after finishing', async () => {
    // The teardown site that mattered is the poll-RESPONSE one (`completed` /
    // `failed`), not the [jobs] sweep. Those paths deleted the id from timersRef,
    // and the sweep only walks `Object.keys(timersRef.current)` — so whatever they
    // forgot became unreachable for the life of the session. `startedAtRef` was
    // the one being forgotten, and that is observable rather than merely a leak:
    // startPolling seeds from `startedAtRef.current[id] ?? Date.now()`, so a
    // re-queued id inherits the finished run's clock. With more than five minutes
    // elapsed the very first poll trips MAX_POLL_DURATION_MS and the fresh job is
    // failed and refunded before a single status request goes out (#9603).
    //
    // Driving the first run to `failed` (not mutating the store to `completed`)
    // is load-bearing: the sweep always cleared startedAtRef itself, so a test
    // that ends the run through the sweep passes against the unfixed code.
    let statusPayload: Record<string, unknown> = {
      jobId: 'job-reuse',
      status: 'failed',
      error: 'Generation failed',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve(statusPayload),
      }) as unknown as Response,
    );

    // No usageId, so the `failed` branch's triggerRefund returns before its fetch.
    mockJobs['reuse'] = makeJob('reuse', { durable: true });
    const { rerender } = renderHook(() => useGenerationPolling());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockUpdateJob).toHaveBeenCalledWith('reuse', expect.objectContaining({
      status: 'failed',
    }));

    // The store catches up to the terminal status the poll already applied.
    mockJobs['reuse'] = makeJob('reuse', { durable: true, status: 'failed' });
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // More than the five-minute cap passes with the id idle.
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000); });

    statusPayload = { jobId: 'job-reuse', status: 'processing', progress: 10 };
    fetchSpy.mockClear();
    mockUpdateJob.mockClear();

    // Same id is queued again — a brand-new run.
    mockJobs['reuse'] = makeJob('reuse', { durable: true, status: 'pending' });
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // It must actually poll, not time out on its first tick.
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/model/status?jobId=job-reuse'),
    );
    const timedOut = mockUpdateJob.mock.calls.some(
      (c: unknown[]) => (c[1] as Record<string, unknown>).error === 'Generation timed out',
    );
    expect(timedOut).toBe(false);
    fetchSpy.mockRestore();
  });

  it('clears all timers on unmount', async () => {
    mockJobs['u1'] = makeJob('u1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-u1', status: 'processing', progress: 10 }),
    );

    const { unmount } = renderHook(() => useGenerationPolling());

    // Let the poll loop start so there is a live timer to clear.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const pollsBeforeUnmount = fetchSpy.mock.calls.length;
    expect(pollsBeforeUnmount).toBeGreaterThan(0);

    unmount();

    // A cleared timer issues no further polls, however far the clock runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(pollsBeforeUnmount);
    expect(vi.getTimerCount()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Auto-place: model import gated on autoPlace flag
  // ---------------------------------------------------------------------------
  describe('auto-place model', () => {
    function setupModelCompletion(jobOverrides: Record<string, unknown> = {}) {
      mockJobs['ap1'] = makeJob('ap1', {
        type: 'model',
        prompt: 'a sword',
        ...jobOverrides,
      });

      const origFileReader = globalThis.FileReader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FileReader = class {
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result = 'data:model/gltf-binary;base64,AAAA';
        readAsDataURL = vi.fn().mockImplementation(function (this: { onloadend: (() => void) | null }) {
          if (this.onloadend) this.onloadend();
        });
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;
        if (urlStr.includes('/status')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              jobId: 'job-ap1',
              status: 'completed',
              progress: 100,
              resultUrl: 'https://example.com/model.glb',
            }),
          } as Response;
        }
        return {
          ok: true,
          blob: () => Promise.resolve(new Blob(['glb-data'], { type: 'model/gltf-binary' })),
        } as Response;
      });

      return () => { globalThis.FileReader = origFileReader; };
    }

    it('imports model into scene when autoPlace is true', async () => {
      const cleanup = setupModelCompletion({ autoPlace: true, targetEntityId: 'ent-1' });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // The job's targetEntityId must be threaded through as the 3rd arg so the
      // model replaces the placeholder entity in place rather than spawning a sibling.
      expect(mockImportGltf).toHaveBeenCalledWith(
        'data:model/gltf-binary;base64,AAAA',
        'TestAsset',
        'ent-1',
      );

      expect(mockUpdateJob).toHaveBeenCalledWith('ap1', expect.objectContaining({
        status: 'completed',
        metadata: expect.objectContaining({ autoPlaced: true, targetEntityId: 'ent-1' }),
      }));

      cleanup();
    });

    it('imports model when autoPlace is undefined (legacy behavior)', async () => {
      const cleanup = setupModelCompletion({}); // no autoPlace field

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(mockImportGltf).toHaveBeenCalled();
      cleanup();
    });

    it('skips import when autoPlace is false', async () => {
      const cleanup = setupModelCompletion({ autoPlace: false });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(mockImportGltf).not.toHaveBeenCalled();

      expect(mockUpdateJob).toHaveBeenCalledWith('ap1', expect.objectContaining({
        status: 'completed',
        metadata: expect.objectContaining({ autoPlaced: false }),
      }));

      cleanup();
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-place: texture loading with materialSlot
  // ---------------------------------------------------------------------------
  describe('auto-place texture', () => {
    function setupTextureCompletion(jobOverrides: Record<string, unknown> = {}) {
      mockJobs['at1'] = makeJob('at1', {
        type: 'texture',
        prompt: 'wood texture',
        entityId: 'ent-tex-1',
        ...jobOverrides,
      });

      const origFileReader = globalThis.FileReader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FileReader = class {
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result = 'data:image/png;base64,AAAA';
        readAsDataURL = vi.fn().mockImplementation(function (this: { onloadend: (() => void) | null }) {
          if (this.onloadend) this.onloadend();
        });
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;
        if (urlStr.includes('/status')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              jobId: 'job-at1',
              status: 'completed',
              progress: 100,
              maps: {
                albedo: 'https://example.com/albedo.png',
                normal: 'https://example.com/normal.png',
              },
            }),
          } as Response;
        }
        return {
          ok: true,
          blob: () => Promise.resolve(new Blob(['img-data'], { type: 'image/png' })),
        } as Response;
      });

      return () => { globalThis.FileReader = origFileReader; };
    }

    it('applies all texture maps to target entity when no materialSlot specified', async () => {
      const cleanup = setupTextureCompletion({ autoPlace: true, targetEntityId: 'ent-tex-target' });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Should apply both albedo (base_color) and normal maps
      expect(mockLoadTexture).toHaveBeenCalledWith(
        'data:image/png;base64,AAAA',
        expect.stringContaining('albedo'),
        'ent-tex-target',
        'base_color',
      );
      expect(mockLoadTexture).toHaveBeenCalledWith(
        'data:image/png;base64,AAAA',
        expect.stringContaining('normal'),
        'ent-tex-target',
        'normal_map',
      );

      cleanup();
    });

    it('applies only the specified materialSlot map', async () => {
      const cleanup = setupTextureCompletion({
        autoPlace: true,
        targetEntityId: 'ent-tex-target',
        materialSlot: 'normal_map',
      });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Should only apply normal map, not albedo
      expect(mockLoadTexture).toHaveBeenCalledTimes(1);
      expect(mockLoadTexture).toHaveBeenCalledWith(
        'data:image/png;base64,AAAA',
        expect.stringContaining('normal'),
        'ent-tex-target',
        'normal_map',
      );

      expect(mockUpdateJob).toHaveBeenCalledWith('at1', expect.objectContaining({
        status: 'completed',
        metadata: expect.objectContaining({
          autoPlaced: true,
          targetEntityId: 'ent-tex-target',
          materialSlot: 'normal_map',
        }),
      }));

      cleanup();
    });

    it('skips texture loading when autoPlace is false', async () => {
      const cleanup = setupTextureCompletion({ autoPlace: false });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(mockLoadTexture).not.toHaveBeenCalled();

      expect(mockUpdateJob).toHaveBeenCalledWith('at1', expect.objectContaining({
        status: 'completed',
      }));

      cleanup();
    });

    it('uses targetEntityId over entityId when both are present', async () => {
      const cleanup = setupTextureCompletion({
        autoPlace: true,
        entityId: 'legacy-entity',
        targetEntityId: 'target-entity',
      });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Should use targetEntityId, not entityId
      for (const call of mockLoadTexture.mock.calls) {
        expect(call[2]).toBe('target-entity');
      }

      cleanup();
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-place: sprite with materialSlot
  // ---------------------------------------------------------------------------
  describe('auto-place sprite', () => {
    it('applies sprite texture to targetEntityId with materialSlot', async () => {
      mockJobs['sp2'] = makeJob('sp2', {
        type: 'sprite',
        prompt: 'hero sprite',
        autoPlace: true,
        targetEntityId: 'ent-sprite',
        materialSlot: 'emissive',
      });

      const origFileReader = globalThis.FileReader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FileReader = class {
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result = 'data:image/png;base64,SPRITE';
        readAsDataURL = vi.fn().mockImplementation(function (this: { onloadend: (() => void) | null }) {
          if (this.onloadend) this.onloadend();
        });
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;
        if (urlStr.includes('/status')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              jobId: 'job-sp2',
              status: 'completed',
              progress: 100,
              resultUrl: 'https://example.com/sprite.png',
            }),
          } as Response;
        }
        return {
          ok: true,
          blob: () => Promise.resolve(new Blob(['sprite'], { type: 'image/png' })),
        } as Response;
      });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(mockLoadTexture).toHaveBeenCalledWith(
        'data:image/png;base64,SPRITE',
        'TestAsset',
        'ent-sprite',
        'emissive',
      );

      expect(mockUpdateJob).toHaveBeenCalledWith('sp2', expect.objectContaining({
        status: 'completed',
        metadata: expect.objectContaining({
          autoPlaced: true,
          targetEntityId: 'ent-sprite',
          materialSlot: 'emissive',
        }),
      }));

      globalThis.FileReader = origFileReader;
    });

    it('skips sprite texture when autoPlace is false', async () => {
      mockJobs['sp3'] = makeJob('sp3', {
        type: 'sprite',
        prompt: 'enemy sprite',
        autoPlace: false,
        entityId: 'ent-nope',
      });

      const origFileReader = globalThis.FileReader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FileReader = class {
        onloadend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result = 'data:image/png;base64,SPRITE';
        readAsDataURL = vi.fn().mockImplementation(function (this: { onloadend: (() => void) | null }) {
          if (this.onloadend) this.onloadend();
        });
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;
        if (urlStr.includes('/status')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              jobId: 'job-sp3',
              status: 'completed',
              progress: 100,
              resultUrl: 'https://example.com/sprite.png',
            }),
          } as Response;
        }
        return {
          ok: true,
          blob: () => Promise.resolve(new Blob(['sprite'], { type: 'image/png' })),
        } as Response;
      });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(mockLoadTexture).not.toHaveBeenCalled();
      globalThis.FileReader = origFileReader;
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-place: music with targetEntityId
  // ---------------------------------------------------------------------------
  describe('auto-place music', () => {
    it('skips audio attachment when autoPlace is false', async () => {
      vi.useRealTimers();

      mockJobs['m3'] = makeJob('m3', {
        type: 'music',
        entityId: 'ent-music-skip',
        autoPlace: false,
        prompt: 'calm music',
      });

      const origFileReader = globalThis.FileReader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).FileReader = class {
        result = 'data:audio/mpeg;base64,dGVzdA==';
        onloadend: (() => void) | null = null;
        onerror: ((_e: unknown) => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => { if (this.onloadend) this.onloadend(); });
        }
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;
        if (urlStr.includes('/status')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              jobId: 'job-m3',
              status: 'completed',
              progress: 100,
              resultUrl: 'https://example.com/music.mp3',
            }),
          } as Response;
        }
        return {
          ok: true,
          blob: () => Promise.resolve(new Blob(['audio'], { type: 'audio/mpeg' })),
        } as Response;
      });

      renderHook(() => useGenerationPolling());

      await vi.waitFor(() => {
        expect(mockImportAudio).toHaveBeenCalled();
      });

      // Audio is always imported, but setAudio should NOT be called when autoPlace is false
      expect(mockSetAudio).not.toHaveBeenCalled();

      globalThis.FileReader = origFileReader;
      vi.useFakeTimers();
    });
  });
});
