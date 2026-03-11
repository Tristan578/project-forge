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
        Promise.resolve().then(() => this.onload?.());
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
