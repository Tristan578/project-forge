import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/db/schema', () => ({
  generationJobs: {
    id: 'id',
    userId: 'userId',
    projectId: 'projectId',
    provider: 'provider',
    providerJobId: 'providerJobId',
    type: 'type',
    prompt: 'prompt',
    parameters: 'parameters',
    tokenCost: 'tokenCost',
    tokenUsageId: 'tokenUsageId',
    entityId: 'entityId',
    status: 'status',
    progress: 'progress',
    resultUrl: 'resultUrl',
    resultMeta: 'resultMeta',
    errorMessage: 'errorMessage',
    completedAt: 'completedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => ({ col, val })),
}));

import { createJobRecord, updateJobStatus } from '../jobRecord';
import { getDb } from '@/lib/db/client';

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockReturning.mockResolvedValue([{ id: 'job-123' }]);
  mockValues.mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValue({ values: mockValues });
  mockWhere.mockResolvedValue(undefined);
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });

  vi.mocked(getDb).mockReturnValue({
    insert: mockInsert,
    update: mockUpdate,
  } as ReturnType<typeof getDb>);
});

describe('createJobRecord', () => {
  it('inserts a job record and returns the ID', async () => {
    const result = await createJobRecord({
      userId: 'user-1',
      provider: 'meshy',
      providerJobId: 'meshy-abc',
      type: 'model',
      prompt: 'a red dragon',
      tokenCost: 50,
    });

    expect(result).toBe('job-123');
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        provider: 'meshy',
        providerJobId: 'meshy-abc',
        type: 'model',
        prompt: 'a red dragon',
        tokenCost: 50,
        projectId: null,
        tokenUsageId: null,
        entityId: null,
        parameters: {},
      }),
    );
  });

  it('passes optional fields when provided', async () => {
    await createJobRecord({
      userId: 'user-1',
      provider: 'elevenlabs',
      providerJobId: 'el-xyz',
      type: 'sfx',
      prompt: 'explosion',
      tokenCost: 10,
      projectId: 'proj-1',
      tokenUsageId: 'usage-1',
      entityId: 'entity-1',
      parameters: { duration: 3 },
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        tokenUsageId: 'usage-1',
        entityId: 'entity-1',
        parameters: { duration: 3 },
      }),
    );
  });
});

describe('updateJobStatus', () => {
  it('updates status to completed with completedAt', async () => {
    await updateJobStatus('job-123', {
      status: 'completed',
      resultUrl: 'https://example.com/model.glb',
    });

    expect(mockUpdate).toHaveBeenCalled();
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.status).toBe('completed');
    expect(setArg.resultUrl).toBe('https://example.com/model.glb');
    expect(setArg.completedAt).toBeInstanceOf(Date);
  });

  it('updates status to failed with error message and completedAt', async () => {
    await updateJobStatus('job-123', {
      status: 'failed',
      errorMessage: 'Provider timeout',
    });

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.status).toBe('failed');
    expect(setArg.errorMessage).toBe('Provider timeout');
    expect(setArg.completedAt).toBeInstanceOf(Date);
  });

  it('updates progress without completedAt for processing status', async () => {
    await updateJobStatus('job-123', {
      status: 'processing',
      progress: 50,
    });

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.status).toBe('processing');
    expect(setArg.progress).toBe(50);
    expect(setArg.completedAt).toBeUndefined();
  });

  it('only sets provided optional fields', async () => {
    await updateJobStatus('job-123', { status: 'processing' });

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.status).toBe('processing');
    expect(setArg.progress).toBeUndefined();
    expect(setArg.resultUrl).toBeUndefined();
    expect(setArg.resultMeta).toBeUndefined();
    expect(setArg.errorMessage).toBeUndefined();
  });

  it('sets resultMeta when provided', async () => {
    await updateJobStatus('job-123', {
      status: 'completed',
      resultMeta: { vertices: 5000, format: 'glb' },
    });

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.resultMeta).toEqual({ vertices: 5000, format: 'glb' });
  });
});
