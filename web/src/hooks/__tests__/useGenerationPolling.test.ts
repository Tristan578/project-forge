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

vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ jobs: mockJobs, updateJob: mockUpdateJob }),
    {
      getState: () => ({ jobs: mockJobs }),
    },
  ),
}));

const mockImportGltf = vi.fn();
const mockLoadTexture = vi.fn();
const mockSetCustomSkybox = vi.fn();
const mockImportAudio = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      importGltf: mockImportGltf,
      loadTexture: mockLoadTexture,
      setCustomSkybox: mockSetCustomSkybox,
      importAudio: mockImportAudio,
    }),
  },
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

import { useGenerationPolling } from '../useGenerationPolling';

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Clear jobs
    Object.keys(mockJobs).forEach(k => delete mockJobs[k]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Basic lifecycle
  // ---------------------------------------------------------------------------
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
      error: 'Generation failed',
    });
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

    // Immediate first poll + 100 interval polls = 101 polls, timeout at poll 101
    for (let i = 0; i < 101; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }

    // Should have been called with 'failed' and 'Generation timed out'
    const failCall = mockUpdateJob.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).error === 'Generation timed out',
    );
    expect(failCall).toBeDefined();
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

  it('clears all timers on unmount', async () => {
    mockJobs['u1'] = makeJob('u1');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetchResponse({ jobId: 'job-u1', status: 'processing', progress: 10 }),
    );

    const { unmount } = renderHook(() => useGenerationPolling());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    unmount();

    // Advancing timers after unmount should not cause errors
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
  });
});
