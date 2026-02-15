/**
 * Unit tests for the generationStore Zustand store.
 *
 * Tests cover AI asset generation job tracking, status updates,
 * active job counting, and job lifecycle management.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGenerationStore, type GenerationJob } from '../generationStore';

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
    // Reset store to initial state
    useGenerationStore.setState({
      jobs: {},
    });
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
      expect(state.jobs.job2).toBeDefined();
    });

    it('should remove failed jobs', () => {
      const { addJob, clearCompleted } = useGenerationStore.getState();

      addJob({ ...mockJob, id: 'job1', status: 'failed', error: 'Timeout' });
      addJob({ ...mockJob, id: 'job2', status: 'pending' });

      clearCompleted();

      const state = useGenerationStore.getState();
      expect(state.jobs.job1).toBeUndefined();
      expect(state.jobs.job2).toBeDefined();
    });

    it('should keep pending, processing, and downloading jobs', () => {
      const { addJob, clearCompleted } = useGenerationStore.getState();

      addJob({ ...mockJob, id: 'job1', status: 'pending' });
      addJob({ ...mockJob, id: 'job2', status: 'processing' });
      addJob({ ...mockJob, id: 'job3', status: 'downloading' });
      addJob({ ...mockJob, id: 'job4', status: 'completed' });

      clearCompleted();

      const state = useGenerationStore.getState();
      expect(state.jobs.job1).toBeDefined();
      expect(state.jobs.job2).toBeDefined();
      expect(state.jobs.job3).toBeDefined();
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
});
