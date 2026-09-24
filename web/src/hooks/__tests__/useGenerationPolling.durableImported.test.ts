/**
 * Durable completion sync (#8892) against the REAL generation store.
 *
 * The sibling suite mocks `useGenerationStore`, so it cannot see the PATCH the
 * store's own DB sync fires from `updateJob`. That PATCH and the hook's
 * `{ imported: true }` PATCH are two independent, unawaited requests with
 * nothing ordering them. Whatever order the server applies them in, the row a
 * hydrated job settled from must end up `imported = 1` — otherwise a
 * historical failure resurfaces (toast + refund retry) on every reload.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/analytics/posthog', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvent: {
    AI_GENERATION_STARTED: 'ai_generation_started',
    AI_GENERATION_COMPLETED: 'ai_generation_completed',
  },
}));
vi.mock('@/lib/analytics/events', () => ({ trackAIAssetGenerated: vi.fn() }));
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      importGltf: vi.fn(),
      loadTexture: vi.fn(),
      setCustomSkybox: vi.fn(),
      importAudio: vi.fn(),
      setAudio: vi.fn(),
      setSpriteSheet: vi.fn(),
    }),
  },
}));
vi.mock('@/stores/userStore', () => ({
  useUserStore: { getState: () => ({ fetchBalance: vi.fn(async () => undefined) }) },
}));
vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showPersistentError: vi.fn(),
  showInfo: vi.fn(),
}));
vi.mock('@/lib/utils/refundQueue', () => ({
  enqueueFailedRefund: vi.fn(),
  processFailedRefunds: vi.fn(async () => undefined),
}));
vi.mock('@/lib/generate/postProcess', () => ({
  postProcess: vi.fn(() => ({ warnings: [], metadata: { assetName: 'TestAsset' } })),
  inferSfxCategory: vi.fn(() => 'impact'),
}));

import { useGenerationStore, type GenerationJob } from '@/stores/generationStore';
import { useGenerationPolling } from '../useGenerationPolling';

/** Apply PATCH bodies to a row exactly as PATCH_impl does: an absent field is left alone. */
function applyPatches(bodies: Array<Record<string, unknown>>): { imported: number } {
  const row = { imported: 0 };
  for (const body of bodies) {
    if (body.imported !== undefined) row.imported = body.imported ? 1 : 0;
  }
  return row;
}

function hydrated(overrides: Partial<GenerationJob>): GenerationJob {
  return {
    id: 'job',
    jobId: 'provider-job',
    type: 'model',
    prompt: 'A tower',
    status: 'failed',
    progress: 0,
    provider: 'meshy',
    createdAt: 0,
    dbId: 'db-row',
    durable: true,
    needsCompletionSync: true,
    ...overrides,
  };
}

describe('durable completion sync — imported is order-independent (#8892)', () => {
  let patchBodies: Array<Record<string, unknown>>;

  function stubServer(row: Record<string, unknown>) {
    patchBodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (u === '/api/jobs/db-row' && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ updated: true }) } as Response;
      }
      if (u === '/api/jobs/db-row') {
        return { ok: true, status: 200, json: async () => row } as Response;
      }
      if (u === '/api/generate/refund') {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${u}`);
    });
  }

  beforeEach(() => {
    useGenerationStore.setState({ jobs: {}, hydrated: true, durableCompletionEnabled: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useGenerationStore.setState({ jobs: {} });
  });

  it('a hydrated FAILED row ends imported = 1 whichever PATCH the server applies last', async () => {
    stubServer({ status: 'failed', resultUrl: null, resultMeta: null, errorMessage: 'Provider rejected the prompt' });
    useGenerationStore.setState({ jobs: { job: hydrated({ status: 'failed', usageId: 'usage-1' }) } });

    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs.job?.needsCompletionSync).toBe(false));
    await act(async () => { await Promise.resolve(); });

    // Both writers fired: the store's status sync and the hook's reflected mark.
    expect(patchBodies.some((b) => b.status === 'failed')).toBe(true);
    expect(patchBodies.some((b) => b.imported === true)).toBe(true);
    // Deterministic regardless of network ordering.
    expect(applyPatches(patchBodies).imported).toBe(1);
    expect(applyPatches([...patchBodies].reverse()).imported).toBe(1);
  });

  it('a hydrated COMPLETED row ends imported = 1 whichever PATCH the server applies last', async () => {
    stubServer({ status: 'completed', resultUrl: 'https://cdn.example.com/tower.glb', resultMeta: null, errorMessage: null });
    // autoPlace false: the model branch records the result without a download.
    useGenerationStore.setState({ jobs: { job: hydrated({ status: 'completed', progress: 100, autoPlace: false }) } });

    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs.job?.needsCompletionSync).toBe(false));
    await act(async () => { await Promise.resolve(); });

    // The intermediate 'downloading' sync is one of the racing writers too.
    expect(patchBodies.some((b) => b.status === 'downloading')).toBe(true);
    expect(applyPatches(patchBodies).imported).toBe(1);
    expect(applyPatches([...patchBodies].reverse()).imported).toBe(1);
  });
});
