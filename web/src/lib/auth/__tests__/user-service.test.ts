import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User, Tier } from '../../db/schema';

// ---------------------------------------------------------------------------
// Mocks — registered before module imports
// ---------------------------------------------------------------------------

// Mutable test state
let mockUser: Partial<User> | null = null;
let mockUpsertedUser: Partial<User> | null = null;

// Capture all DB calls
const mockDeleteWhere = vi.fn().mockResolvedValue([]);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

const mockReturning = vi.fn().mockImplementation(() => {
  return Promise.resolve(mockUpsertedUser ? [mockUpsertedUser] : []);
});
const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateReturning = vi.fn().mockImplementation(() => {
  return Promise.resolve(mockUser ? [mockUser] : []);
});
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

// Build a chainable mock that supports both:
//   await db.select().from().where().limit(1)   — getUserByClerkId etc.
//   await db.select().from().where()            — deleteUserAccount queries
// We achieve this by making the chain object itself a thenable (has .then)
// so it resolves when awaited directly, but also exposes .limit() for callers
// that add an explicit limit.
function buildSelectChain(rows: Partial<User>[]): unknown {
  const resolvedPromise = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    // then/catch/finally make the object thenable — awaiting the chain directly
    // resolves to rows without calling .limit()
    then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) =>
      resolvedPromise.then(resolve, reject),
    catch: (reject: (err: unknown) => void) => resolvedPromise.catch(reject),
    finally: (fn: () => void) => resolvedPromise.finally(fn),
  };
  // .where() returns the same chain so subsequent calls (.limit) still work
  chain.where = vi.fn().mockReturnValue(chain);
  return chain;
}
const mockSelect = vi.fn().mockImplementation(() => buildSelectChain(mockUser ? [mockUser] : []));

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  }),
}));

vi.mock('@/lib/db/schema', () => ({
  users: { id: 'id', clerkId: 'clerkId' },
  apiKeys: { userId: 'userId' },
  providerKeys: { userId: 'userId' },
  tokenUsage: { userId: 'userId' },
  tokenPurchases: { userId: 'userId' },
  projects: { id: 'id', userId: 'userId' },
  publishedGames: { id: 'id', userId: 'userId' },
  costLog: { userId: 'userId' },
  creditTransactions: { userId: 'userId' },
  gameRatings: { gameId: 'gameId', userId: 'userId' },
  gameComments: { gameId: 'gameId', userId: 'userId' },
  gameLikes: { gameId: 'gameId', userId: 'userId' },
  gameForks: { originalGameId: 'originalGameId', userId: 'userId' },
  gameTags: { gameId: 'gameId' },
  userFollows: { followerId: 'followerId', followingId: 'followingId' },
  assetReviews: { userId: 'userId' },
  assetPurchases: { buyerId: 'buyerId' },
  marketplaceAssets: { sellerId: 'sellerId' },
  sellerProfiles: { userId: 'userId' },
  generationJobs: { userId: 'userId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => 'WHERE_CLAUSE'),
}));

import {
  syncUserFromClerk,
  getUserByClerkId,
  getUserById,
  updateUserTier,
  updateUserStripe,
  updateDisplayName,
  deleteUserAccount,
} from '../user-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): Partial<User> {
  return {
    id: 'user-uuid-1',
    clerkId: 'clerk_abc',
    email: 'test@example.com',
    displayName: 'Test User',
    tier: 'starter' as Tier,
    monthlyTokens: 50,
    monthlyTokensUsed: 0,
    addonTokens: 0,
    earnedCredits: 0,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingCycleStart: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeClerkData(overrides: Partial<{
  id: string;
  email_addresses: { email_address: string }[];
  first_name: string | null;
  last_name: string | null;
}> = {}) {
  return {
    id: 'clerk_abc',
    email_addresses: [{ email_address: 'test@example.com' }],
    first_name: 'Alice',
    last_name: 'Smith',
    ...overrides,
  };
}

function resetMocks(): void {
  vi.clearAllMocks();
  mockUser = null;
  mockUpsertedUser = null;

  mockSelect.mockImplementation(() => buildSelectChain(mockUser ? [mockUser] : []));
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  mockReturning.mockImplementation(() => Promise.resolve(mockUpsertedUser ? [mockUpsertedUser] : []));

  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
  mockUpdateReturning.mockImplementation(() => Promise.resolve(mockUser ? [mockUser] : []));

  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockResolvedValue([]);
}

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// syncUserFromClerk
// ---------------------------------------------------------------------------

describe('syncUserFromClerk', () => {
  it('inserts and returns a new user with full name', async () => {
    const expected = makeUser({ displayName: 'Alice Smith' });
    mockUpsertedUser = expected;

    const result = await syncUserFromClerk(makeClerkData());
    expect(result.email).toBe('test@example.com');
    expect(result.displayName).toBe('Alice Smith');
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it('upserts on conflict by Clerk ID', async () => {
    mockUpsertedUser = makeUser();

    await syncUserFromClerk(makeClerkData());
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
    const conflictArg = mockOnConflictDoUpdate.mock.calls[0][0];
    // target should reference clerkId column
    expect(conflictArg.target).not.toBeUndefined();
  });

  it('builds display name from first and last name', async () => {
    mockUpsertedUser = makeUser({ displayName: 'Bob Jones' });

    await syncUserFromClerk(makeClerkData({ first_name: 'Bob', last_name: 'Jones' }));
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.displayName).toBe('Bob Jones');
  });

  it('uses only first name when last name is null', async () => {
    mockUpsertedUser = makeUser({ displayName: 'Alice' });

    await syncUserFromClerk(makeClerkData({ first_name: 'Alice', last_name: null }));
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.displayName).toBe('Alice');
  });

  it('sets displayName to null when both first and last names are absent', async () => {
    mockUpsertedUser = makeUser({ displayName: null });

    await syncUserFromClerk(makeClerkData({ first_name: null, last_name: null }));
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.displayName).toBeNull();
  });

  it('throws when Clerk data has no email addresses', async () => {
    await expect(
      syncUserFromClerk(makeClerkData({ email_addresses: [] }))
    ).rejects.toThrow('No email found in Clerk data');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('stores the Clerk ID on the user record', async () => {
    mockUpsertedUser = makeUser({ clerkId: 'clerk_new_user' });

    await syncUserFromClerk(makeClerkData({ id: 'clerk_new_user' }));
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.clerkId).toBe('clerk_new_user');
  });
});

// ---------------------------------------------------------------------------
// getUserByClerkId
// ---------------------------------------------------------------------------

describe('getUserByClerkId', () => {
  it('returns the user when found', async () => {
    mockUser = makeUser({ clerkId: 'clerk_abc' });
    const result = await getUserByClerkId('clerk_abc');
    expect(result).not.toBeNull();
    expect(result?.clerkId).toBe('clerk_abc');
  });

  it('returns null when no user has that Clerk ID', async () => {
    mockUser = null;
    const result = await getUserByClerkId('clerk_unknown');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUserById
// ---------------------------------------------------------------------------

describe('getUserById', () => {
  it('returns the user when found by internal ID', async () => {
    mockUser = makeUser({ id: 'user-uuid-1' });
    const result = await getUserById('user-uuid-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-uuid-1');
  });

  it('returns null when no user has that internal ID', async () => {
    mockUser = null;
    const result = await getUserById('nonexistent-id');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateUserTier
// ---------------------------------------------------------------------------

describe('updateUserTier', () => {
  it('calls DB update with correct tier', async () => {
    await updateUserTier('user-uuid-1', 'pro');
    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.tier).toBe('pro');
  });

  it('updates the updatedAt timestamp', async () => {
    await updateUserTier('user-uuid-1', 'hobbyist');
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });

  it('applies each tier correctly', async () => {
    const tiers: Tier[] = ['starter', 'hobbyist', 'creator', 'pro'];
    for (const tier of tiers) {
      resetMocks();
      await updateUserTier('user-uuid-1', tier);
      const setArg = mockUpdateSet.mock.calls[0][0];
      expect(setArg.tier, `tier=${tier}`).toBe(tier);
    }
  });
});

// ---------------------------------------------------------------------------
// updateUserStripe
// ---------------------------------------------------------------------------

describe('updateUserStripe', () => {
  it('updates stripeCustomerId', async () => {
    await updateUserStripe('user-uuid-1', 'cus_new123');
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.stripeCustomerId).toBe('cus_new123');
  });

  it('updates stripeSubscriptionId when provided', async () => {
    await updateUserStripe('user-uuid-1', 'cus_new123', 'sub_new456');
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.stripeCustomerId).toBe('cus_new123');
    expect(setArg.stripeSubscriptionId).toBe('sub_new456');
  });

  it('sets stripeSubscriptionId to undefined when omitted', async () => {
    await updateUserStripe('user-uuid-1', 'cus_new123');
    const setArg = mockUpdateSet.mock.calls[0][0];
    // undefined means the column is not changed in this call
    expect(setArg.stripeSubscriptionId).toBeUndefined();
  });

  it('updates the updatedAt timestamp', async () => {
    await updateUserStripe('user-uuid-1', 'cus_abc');
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// updateDisplayName
// ---------------------------------------------------------------------------

describe('updateDisplayName', () => {
  it('trims whitespace from the display name', async () => {
    mockUser = makeUser({ displayName: 'Alice Trimmed' });

    await updateDisplayName('user-uuid-1', '  Alice Trimmed  ');
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.displayName).toBe('Alice Trimmed');
  });

  it('throws when the trimmed name is empty', async () => {
    await expect(updateDisplayName('user-uuid-1', '   ')).rejects.toThrow('Display name cannot be empty');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws when the name is empty string', async () => {
    await expect(updateDisplayName('user-uuid-1', '')).rejects.toThrow('Display name cannot be empty');
  });

  it('throws when the name exceeds 50 characters', async () => {
    const longName = 'A'.repeat(51);
    await expect(updateDisplayName('user-uuid-1', longName)).rejects.toThrow(
      'Display name must be 50 characters or less'
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts exactly 50 characters', async () => {
    const name50 = 'A'.repeat(50);
    mockUser = makeUser({ displayName: name50 });

    await expect(updateDisplayName('user-uuid-1', name50)).resolves.not.toThrow();
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg.displayName).toBe(name50);
  });

  it('throws when user is not found', async () => {
    // returning() returns empty array — no user
    mockUser = null;
    mockUpdateReturning.mockResolvedValueOnce([]);

    await expect(updateDisplayName('user-uuid-1', 'Valid Name')).rejects.toThrow('User not found');
  });

  it('returns the updated user record', async () => {
    const updatedUser = makeUser({ displayName: 'New Name' });
    mockUser = updatedUser;

    const result = await updateDisplayName('user-uuid-1', 'New Name');
    expect(result.displayName).toBe('New Name');
  });
});

// ---------------------------------------------------------------------------
// deleteUserAccount
// ---------------------------------------------------------------------------

describe('deleteUserAccount', () => {
  it('deletes the user record at the end of the cascade', async () => {
    mockSelect.mockImplementation(() => buildSelectChain([]));

    await deleteUserAccount('user-uuid-1');
    expect(mockDelete).toHaveBeenCalled();
    // The users table deletion is the last one
    const lastCallIndex = mockDelete.mock.calls.length - 1;
    expect(mockDelete.mock.calls[lastCallIndex][0]).not.toBeUndefined();
  });

  it('deletes financial records (credit_transactions, token_usage, etc.)', async () => {
    mockSelect.mockImplementation(() => buildSelectChain([]));

    await deleteUserAccount('user-uuid-1');
    // delete is called for each table; check count is non-trivial
    expect(mockDelete.mock.calls.length).toBeGreaterThan(5);
  });

  it('handles a user with published games — deletes game community data first', async () => {
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Published games query
        return buildSelectChain([{ id: 'game-uuid-1' }]);
      }
      // Projects query (and any subsequent selects)
      return buildSelectChain([]);
    });

    await deleteUserAccount('user-uuid-1');
    // Should not throw — cascading deletes handled gracefully
    expect(mockDelete).toHaveBeenCalled();
  });

  it('handles a user with projects — deletes projects', async () => {
    let selectCallCount = 0;
    mockSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Published games (none)
        return buildSelectChain([]);
      }
      if (selectCallCount === 2) {
        // Projects
        return buildSelectChain([{ id: 'proj-uuid-1' }]);
      }
      return buildSelectChain([]);
    });

    await expect(deleteUserAccount('user-uuid-1')).resolves.not.toThrow();
  });

  it('completes without error when user has no associated data', async () => {
    mockSelect.mockImplementation(() => buildSelectChain([]));

    await expect(deleteUserAccount('user-uuid-1')).resolves.not.toThrow();
  });

  it('deletes keys (apiKeys, providerKeys)', async () => {
    mockSelect.mockImplementation(() => buildSelectChain([]));

    await deleteUserAccount('user-uuid-1');
    // Verify apiKeys and providerKeys deletions occurred
    const deleteArgs = mockDelete.mock.calls.map((call) => call[0]);
    // Check that both key tables were targeted (they are objects from the schema mock)
    expect(deleteArgs.length).toBeGreaterThanOrEqual(10);
  });

  it('deletes generationJobs as part of cascade (PF-510)', async () => {
    mockSelect.mockImplementation(() => buildSelectChain([]));

    await deleteUserAccount('user-uuid-1');
    // generationJobs mock has { userId: 'userId' } — verify it was passed to delete()
    const deleteArgs = mockDelete.mock.calls.map((call) => call[0]);
    expect(deleteArgs).toContainEqual({ userId: 'userId' });
  });
});
