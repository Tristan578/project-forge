import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mocks ----------

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();

function resetChain() {
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([{ id: 'cost-log-id-1' }]);
}

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
  })),
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('@/lib/db/schema', () => ({
  costLog: {
    id: 'id',
    userId: 'user_id',
    actionType: 'action_type',
    provider: 'provider',
    actualCostCents: 'actual_cost_cents',
    tokensCharged: 'tokens_charged',
    requestMetadata: 'request_metadata',
    createdAt: 'created_at',
  },
}));

// ---------- Tests ----------

describe('logCost', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetChain();
  });

  it('logs a cost event and returns the record id', async () => {
    const { logCost } = await import('../costLogger');

    const id = await logCost('user-1', 'texture_generation', 'meshy', 50, 30);

    expect(id).toBe('cost-log-id-1');
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);
  });

  it('passes correct values to the insert', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-2', '3d_generation', 'hyper3d', 200, 100, { quality: 'high' });

    expect(mockValues).toHaveBeenCalledWith({
      userId: 'user-2',
      actionType: '3d_generation',
      provider: 'hyper3d',
      actualCostCents: 200,
      tokensCharged: 100,
      requestMetadata: { quality: 'high' },
    });
  });

  it('sets null for provider when not provided', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-1', 'chat_message', null, null, 5);

    expect(mockValues).toHaveBeenCalledWith({
      userId: 'user-1',
      actionType: 'chat_message',
      provider: null,
      actualCostCents: null,
      tokensCharged: 5,
      requestMetadata: null,
    });
  });

  it('defaults metadata to null when not provided', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-1', 'voice_generation', 'elevenlabs', 10, 40);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ requestMetadata: null })
    );
  });

  it('handles zero cost and zero tokens', async () => {
    const { logCost } = await import('../costLogger');

    const id = await logCost('user-1', 'free_op', null, 0, 0);

    expect(id).toBe('cost-log-id-1');
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actualCostCents: 0,
        tokensCharged: 0,
      })
    );
  });

  it('handles complex metadata objects', async () => {
    const { logCost } = await import('../costLogger');

    const metadata = {
      prompt: 'a red dragon',
      modelVersion: 'v3',
      duration: 12.5,
      nested: { key: 'value' },
    };

    await logCost('user-1', 'music_generation', 'suno', 300, 80, metadata);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ requestMetadata: metadata })
    );
  });

  it('returns different IDs for sequential calls', async () => {
    const { logCost } = await import('../costLogger');

    mockReturning.mockResolvedValueOnce([{ id: 'cost-1' }]);
    mockReturning.mockResolvedValueOnce([{ id: 'cost-2' }]);

    const id1 = await logCost('user-1', 'op1', null, 10, 5);
    const id2 = await logCost('user-1', 'op2', null, 20, 10);

    expect(id1).toBe('cost-1');
    expect(id2).toBe('cost-2');
  });

  it('handles null actualCostCents', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-1', 'sfx_generation', 'elevenlabs', null, 20);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostCents: null })
    );
  });

  it('accepts large token values', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-1', 'compound_scene_complex', 'anthropic', 5000, 300);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tokensCharged: 300,
        actualCostCents: 5000,
      })
    );
  });

  it('accepts empty metadata object', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-1', 'test', null, 0, 0, {});

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ requestMetadata: {} })
    );
  });

  it('calls returning to get the inserted record id', async () => {
    const { logCost } = await import('../costLogger');

    await logCost('user-1', 'op', null, 10, 5);

    expect(mockReturning).toHaveBeenCalledWith({ id: 'id' });
  });
});
