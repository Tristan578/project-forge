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

      expect(mockImportGltf).toHaveBeenCalledWith(
        'data:model/gltf-binary;base64,AAAA',
        'TestAsset',
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
        'normal',
      );

      cleanup();
    });

    it('applies only the specified materialSlot map', async () => {
      const cleanup = setupTextureCompletion({
        autoPlace: true,
        targetEntityId: 'ent-tex-target',
        materialSlot: 'normal',
      });

      renderHook(() => useGenerationPolling());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Should only apply normal map, not albedo
      expect(mockLoadTexture).toHaveBeenCalledTimes(1);
      expect(mockLoadTexture).toHaveBeenCalledWith(
        'data:image/png;base64,AAAA',
        expect.stringContaining('normal'),
        'ent-tex-target',
        'normal',
      );

      expect(mockUpdateJob).toHaveBeenCalledWith('at1', expect.objectContaining({
        status: 'completed',
        metadata: expect.objectContaining({
          autoPlaced: true,
          targetEntityId: 'ent-tex-target',
          materialSlot: 'normal',
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
