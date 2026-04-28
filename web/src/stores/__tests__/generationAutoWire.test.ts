/**
 * Tests for the generation auto-wire bridge.
 *
 * Covers both the standalone module (autoWireGenerationResult dispatching to
 * the registered editor handlers) and the generationStore trigger that fires
 * the bridge on completion transitions.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  autoWireGenerationResult,
  setAutoWireDispatchers,
  _resetForTest,
  type AutoWireDispatchers,
} from '../generationAutoWire';
import { useGenerationStore, type GenerationJob } from '../generationStore';

vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
}));
vi.mock('@/lib/analytics/posthog', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvent: {
    AI_GENERATION_STARTED: 'ai_generation_started',
    AI_GENERATION_COMPLETED: 'ai_generation_completed',
  },
}));
vi.mock('@/lib/analytics/events', () => ({
  trackAIAssetGenerated: vi.fn(),
}));

function makeDispatchers(): AutoWireDispatchers & {
  importGltf: ReturnType<typeof vi.fn>;
  loadTexture: ReturnType<typeof vi.fn>;
  importAudio: ReturnType<typeof vi.fn>;
  setAudio: ReturnType<typeof vi.fn>;
} {
  return {
    importGltf: vi.fn(),
    loadTexture: vi.fn(),
    importAudio: vi.fn(),
    setAudio: vi.fn(),
  };
}

function mockBlobFetch(bytes: number[] = [1, 2, 3], type = 'application/octet-stream'): void {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => blob,
      json: async () => ({ job: { id: 'db-1' }, jobs: [] }),
    }),
  );
}

describe('autoWireGenerationResult', () => {
  beforeEach(() => {
    _resetForTest();
    mockBlobFetch();
  });

  afterEach(() => {
    _resetForTest();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('is a no-op when no dispatchers are registered', async () => {
    await autoWireGenerationResult({
      type: 'model',
      resultUrl: 'https://example.com/m.glb',
      prompt: 'tree',
    });
    // Nothing to assert beyond "did not throw"; the fetch is never called.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('routes model results to importGltf', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'model',
      resultUrl: 'https://example.com/oak.glb',
      prompt: 'an oak tree',
    });

    expect(d.importGltf).toHaveBeenCalledTimes(1);
    expect(d.importGltf).toHaveBeenCalledWith(expect.any(String), 'an_oak_tree');
    expect(d.loadTexture).not.toHaveBeenCalled();
    expect(d.importAudio).not.toHaveBeenCalled();
  });

  it.each(['texture', 'sprite', 'sprite_sheet', 'tileset', 'pixel-art'] as const)(
    'routes %s results to loadTexture when targetEntityId + materialSlot are present',
    async (type) => {
      const d = makeDispatchers();
      setAutoWireDispatchers(d);

      await autoWireGenerationResult({
        type,
        resultUrl: 'https://example.com/tex.png',
        prompt: 'rusty metal',
        targetEntityId: 'entity-1',
        materialSlot: 'base_color',
      });

      expect(d.loadTexture).toHaveBeenCalledTimes(1);
      expect(d.loadTexture).toHaveBeenCalledWith(
        expect.any(String),
        'rusty_metal',
        'entity-1',
        'base_color',
      );
      expect(d.importGltf).not.toHaveBeenCalled();
    },
  );

  it('skips texture wiring when targetEntityId is missing', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'texture',
      resultUrl: 'https://example.com/tex.png',
      prompt: 'wood',
      materialSlot: 'base_color',
    });

    expect(d.loadTexture).not.toHaveBeenCalled();
  });

  it('skips texture wiring when materialSlot is missing', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'texture',
      resultUrl: 'https://example.com/tex.png',
      prompt: 'wood',
      targetEntityId: 'entity-1',
    });

    expect(d.loadTexture).not.toHaveBeenCalled();
  });

  it.each(['sfx', 'voice', 'music'] as const)(
    'routes %s results to importAudio + setAudio when targetEntityId is present',
    async (type) => {
      const d = makeDispatchers();
      setAutoWireDispatchers(d);

      await autoWireGenerationResult({
        type,
        resultUrl: 'https://example.com/clip.mp3',
        prompt: 'ambient hum',
        targetEntityId: 'entity-2',
      });

      expect(d.importAudio).toHaveBeenCalledTimes(1);
      expect(d.importAudio).toHaveBeenCalledWith(expect.any(String), 'ambient_hum');
      expect(d.setAudio).toHaveBeenCalledTimes(1);
      expect(d.setAudio).toHaveBeenCalledWith('entity-2', { assetId: 'ambient_hum' });
    },
  );

  it('skips audio wiring when targetEntityId is missing', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'sfx',
      resultUrl: 'https://example.com/clip.mp3',
      prompt: 'whoosh',
    });

    expect(d.importAudio).not.toHaveBeenCalled();
    expect(d.setAudio).not.toHaveBeenCalled();
  });

  it('is a no-op for skybox (engine support pending)', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'skybox',
      resultUrl: 'https://example.com/sky.hdr',
      prompt: 'mountain dawn',
      targetEntityId: 'entity-3',
    });

    expect(d.importGltf).not.toHaveBeenCalled();
    expect(d.loadTexture).not.toHaveBeenCalled();
    expect(d.importAudio).not.toHaveBeenCalled();
    expect(d.setAudio).not.toHaveBeenCalled();
  });

  it('reports fetch failures to Sentry without throwing or dispatching', async () => {
    const sentry = await import('@/lib/monitoring/sentry-client');
    const captureException = vi.mocked(sentry.captureException);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );

    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'model',
      resultUrl: 'https://example.com/m.glb',
      prompt: 'cube',
    });

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('502') }),
      expect.objectContaining({ context: 'generationAutoWire.fetch' }),
    );
    expect(d.importGltf).not.toHaveBeenCalled();
  });

  it('falls back to "generated" for prompts that sanitize to empty', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    await autoWireGenerationResult({
      type: 'model',
      resultUrl: 'https://example.com/m.glb',
      prompt: '!!!@@@###',
    });

    expect(d.importGltf).toHaveBeenCalledWith(expect.any(String), 'generated');
  });
});

describe('generationStore auto-wire trigger', () => {
  const mockJob: GenerationJob = {
    id: 'client-1',
    jobId: 'prov-1',
    type: 'texture',
    prompt: 'mossy stone',
    status: 'processing',
    progress: 50,
    provider: 'replicate',
    createdAt: 1234567890,
    autoPlace: true,
    targetEntityId: 'entity-A',
    materialSlot: 'base_color',
  };

  beforeEach(() => {
    _resetForTest();
    mockBlobFetch();
    useGenerationStore.setState({ jobs: {}, hydrated: false });
  });

  afterEach(() => {
    _resetForTest();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fires auto-wire when a job transitions to completed with autoPlace + resultUrl', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    useGenerationStore.setState({ jobs: { 'client-1': mockJob } });
    useGenerationStore.getState().updateJob('client-1', {
      status: 'completed',
      progress: 100,
      resultUrl: 'https://example.com/tex.png',
    });

    await vi.waitFor(() => {
      expect(d.loadTexture).toHaveBeenCalledTimes(1);
    });
    expect(d.loadTexture).toHaveBeenCalledWith(
      expect.any(String),
      'mossy_stone',
      'entity-A',
      'base_color',
    );
    // Idempotency stamp set on the stored job.
    expect(useGenerationStore.getState().jobs['client-1'].appliedAt).toBeTypeOf('number');
  });

  it('does not fire auto-wire when autoPlace is not set', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    useGenerationStore.setState({
      jobs: { 'client-1': { ...mockJob, autoPlace: undefined } },
    });
    useGenerationStore.getState().updateJob('client-1', {
      status: 'completed',
      progress: 100,
      resultUrl: 'https://example.com/tex.png',
    });

    // Give microtasks a chance.
    await Promise.resolve();
    await Promise.resolve();
    expect(d.loadTexture).not.toHaveBeenCalled();
  });

  it('does not re-fire when an already-completed job is updated', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    useGenerationStore.setState({
      jobs: {
        'client-1': {
          ...mockJob,
          status: 'completed',
          resultUrl: 'https://example.com/tex.png',
          appliedAt: Date.now(),
        },
      },
    });

    useGenerationStore.getState().updateJob('client-1', { progress: 100 });

    await Promise.resolve();
    await Promise.resolve();
    expect(d.loadTexture).not.toHaveBeenCalled();
  });

  it('marks rehydrated completed jobs with appliedAt so refresh-after-completion is a no-op', async () => {
    const d = makeDispatchers();
    setAutoWireDispatchers(d);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobs: [
          {
            id: 'srv-completed',
            providerJobId: 'prov-c',
            provider: 'replicate',
            type: 'texture',
            prompt: 'wood',
            status: 'completed',
            progress: 100,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:30Z',
            parameters: {
              autoPlace: true,
              targetEntityId: 'entity-Z',
              materialSlot: 'base_color',
            },
          },
        ],
      }),
    } as Response);

    await useGenerationStore.getState().hydrateFromServer();

    const hydrated = Object.values(useGenerationStore.getState().jobs)[0];
    expect(hydrated.status).toBe('completed');
    expect(hydrated.appliedAt).toBeTypeOf('number');

    // Subsequent updateJob must not re-trigger auto-wire.
    useGenerationStore.getState().updateJob(hydrated.id, { progress: 100 });
    await Promise.resolve();
    await Promise.resolve();
    expect(d.loadTexture).not.toHaveBeenCalled();
  });
});
