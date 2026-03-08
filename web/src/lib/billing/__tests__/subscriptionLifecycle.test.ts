import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the DB before importing the module
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
  })),
}));

vi.mock('@/lib/db/schema', () => ({
  users: {},
  creditTransactions: {},
  processedWebhookEvents: { eventId: 'event_id' },
}));

vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 100, hobbyist: 500, creator: 2000, pro: 10000 },
}));

vi.mock('@/lib/auth/user-service', () => ({
  updateUserTier: vi.fn(),
}));

describe('subscription-lifecycle idempotency', () => {
  let isEventProcessed: typeof import('../subscription-lifecycle').isEventProcessed;
  let markEventProcessed: typeof import('../subscription-lifecycle').markEventProcessed;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Chain: select() -> from() -> where() -> limit() -> result
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });

    // Chain: insert() -> values() -> onConflictDoNothing()
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });

    const mod = await import('../subscription-lifecycle');
    isEventProcessed = mod.isEventProcessed;
    markEventProcessed = mod.markEventProcessed;
  });

  it('should return false for unprocessed events', async () => {
    mockLimit.mockResolvedValue([]);
    expect(await isEventProcessed('evt_123')).toBe(false);
  });

  it('should return true for already-processed events', async () => {
    mockLimit.mockResolvedValue([{ eventId: 'evt_456' }]);
    expect(await isEventProcessed('evt_456')).toBe(true);
  });

  it('should insert into DB when marking an event', async () => {
    mockOnConflictDoNothing.mockResolvedValue(undefined);
    await markEventProcessed('evt_789');
    expect(mockValues).toHaveBeenCalledWith({ eventId: 'evt_789' });
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
  });

  it('should be safe to mark the same event twice (ON CONFLICT DO NOTHING)', async () => {
    mockOnConflictDoNothing.mockResolvedValue(undefined);
    await markEventProcessed('evt_same');
    await markEventProcessed('evt_same');
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});
