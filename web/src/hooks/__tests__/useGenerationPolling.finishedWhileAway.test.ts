/**
 * Reload after an unattended durable generation (#8892), through the REAL
 * store and the REAL hook.
 *
 * GenerationStatus renders only pending/processing/downloading jobs. A row the
 * QStash callback completed while no tab was open used to hydrate as
 * 'completed' (nothing shown), then flip to 'downloading' when the completion
 * sync began importing it: an unexplained "Generating (1)" spinner for a job
 * the person thinks is done, which then vanished with no confirmation. These
 * tests pin the sequence the person sees instead: 'downloading' from the first
 * render, then 'completed', then ONE success toast saying what happened.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

const { mockShowSuccess, mockShowPersistentError } = vi.hoisted(() => ({
  mockShowSuccess: vi.fn(),
  mockShowPersistentError: vi.fn(),
}));

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
  showSuccess: mockShowSuccess,
  showPersistentError: mockShowPersistentError,
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

import { useGenerationStore, type GenerationStatus } from '@/stores/generationStore';
import { useGenerationPolling } from '../useGenerationPolling';

const AWAY = /finished while you were away/;

function listRow(overrides: Record<string, unknown>) {
  return {
    id: 'db-row', providerJobId: 'provider-job', provider: 'meshy', type: 'model',
    prompt: 'A tower', progress: 100, imported: false,
    // autoPlace false: the model branch records the result without a download,
    // so the test needs no GLB fixture.
    parameters: { durable: true, autoPlace: false },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:01:00Z',
    ...overrides,
  };
}

describe('reload after an unattended durable generation (#8892)', () => {
  let patchBodies: Array<Record<string, unknown>>;
  let statuses: GenerationStatus[];
  let unsubscribe: () => void;

  /**
   * `list` is what GET /api/jobs?status=active returns; `row` is what
   * GET /api/jobs/db-row returns (the completion sync re-reads the row).
   */
  function stubServer(
    list: unknown[],
    row: Record<string, unknown> | 'fail',
    extra: Record<string, () => Response> = {},
  ) {
    patchBodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      if (extra[u]) return extra[u]();
      if (u === '/api/jobs?status=active') {
        return { ok: true, status: 200, json: async () => ({ jobs: list, durableCompletionEnabled: true }) } as Response;
      }
      if (u === '/api/jobs/db-row' && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { ok: true, status: 200, json: async () => ({ updated: true }) } as Response;
      }
      if (u === '/api/jobs/db-row') {
        if (row === 'fail') return { ok: false, status: 503, json: async () => ({}) } as Response;
        return { ok: true, status: 200, json: async () => row } as Response;
      }
      if (u === '/api/generate/refund') {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${u}`);
    });
  }

  /** Record every distinct status the hydrated job passes through. */
  function recordStatuses() {
    statuses = [];
    unsubscribe = useGenerationStore.subscribe((state) => {
      const s = state.jobs['hydrated_db-row']?.status;
      if (s && statuses[statuses.length - 1] !== s) statuses.push(s);
    });
  }

  beforeEach(() => {
    mockShowSuccess.mockReset();
    mockShowPersistentError.mockReset();
    useGenerationStore.setState({ jobs: {}, hydrated: false, durableCompletionEnabled: false });
    recordStatuses();
  });

  afterEach(() => {
    // Unmount explicitly: a hook left mounted from an earlier test would run
    // its own completion sync for the next test's row and double every toast.
    cleanup();
    unsubscribe();
    vi.restoreAllMocks();
    useGenerationStore.setState({ jobs: {} });
  });

  it('a completed row is shown finishing from the first render, never completed -> downloading, then confirmed once', async () => {
    stubServer(
      [listRow({ status: 'completed' })],
      { status: 'completed', resultUrl: 'https://cdn.example.com/tower.glb', resultMeta: null, errorMessage: null },
    );

    await act(async () => { await useGenerationStore.getState().hydrateFromServer(); });
    // Before the hook runs at all, the job is already in the state the status
    // indicator renders — there is no terminal state for it to flip out of.
    expect(useGenerationStore.getState().jobs['hydrated_db-row']?.status).toBe('downloading');

    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs['hydrated_db-row']?.needsCompletionSync).toBe(false));
    await act(async () => { await Promise.resolve(); });

    expect(statuses).toEqual(['downloading', 'completed']);
    // Exactly one confirmation, naming the asset type.
    const away = mockShowSuccess.mock.calls.filter(([m]) => AWAY.test(String(m)));
    expect(away).toEqual([['Your 3D model finished while you were away.']]);
    // The row the callback finalized is never written back to a live status:
    // a 'downloading' row that the tab closes on would hydrate as a spinner
    // with nothing left to settle it.
    expect(patchBodies.some((b) => b.status === 'downloading')).toBe(false);
    expect(patchBodies.some((b) => b.imported === true)).toBe(true);
    expect(mockShowPersistentError).not.toHaveBeenCalled();
  });

  it('says the asset was added to the project when the import placed it', async () => {
    stubServer(
      [listRow({ type: 'skybox', status: 'completed' })],
      { status: 'completed', resultUrl: 'https://cdn.example.com/sky.png', resultMeta: null, errorMessage: null },
      { 'https://cdn.example.com/sky.png': () => ({ ok: true, status: 200, blob: async () => new Blob(['x']) } as Response) },
    );
    await act(async () => { await useGenerationStore.getState().hydrateFromServer(); });
    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs['hydrated_db-row']?.status).toBe('completed'));
    await act(async () => { await Promise.resolve(); });

    expect(mockShowSuccess.mock.calls.filter(([m]) => AWAY.test(String(m)))).toEqual([
      ['Your skybox finished while you were away and was added to your project.'],
    ]);
  });

  it('a failed row never shows a spinner and gets no success toast — only the existing failure message', async () => {
    stubServer(
      [listRow({ status: 'failed', progress: 0 })],
      { status: 'failed', resultUrl: null, resultMeta: null, errorMessage: 'The provider rejected this prompt. Try a different description.' },
    );

    await act(async () => { await useGenerationStore.getState().hydrateFromServer(); });
    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs['hydrated_db-row']?.needsCompletionSync).toBe(false));
    await act(async () => { await Promise.resolve(); });

    expect(statuses).toEqual(['failed']);
    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(mockShowPersistentError).toHaveBeenCalledTimes(1);
    expect(mockShowPersistentError).toHaveBeenCalledWith(
      'The provider rejected this prompt. Try a different description.',
      expect.anything(),
    );
  });

  it('a row read that fails does not strand a spinner, and keeps the job queued for a retry', async () => {
    stubServer([listRow({ status: 'completed' })], 'fail');

    await act(async () => { await useGenerationStore.getState().hydrateFromServer(); });
    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs['hydrated_db-row']?.status).toBe('completed'));
    await act(async () => { await Promise.resolve(); });

    const job = useGenerationStore.getState().jobs['hydrated_db-row'];
    expect(job?.needsCompletionSync).toBe(true);
    expect(mockShowSuccess).not.toHaveBeenCalled();
    // Restoring the terminal status is local only: it must not claim the row
    // was imported, which would drop it from the next load's list.
    expect(patchBodies).toEqual([]);
  });

  it('a job completed live in this session gets no "while you were away" toast', async () => {
    patchBodies = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith('/api/generate/model/status')) {
        return { ok: true, status: 200, json: async () => ({ jobId: 'live-job', status: 'completed', progress: 100, resultUrl: 'https://cdn.example.com/live.glb' }) } as Response;
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    useGenerationStore.setState({
      jobs: {
        live: {
          id: 'live', jobId: 'live-job', type: 'model', prompt: 'A bridge', status: 'pending',
          progress: 0, provider: 'meshy', createdAt: 0, autoPlace: false,
        },
      },
    });

    renderHook(() => useGenerationPolling());
    await waitFor(() => expect(useGenerationStore.getState().jobs.live?.status).toBe('completed'));
    await act(async () => { await Promise.resolve(); });

    expect(mockShowSuccess.mock.calls.filter(([m]) => AWAY.test(String(m)))).toEqual([]);
  });
});
