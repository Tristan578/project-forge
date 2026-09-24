/**
 * grantTrialTokens (PF-174 / #7715): the one-time signup grant.
 *
 * These tests assert the SHAPE of the single statement the function emits —
 * one tagged-template call, the trial constant, the `trial_grant` source, the
 * load-bearing `::uuid` casts, the `NOT EXISTS` guard and the `ON CONFLICT ...
 * DO NOTHING` arbiter. They deliberately do NOT fake "no-op on second call" by
 * mocking the template's return value: the function ignores the result, and
 * exactly-once is a property of the emitted SQL plus the partial unique index
 * `idx_credit_txn_idempotent` (drizzle/0002), not of a JavaScript branch.
 */
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

const neonCalls: { strings: TemplateStringsArray; values: unknown[] }[] = [];
const mockNeonSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
  neonCalls.push({ strings, values });
  return Promise.resolve([]);
});
const mockQueryWithResilience = vi.fn((fn: () => Promise<unknown>) => fn());

vi.mock('@/lib/db/client', () => ({
  getNeonSql: vi.fn(() => mockNeonSql),
  queryWithResilience: (fn: () => Promise<unknown>) => mockQueryWithResilience(fn),
}));

import { grantTrialTokens } from '../trial-grant';
import { TRIAL_GRANT_TOKENS, TIER_MONTHLY_TOKENS } from '@/lib/tokens/pricing';

/** Re-join a tagged-template call into readable SQL with `$n` placeholders. */
function renderSql(call: { strings: TemplateStringsArray; values: unknown[] }): string {
  return call.strings.reduce((acc, part, i) => acc + part + (i < call.values.length ? `$${i + 1}` : ''), '');
}

/** Collapse whitespace so assertions are layout-independent. */
function squash(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const USER_ID = '11111111-2222-4333-8444-555555555555';

describe('grantTrialTokens', () => {
  beforeEach(() => {
    neonCalls.length = 0;
    mockNeonSql.mockClear();
    mockQueryWithResilience.mockClear();
  });

  it('issues exactly one statement, through queryWithResilience', async () => {
    await grantTrialTokens(USER_ID);
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
    expect(mockQueryWithResilience).toHaveBeenCalledTimes(1);
  });

  it('grants TRIAL_GRANT_TOKENS, which is its own constant and not the paid starter allocation', async () => {
    await grantTrialTokens(USER_ID);
    const { values } = neonCalls[0];
    // The amount, the balance_after addend and the monthly_tokens SET all carry
    // the trial constant — three occurrences, so a future edit to one site
    // cannot drift from the others.
    expect(values.filter((v) => v === TRIAL_GRANT_TOKENS)).toHaveLength(3);
    expect(TRIAL_GRANT_TOKENS).toBe(50);
    // Same number today, but distinct symbols: repricing the paid tier must
    // not silently change the trial.
    expect(Object.keys(TIER_MONTHLY_TOKENS)).toContain('starter');
  });

  it('writes the audit row with source trial_grant and reference_id = the user id', async () => {
    await grantTrialTokens(USER_ID);
    const sql = squash(renderSql(neonCalls[0]));
    expect(sql).toContain("INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, source, reference_id)");
    expect(sql).toContain("'monthly_grant'");
    expect(sql).toContain("'trial_grant'");
    // reference_id is the user id, uncast (a text column); every other
    // occurrence of the id is cast.
    const idPositions = neonCalls[0].values
      .map((v, i) => (v === USER_ID ? i + 1 : 0))
      .filter((n) => n > 0);
    expect(idPositions.length).toBeGreaterThanOrEqual(5);
  });

  it('casts the user id to uuid at every comparison against a uuid column (load-bearing under neon-http)', async () => {
    await grantTrialTokens(USER_ID);
    const sql = squash(renderSql(neonCalls[0]));
    const { values } = neonCalls[0];
    // Every `$n::uuid` in the text must be bound to the user id.
    const castPlaceholders = [...sql.matchAll(/\$(\d+)::uuid/g)].map((m) => Number(m[1]));
    expect(castPlaceholders.length).toBe(4);
    for (const n of castPlaceholders) expect(values[n - 1]).toBe(USER_ID);
    // And the three WHERE sites that compare against a uuid column are cast.
    expect(sql).toMatch(/FROM users WHERE id = \$\d+::uuid/);
    expect(sql).toMatch(/WHERE user_id = \$\d+::uuid AND source = 'trial_grant'/);
    expect(sql).toMatch(/UPDATE users SET .* WHERE id = \$\d+::uuid AND EXISTS \(SELECT 1 FROM grant_ins\)/);
  });

  it('gates the insert on NOT EXISTS of a prior trial_grant row and on the partial-index arbiter', async () => {
    await grantTrialTokens(USER_ID);
    const sql = squash(renderSql(neonCalls[0]));
    expect(sql).toMatch(/AND NOT EXISTS \( SELECT 1 FROM credit_transactions WHERE user_id = \$\d+::uuid AND source = 'trial_grant' \)/);
    expect(sql).toContain('ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING');
    expect(sql).toContain('RETURNING id');
  });

  it('only updates the balance when the audit insert produced a row, and never starts a billing cycle', async () => {
    await grantTrialTokens(USER_ID);
    const sql = squash(renderSql(neonCalls[0]));
    expect(sql).toMatch(/^WITH grant_ins AS \( INSERT/);
    expect(sql).toMatch(/UPDATE users SET monthly_tokens = \$\d+, monthly_tokens_used = 0, updated_at = \$\d+ WHERE id = \$\d+::uuid AND EXISTS \(SELECT 1 FROM grant_ins\)$/);
    // Nothing refills a trial, and the balance/status routes derive "next
    // refill" from billing_cycle_start, so the grant must not write it.
    expect(sql).not.toContain('billing_cycle_start');
    const isoValues = neonCalls[0].values.filter((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v));
    expect(isoValues).toHaveLength(1);
  });

  it('never wraps the statement in a transaction (neon-http db.transaction() throws)', async () => {
    await grantTrialTokens(USER_ID);
    const sql = squash(renderSql(neonCalls[0]));
    expect(sql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
  });

  it('propagates a database failure to the caller (the webhook decides on retry)', async () => {
    mockNeonSql.mockImplementationOnce(() => Promise.reject(new Error('database connection reset')));
    await expect(grantTrialTokens(USER_ID)).rejects.toThrow('database connection reset');
  });
});
