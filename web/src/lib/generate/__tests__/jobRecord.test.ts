import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(),
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
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
  eq: vi.fn((col: string, val: unknown) => ({ op: 'eq', col, val })),
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  notInArray: vi.fn((col: string, vals: unknown[]) => ({ op: 'notInArray', col, vals })),
}));

import { createJobRecord, updateJobStatus, updateJobStatusByProviderJob } from '../jobRecord';
import { getDb } from '@/lib/db/client';
import { and, eq, notInArray } from 'drizzle-orm';

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
  } as unknown as ReturnType<typeof getDb>);
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

describe('updateJobStatusByProviderJob', () => {
  it('guards the WHERE on owner + provider job id + non-terminal status', async () => {
    await updateJobStatusByProviderJob('meshy-abc', 'user-1', {
      status: 'completed',
      resultUrl: 'https://example.com/model.glb',
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);

    // Cross-tenant guard: BOTH the provider job id AND the owner must match,
    // so a forged callback cannot finalize another user's row.
    expect(vi.mocked(eq)).toHaveBeenCalledWith('providerJobId', 'meshy-abc');
    expect(vi.mocked(eq)).toHaveBeenCalledWith('userId', 'user-1');

    // Idempotency guard: the update must NEVER clobber an already-terminal row
    // (a live client may have imported the result first). The excluded set must
    // be exactly the three terminal states — note 'cancelled' (two l's).
    expect(vi.mocked(notInArray)).toHaveBeenCalledWith('status', ['completed', 'failed', 'cancelled']);

    // All three predicates are AND-ed into a single WHERE.
    expect(vi.mocked(and)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(and).mock.calls[0]).toHaveLength(3);
  });

  it('sets completedAt for a terminal (failed) finalize', async () => {
    await updateJobStatusByProviderJob('job', 'user-1', { status: 'failed', errorMessage: 'boom' });
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.status).toBe('failed');
    expect(setArg.errorMessage).toBe('boom');
    expect(setArg.completedAt).toBeInstanceOf(Date);
  });

  it('does NOT set completedAt for a non-terminal (processing) re-arm update', async () => {
    await updateJobStatusByProviderJob('job', 'user-1', { status: 'processing', progress: 50 });
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.status).toBe('processing');
    expect(setArg.progress).toBe(50);
    expect(setArg.completedAt).toBeUndefined();
  });
});
