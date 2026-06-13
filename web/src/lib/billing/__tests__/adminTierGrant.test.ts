/**
 * Unit tests for applyAdminTierChange — admin comp-tier token grant (#8744).
 *
 * STRUCTURE ONLY. This suite proves the call SHAPE: a single atomic
 * neonSql.transaction batching the tier/allocation UPDATE and the
 * `admin_tier_change` audit INSERT, with the right values interpolated
 * (new allocation, audit source, the optional `banned` param). It deliberately
 * does NOT assert SQL substrings beyond locating a statement — a query can
 * contain the right literals and still grant the wrong amount. The BEHAVIOUR
 * (absolute set to the new allocation, exactly one audit row, comped-from-zero
 * user ends spendable, banned folded atomically) is proven against real
 * Postgres in adminTierGrant.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockNeonTransaction = vi.fn().mockResolvedValue([]);
const mockNeonSqlCalls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
const mockNeonSql = Object.assign(
  vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
    mockNeonSqlCalls.push({ strings: _strings, values: _values });
    return Promise.resolve([]);
  }),
  { transaction: mockNeonTransaction },
);

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({})),
  getNeonSql: vi.fn(() => mockNeonSql),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/tokens/pricing', () => ({
  TIER_MONTHLY_TOKENS: { starter: 50, hobbyist: 300, creator: 1000, pro: 3000 },
}));

import { applyAdminTierChange } from '../admin-tier-grant';

function findUpdate() {
  return mockNeonSqlCalls.find((c) => c.strings.some((s) => s.includes('UPDATE users')));
}
function findInsert() {
  return mockNeonSqlCalls.find((c) =>
    c.strings.some((s) => s.includes('INSERT INTO credit_transactions')),
  );
}

describe('applyAdminTierChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeonSqlCalls.length = 0;
  });

  it('runs ONE atomic transaction batching the UPDATE and the audit INSERT', async () => {
    await applyAdminTierChange('user_1', 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    expect(mockNeonTransaction).toHaveBeenCalledOnce();
    expect(mockNeonTransaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('sets the new tier and its full monthly allocation on the user', async () => {
    await applyAdminTierChange('user_1', 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const update = findUpdate();
    expect(update).toBeDefined();
    expect(update!.values).toContain('pro'); // tier
    expect(update!.values).toContain(3000); // pro allocation (absolute set)
    expect(update!.values).toContain('user_1');
  });

  it('writes an admin_tier_change audit row for the granted allocation', async () => {
    await applyAdminTierChange('user_1', 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const insert = findInsert();
    expect(insert).toBeDefined();
    expect(insert!.values).toContain(3000); // amount = new allocation
    expect(insert!.values).toContain('admin_tier_change:starter->pro');
    // reference_id is `<clerkId>:<ISO timestamp>` — unique per admin action so a
    // repeated old->new change is never collapsed by the idempotency index.
    expect(
      insert!.values.some((v) => typeof v === 'string' && v.startsWith('clerk_admin:')),
    ).toBe(true);
  });

  it('passes null for banned when the option is omitted (preserves the column)', async () => {
    await applyAdminTierChange('user_1', 'creator', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
    });

    const update = findUpdate();
    expect(update!.values).toContain(1000); // creator allocation
    expect(update!.values).toContain(null); // banned COALESCE param
  });

  it('passes 1 for banned:true and 0 for banned:false (folded into the same UPDATE)', async () => {
    await applyAdminTierChange('user_1', 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
      banned: true,
    });
    expect(findUpdate()!.values).toContain(1);

    vi.clearAllMocks();
    mockNeonSqlCalls.length = 0;

    await applyAdminTierChange('user_1', 'pro', {
      previousTier: 'starter',
      grantedByClerkId: 'clerk_admin',
      banned: false,
    });
    expect(findUpdate()!.values).toContain(0);
  });
});
