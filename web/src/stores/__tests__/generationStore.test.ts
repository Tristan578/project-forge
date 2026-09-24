/**
 * Unit tests for the generationStore Zustand store.
 *
 * Tests cover AI asset generation job tracking, status updates,
 * active job counting, and job lifecycle management.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toast } from 'sonner';
import { captureException } from '@/lib/monitoring/sentry-client';
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));
import { useGenerationStore, type GenerationJob } from '../generationStore';

// Mock Sentry client so captureException calls are trackable in tests
vi.mock('@/lib/monitoring/sentry-client', () => ({
  captureException: vi.fn(),
}));

// Mock analytics to prevent side-effects in tests
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

describe('generationStore', () => {
  const mockJob: GenerationJob = {
    id: 'client-123',
    jobId: 'provider-456',
    type: 'model',
    prompt: 'A blue cube',
    status: 'pending',
    progress: 0,
    provider: 'meshy',
    createdAt: 1234567890,
  };

  beforeEach(() => {
    vi.resetModules();
    // Mock fetch for addJob persistence (fire-and-forget)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job: { id: 'db-1' }, jobs: [] }),
    }));
    // Reset store to initial state
    useGenerationStore.setState({
      jobs: {},
      hydrated: false,
      durableCompletionEnabled: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with empty jobs', () => {
      const state = useGenerationStore.getState();
      expect(state.jobs).toEqual({});
    });

    it('should have activeJobCount of 0 initially', () => {
      const state = useGenerationStore.getState();
      expect(state.activeJobCount).toBe(0);
    });
  });

  describe('addJob', () => {
    it('should add a new job', () => {
      const { addJob } = useGenerationStore.getState();

      addJob(mockJob);

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123']).toEqual(mockJob);
    });

    it('should add multiple jobs', () => {
      const { addJob } = useGenerationStore.getState();

      const job1 = { ...mockJob, id: 'job1' };
      const job2 = { ...mockJob, id: 'job2', type: 'texture' as const };

      addJob(job1);
      addJob(job2);

      const state = useGenerationStore.getState();
      expect(Object.keys(state.jobs)).toHaveLength(2);
      expect(state.jobs.job1).toEqual(job1);
      expect(state.jobs.job2).toEqual(job2);
    });

    it('should overwrite existing job with same id', () => {
      const { addJob } = useGenerationStore.getState();

      addJob(mockJob);
      addJob({ ...mockJob, prompt: 'A red sphere' });

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].prompt).toBe('A red sphere');
    });
  });

  describe('updateJob', () => {
    it('should update job status', () => {
      const { addJob, updateJob } = useGenerationStore.getState();

      addJob(mockJob);
      updateJob('client-123', { status: 'processing' });

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].status).toBe('processing');
    });

    it('should update job progress', () => {
      const { addJob, updateJob } = useGenerationStore.getState();

      addJob(mockJob);
      updateJob('client-123', { progress: 75 });

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].progress).toBe(75);
    });

    it('should update multiple fields', () => {
      const { addJob, updateJob } = useGenerationStore.getState();

      addJob(mockJob);
      updateJob('client-123', {
        status: 'completed',
        progress: 100,
        resultUrl: 'https://example.com/result.glb',
      });

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].status).toBe('completed');
      expect(state.jobs['client-123'].progress).toBe(100);
      expect(state.jobs['client-123'].resultUrl).toBe('https://example.com/result.glb');
    });

    it('should not modify state if job does not exist', () => {
      const { updateJob } = useGenerationStore.getState();

      const initialState = useGenerationStore.getState();
      updateJob('nonexistent', { status: 'completed' });
      const finalState = useGenerationStore.getState();

      expect(initialState).toBe(finalState);
    });

    it('should preserve other job fields when updating', () => {
      const { addJob, updateJob } = useGenerationStore.getState();

      addJob(mockJob);
      updateJob('client-123', { status: 'processing' });

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].prompt).toBe('A blue cube');
      expect(state.jobs['client-123'].provider).toBe('meshy');
    });
  });

  describe('removeJob', () => {
    it('should remove a job', () => {
      const { addJob, removeJob } = useGenerationStore.getState();

      addJob(mockJob);
      removeJob('client-123');

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123']).toBeUndefined();
    });

    it('should remove only the specified job', () => {
      const { addJob, removeJob } = useGenerationStore.getState();

      const job1 = { ...mockJob, id: 'job1' };
      const job2 = { ...mockJob, id: 'job2' };

      addJob(job1);
      addJob(job2);
      removeJob('job1');

      const state = useGenerationStore.getState();
      expect(state.jobs.job1).toBeUndefined();
      expect(state.jobs.job2).toEqual(job2);
    });

    it('should handle removing nonexistent job', () => {
      const { removeJob } = useGenerationStore.getState();

      removeJob('nonexistent');

      const state = useGenerationStore.getState();
      expect(state.jobs).toEqual({});
    });
  });

  describe('clearCompleted', () => {
    it('should remove completed jobs', () => {
      const { addJob, clearCompleted } = useGenerationStore.getState();

      addJob({ ...mockJob, id: 'job1', status: 'completed' });
      addJob({ ...mockJob, id: 'job2', status: 'processing' });

      clearCompleted();

      const state = useGenerationStore.getState();
      expect(state.jobs.job1).toBeUndefined();
      expect(state.jobs.job2).toEqual(expect.objectContaining({ id: 'job2', status: 'processing' }));
    });

    it('should remove failed jobs', () => {
      const { addJob, clearCompleted } = useGenerationStore.getState();

      addJob({ ...mockJob, id: 'job1', status: 'failed', error: 'Timeout' });
      addJob({ ...mockJob, id: 'job2', status: 'pending' });

      clearCompleted();

      const state = useGenerationStore.getState();
      expect(state.jobs.job1).toBeUndefined();
      expect(state.jobs.job2).toEqual(expect.objectContaining({ id: 'job2', status: 'pending' }));
    });

    it('should keep pending, processing, and downloading jobs', () => {
      const { addJob, clearCompleted } = useGenerationStore.getState();

      addJob({ ...mockJob, id: 'job1', status: 'pending' });
      addJob({ ...mockJob, id: 'job2', status: 'processing' });
      addJob({ ...mockJob, id: 'job3', status: 'downloading' });
      addJob({ ...mockJob, id: 'job4', status: 'completed' });

      clearCompleted();

      const state = useGenerationStore.getState();
      expect(state.jobs.job1).toEqual(expect.objectContaining({ status: 'pending' }));
      expect(state.jobs.job2).toEqual(expect.objectContaining({ status: 'processing' }));
      expect(state.jobs.job3).toEqual(expect.objectContaining({ status: 'downloading' }));
      expect(state.jobs.job4).toBeUndefined();
    });

    it('should handle empty jobs', () => {
      const { clearCompleted } = useGenerationStore.getState();

      clearCompleted();

      const state = useGenerationStore.getState();
      expect(state.jobs).toEqual({});
    });
  });

  describe('activeJobCount', () => {
    // Helper to compute active job count from state
    const getActiveCount = () => {
      const { jobs } = useGenerationStore.getState();
      return Object.values(jobs).filter(
        (j) => j.status === 'pending' || j.status === 'processing' || j.status === 'downloading'
      ).length;
    };

    it('should count pending jobs', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'pending' });

      expect(getActiveCount()).toBe(1);
    });

    it('should count processing jobs', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'processing' });

      expect(getActiveCount()).toBe(1);
    });

    it('should count downloading jobs', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'downloading' });

      expect(getActiveCount()).toBe(1);
    });

    it('should not count completed jobs', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'completed' });

      expect(getActiveCount()).toBe(0);
    });

    it('should not count failed jobs', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'failed' });

      expect(getActiveCount()).toBe(0);
    });

    it('should count multiple active jobs', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'pending' });
      addJob({ ...mockJob, id: 'job2', status: 'processing' });
      addJob({ ...mockJob, id: 'job3', status: 'downloading' });
      addJob({ ...mockJob, id: 'job4', status: 'completed' });

      expect(getActiveCount()).toBe(3);
    });

    it('should update count after job status changes', () => {
      const { addJob, updateJob } = useGenerationStore.getState();
      addJob({ ...mockJob, id: 'job1', status: 'pending' });
      expect(getActiveCount()).toBe(1);

      updateJob('job1', { status: 'completed' });
      expect(getActiveCount()).toBe(0);
    });
  });

  describe('autoPlace / targetEntityId / materialSlot persistence', () => {
    it('should store autoPlace on the job', () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, autoPlace: true, targetEntityId: 'entity-abc', materialSlot: 'base_color' });

      const job = useGenerationStore.getState().jobs['client-123'];
      expect(job.autoPlace).toBe(true);
      expect(job.targetEntityId).toBe('entity-abc');
      expect(job.materialSlot).toBe('base_color');
    });

    it('should send autoPlace/targetEntityId/materialSlot in POST parameters', async () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob, autoPlace: true, targetEntityId: 'entity-xyz', materialSlot: 'normal_map' });

      const fetchMock = vi.mocked(fetch);
      await vi.waitFor(() => {
        const postCalls = fetchMock.mock.calls.filter(
          (c) => c[0] === '/api/jobs' && (c[1] as RequestInit)?.method === 'POST'
        );
        expect(postCalls).toHaveLength(1);
        const body = JSON.parse((postCalls[0][1] as RequestInit).body as string);
        expect(body.parameters.autoPlace).toBe(true);
        expect(body.parameters.targetEntityId).toBe('entity-xyz');
        expect(body.parameters.materialSlot).toBe('normal_map');
      });
    });

    it('should not include undefined placement fields in POST parameters', async () => {
      const { addJob } = useGenerationStore.getState();
      addJob({ ...mockJob }); // no autoPlace/targetEntityId/materialSlot

      const fetchMock = vi.mocked(fetch);
      await vi.waitFor(() => {
        const postCalls = fetchMock.mock.calls.filter(
          (c) => c[0] === '/api/jobs' && (c[1] as RequestInit)?.method === 'POST'
        );
        expect(postCalls).toHaveLength(1);
        const body = JSON.parse((postCalls[0][1] as RequestInit).body as string);
        expect(body.parameters).toEqual({});
      });
    });

    it('should preserve placement fields across updateJob calls', () => {
      useGenerationStore.setState({
        jobs: { 'client-123': { ...mockJob, autoPlace: true, targetEntityId: 'ent-1', materialSlot: 'roughness' } },
      });
      useGenerationStore.getState().updateJob('client-123', { status: 'processing', progress: 50 });

      const job = useGenerationStore.getState().jobs['client-123'];
      expect(job.autoPlace).toBe(true);
      expect(job.targetEntityId).toBe('ent-1');
      expect(job.materialSlot).toBe('roughness');
    });

    it('should restore autoPlace/targetEntityId/materialSlot from hydrateFromServer', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 'srv-2',
              providerJobId: 'prov-2',
              provider: 'stability',
              type: 'texture',
              prompt: 'Rusty metal',
              status: 'processing',
              progress: 20,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:30Z',
              parameters: {
                autoPlace: true,
                targetEntityId: 'entity-restored',
                materialSlot: 'metallic_roughness',
              },
            },
          ],
        }),
      } as Response);

      await useGenerationStore.getState().hydrateFromServer();

      const jobs = Object.values(useGenerationStore.getState().jobs);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].autoPlace).toBe(true);
      expect(jobs[0].targetEntityId).toBe('entity-restored');
      expect(jobs[0].materialSlot).toBe('metallic_roughness');
    });

    it('should handle missing parameters key during hydration gracefully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 'srv-3',
              providerJobId: 'prov-3',
              provider: 'meshy',
              type: 'model',
              prompt: 'A tree',
              status: 'processing',
              progress: 10,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
              // no parameters field
            },
          ],
        }),
      } as Response);

      await useGenerationStore.getState().hydrateFromServer();

      const jobs = Object.values(useGenerationStore.getState().jobs);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].autoPlace).toBeUndefined();
      expect(jobs[0].targetEntityId).toBeUndefined();
      expect(jobs[0].materialSlot).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle all generation types', () => {
      const { addJob } = useGenerationStore.getState();

      const types = ['model', 'texture', 'sfx', 'voice', 'skybox', 'music', 'sprite', 'sprite_sheet', 'tileset'] as const;

      types.forEach((type, index) => {
        addJob({ ...mockJob, id: `job${index}`, type });
      });

      const state = useGenerationStore.getState();
      expect(Object.keys(state.jobs)).toHaveLength(types.length);
    });

    it('should handle job with metadata', () => {
      const { addJob } = useGenerationStore.getState();

      const jobWithMetadata = {
        ...mockJob,
        metadata: {
          width: 1024,
          height: 1024,
          format: 'png',
        },
      };

      addJob(jobWithMetadata);

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].metadata).toEqual({
        width: 1024,
        height: 1024,
        format: 'png',
      });
    });

    it('should handle job with entityId', () => {
      const { addJob } = useGenerationStore.getState();

      const jobWithEntity = {
        ...mockJob,
        entityId: 'entity-789',
      };

      addJob(jobWithEntity);

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].entityId).toBe('entity-789');
    });

    it('should handle job with error', () => {
      const { addJob, updateJob } = useGenerationStore.getState();

      addJob(mockJob);
      updateJob('client-123', { status: 'failed', error: 'API timeout' });

      const state = useGenerationStore.getState();
      expect(state.jobs['client-123'].status).toBe('failed');
      expect(state.jobs['client-123'].error).toBe('API timeout');
    });
  });

  describe('Server Persistence', () => {
    it('should POST to /api/jobs when adding a job', async () => {
      const { addJob } = useGenerationStore.getState();
      addJob(mockJob);

      const fetchMock = vi.mocked(fetch);
      await vi.waitFor(() => {
        const postCalls = fetchMock.mock.calls.filter(
          (c) => c[0] === '/api/jobs' && (c[1] as RequestInit)?.method === 'POST'
        );
        expect(postCalls).toHaveLength(1);
      });
    });

    it('should store dbId after server responds', async () => {
      const { addJob } = useGenerationStore.getState();
      addJob(mockJob);

      await vi.waitFor(() => {
        const state = useGenerationStore.getState();
        expect(state.jobs['client-123'].dbId).toBe('db-1');
      });
    });

    it('should PATCH status to server when dbId exists', async () => {
      useGenerationStore.setState({
        jobs: { 'client-123': { ...mockJob, dbId: 'db-xyz' } },
      });

      useGenerationStore.getState().updateJob('client-123', { status: 'completed', progress: 100 });

      const fetchMock = vi.mocked(fetch);
      await vi.waitFor(() => {
        const patchCalls = fetchMock.mock.calls.filter(
          (c) => c[0] === '/api/jobs/db-xyz' && (c[1] as RequestInit)?.method === 'PATCH'
        );
        expect(patchCalls).toHaveLength(1);
      });
    });
  });

  describe('hydrateFromServer', () => {
    it('should restore active jobs from server', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 'srv-1',
              providerJobId: 'prov-1',
              provider: 'meshy',
              type: 'model',
              prompt: 'A castle',
              status: 'processing',
              progress: 40,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:01:00Z',
            },
          ],
        }),
      } as Response);

      await useGenerationStore.getState().hydrateFromServer();

      const state = useGenerationStore.getState();
      const jobs = Object.values(state.jobs);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].prompt).toBe('A castle');
      expect(jobs[0].dbId).toBe('srv-1');
      expect(state.hydrated).toBe(true);
    });

    it('marks a webhook-finished terminal row for completion sync and records the durability flag (#8892)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          durableCompletionEnabled: true,
          jobs: [
            {
              id: 'srv-done', providerJobId: 'prov-done', provider: 'meshy', type: 'model',
              prompt: 'A tower', status: 'completed', progress: 100, imported: false,
              parameters: { durable: true }, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:01:00Z',
            },
            {
              id: 'srv-failed', providerJobId: 'prov-failed', provider: 'meshy', type: 'model',
              prompt: 'A moat', status: 'failed', progress: 0, imported: false,
              parameters: { durable: true }, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:01:00Z',
            },
            {
              id: 'srv-live', providerJobId: 'prov-live', provider: 'meshy', type: 'model',
              prompt: 'A gate', status: 'processing', progress: 40,
              parameters: { durable: true }, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:01:00Z',
            },
          ],
        }),
      } as Response);

      await useGenerationStore.getState().hydrateFromServer();

      const state = useGenerationStore.getState();
      expect(state.durableCompletionEnabled).toBe(true);
      // Hydrated already 'downloading' — the state the completion sync puts it
      // in — so the status indicator never flips completed -> downloading.
      expect(state.jobs['hydrated_srv-done']).toEqual(expect.objectContaining({ status: 'downloading', needsCompletionSync: true, dbId: 'srv-done' }));
      expect(state.jobs['hydrated_srv-failed']).toEqual(expect.objectContaining({ status: 'failed', needsCompletionSync: true }));
      // A live job is polled, not synced: the key is absent, not false.
      expect(state.jobs['hydrated_srv-live']).not.toHaveProperty('needsCompletionSync');
    });

    it('leaves durableCompletionEnabled false when the server omits it', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [] }) } as Response);
      await useGenerationStore.getState().hydrateFromServer();
      expect(useGenerationStore.getState().durableCompletionEnabled).toBe(false);
    });

    it('should set hydrated=true when no active jobs', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jobs: [] }),
      } as Response);

      await useGenerationStore.getState().hydrateFromServer();
      expect(useGenerationStore.getState().hydrated).toBe(true);
    });

    it('should set hydrated=true on network error', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      await useGenerationStore.getState().hydrateFromServer();
      expect(useGenerationStore.getState().hydrated).toBe(true);
    });

    it('should merge hydrated jobs with existing in-memory jobs', async () => {
      // Add in-memory job first
      useGenerationStore.setState({
        jobs: { 'local-1': { ...mockJob, id: 'local-1' } },
      });

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 'srv-1',
              providerJobId: 'prov-1',
              provider: 'meshy',
              type: 'texture',
              prompt: 'Wood texture',
              status: 'pending',
              progress: 0,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      } as Response);

      await useGenerationStore.getState().hydrateFromServer();

      const jobs = useGenerationStore.getState().jobs;
      expect(Object.keys(jobs)).toHaveLength(2);
      expect(jobs['local-1']).toEqual(expect.objectContaining({ id: 'local-1' }));
    });
  });

  // ---------------------------------------------------------------------------
  // Regression tests for #7489 — HTTP errors swallowed in fire-and-forget fetches
  // ---------------------------------------------------------------------------
  describe('HTTP error handling in fire-and-forget fetches (#7489)', () => {
    it('captures exception when POST /api/jobs returns non-ok status', async () => {
      const sentryClient = await import('@/lib/monitoring/sentry-client');
      const captureException = vi.mocked(sentryClient.captureException);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'db error' }),
      } as Response);

      const { addJob } = useGenerationStore.getState();
      addJob(mockJob);

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('POST /api/jobs failed: 500') }),
          expect.objectContaining({ context: 'generationStore.addJob', jobId: 'client-123' }),
        );
      });
    });

    it('does not store dbId when server responds with non-ok status (regression for #7489)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
      } as Response);

      const { addJob } = useGenerationStore.getState();
      addJob(mockJob);

      // Wait for the fetch promise chain to settle (an error was thrown, no dbId stored)
      await vi.waitFor(() => {
        const state = useGenerationStore.getState();
        // The job should exist but never have a dbId set (server rejected)
        expect(state.jobs['client-123']).toBeDefined();
        expect(state.jobs['client-123'].dbId).toBeUndefined();
      });
    });

    it('captures exception when PATCH /api/jobs/:id returns non-ok status', async () => {
      const sentryClient = await import('@/lib/monitoring/sentry-client');
      const captureException = vi.mocked(sentryClient.captureException);

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      useGenerationStore.setState({
        jobs: { 'client-123': { ...mockJob, dbId: 'db-xyz' } },
      });

      useGenerationStore.getState().updateJob('client-123', { status: 'completed', progress: 100 });

      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('PATCH /api/jobs/db-xyz failed: 503'),
          }),
          expect.objectContaining({ context: 'generationStore.updateJob', dbId: 'db-xyz' }),
        );
      });
    });
  });
  describe('inline sprite persistence', () => {
    const resultUrl = 'data:image/png;base64,' + 'A'.repeat(4096);
    it('persists inline results and removal outcomes in the initial record', () => {
      useGenerationStore.getState().addJob({ ...mockJob, jobId: 'dalle3-sync:usage-1', type: 'sprite', resultUrl, metadata: { backgroundRemoval: 'removed' } });
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
      expect(body.resultUrl).toBe(resultUrl);
      expect(body.parameters.metadata).toEqual({ backgroundRemoval: 'removed' });
    });
    it.each(['pending', 'processing', 'downloading'])('restores %s synchronous results as pending imports', async (status) => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [{ id: 'sync-db', providerJobId: 'dalle3-sync:usage-1', provider: 'dalle3', type: 'sprite', prompt: 'hero', status, progress: 0, createdAt: '2026-09-16T00:00:00Z', hasInlineResult: true, parameters: { metadata: { backgroundRemoval: 'removed' } } }] }) } as Response);
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ resultUrl }) } as Response);
      await useGenerationStore.getState().hydrateFromServer();
      expect(fetch).toHaveBeenCalledWith('/api/jobs/sync-db');
      expect(useGenerationStore.getState().jobs['hydrated_sync-db']).toEqual(expect.objectContaining({ status: 'pending', resultUrl, metadata: { backgroundRemoval: 'removed' } }));
    });
    it('syncs completion that finishes before creation supplies the database id', async () => {
      let finish!: (response: Response) => void;
      vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      useGenerationStore.getState().addJob({ ...mockJob, resultUrl });
      useGenerationStore.getState().updateJob(mockJob.id, { status: 'completed', progress: 100, resultUrl });
      finish({ ok: true, json: async () => ({ job: { id: 'late-db' } }) } as Response);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/jobs/late-db', expect.objectContaining({ method: 'PATCH' })));
      expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual(expect.objectContaining({ status: 'completed', progress: 100, resultUrl, imported: true }));
    });
  });

  it('resumes unrelated jobs when one saved inline artifact cannot be restored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [
      { id: 'missing-image', providerJobId: 'dalle3-sync:missing', type: 'sprite', provider: 'dalle3', status: 'downloading', progress: 100, prompt: 'hero', createdAt: '2026-09-16T00:00:00Z', hasInlineResult: true },
      { id: 'async', providerJobId: 'sdxl-prediction', type: 'sprite', provider: 'sdxl', status: 'processing', progress: 30, prompt: 'terrain', createdAt: '2026-09-16T00:00:00Z' },
    ] }) } as Response);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await useGenerationStore.getState().hydrateFromServer();
    expect(useGenerationStore.getState().jobs['hydrated_async']).toEqual(expect.objectContaining({ status: 'processing', jobId: 'sdxl-prediction' }));
    expect(useGenerationStore.getState().jobs['hydrated_missing-image']).toBeUndefined();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('Refresh to retry'));
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { context: 'generationStore.restoreArtifact', dbId: 'missing-image' });
  });

});
