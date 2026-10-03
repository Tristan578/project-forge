// @vitest-environment node
// (pgliteHarness resolves web/drizzle/ via import.meta.url, which is not a
// file:// URL under the jsdom default of the standalone vitest.config.ts —
// same docblock pattern as schemaMigrationParity.db.test.ts.)
/**
 * Provider-job ownership against REAL Postgres (#10262).
 *
 * WHY THIS EXISTS
 * ---------------
 * `bindProviderJob` claims first-writer-wins: once a `(provider, providerJobId)`
 * pair is bound to a user, a second bind for the same pair can never reassign
 * it. That claim is carried by TWO things together — the `ON CONFLICT DO
 * NOTHING` clause and the `uq_provider_job_owners_provider_job` UNIQUE index
 * the clause arbitrates on. The mocked unit suite (`jobOwnership.test.ts`) can
 * only see the first: drop the index from `schema.ts` and migration 0015 and
 * every mocked test stays green, while the second bind quietly inserts a
 * second row and `verifyProviderJobOwner`'s `LIMIT 1` answers for whichever
 * row Postgres returns first.
 *
 * WHAT IT PROVES
 * --------------
 * On a PGlite built ONLY by replaying `web/drizzle/*.sql` (the harness — no
 * push, no reconciliation), the real `bindProviderJob` for user A then user B
 * on the same pair leaves exactly one row, bound to A, reports nothing to
 * Sentry, and `verifyProviderJobOwner` answers `'owner'` to A and `'not_owner'`
 * to B. The same job id under a DIFFERENT provider is a different binding, so
 * the index must cover both columns, not `provider_job_id` alone. Separately,
 * `schema.ts`'s declaration is pinned through `getTableConfig`, because
 * `drizzle-kit push` builds an environment from `schema.ts`, not from the
 * migration chain.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { TestHarness } from '@/lib/db/__tests__/pgliteHarness';

const harnessRef = vi.hoisted(() => ({ current: null as TestHarness | null }));
function harness(): TestHarness {
  const h = harnessRef.current;
  if (!h) throw new Error('PGlite harness not initialised');
  return h;
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({
  getNeonSql: () => harness().neonSql,
  getDb: () => harness().db,
  queryWithResilience: <T>(operation: () => Promise<T>): Promise<T> => operation(),
}));
const captureExceptionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/monitoring/sentry-server', () => ({ captureException: captureExceptionMock }));

import { createTestHarness, seedUser } from '@/lib/db/__tests__/pgliteHarness';
import { providerJobOwners } from '@/lib/db/schema';
import { bindProviderJob, findOtherProviderJobOwnerId, verifyProviderJobOwner } from '../jobOwnership';

beforeAll(async () => {
  harnessRef.current = await createTestHarness();
});
afterAll(async () => {
  await harnessRef.current?.close();
});
beforeEach(async () => {
  captureExceptionMock.mockReset();
  await harness().truncateAll();
});

async function bindings(providerJobId: string): Promise<{ provider: string; user_id: string }[]> {
  const rows = await harness().neonSql`
    SELECT provider, user_id::text AS user_id
    FROM provider_job_owners
    WHERE provider_job_id = ${providerJobId}
    ORDER BY provider ASC
  `;
  return rows.map((r) => ({ provider: String(r.provider), user_id: String(r.user_id) }));
}

describe('provider_job_owners first-writer-wins (real Postgres, #10262)', () => {
  it('a second bind of the same (provider, providerJobId) leaves the FIRST owner bound', async () => {
    const a = await seedUser(harness().neonSql);
    const b = await seedUser(harness().neonSql);

    await bindProviderJob(a.id, 'meshy', 'task-shared');
    await bindProviderJob(b.id, 'meshy', 'task-shared');

    expect(await bindings('task-shared')).toEqual([{ provider: 'meshy', user_id: a.id }]);
    // DO NOTHING, not an error swallowed by bindProviderJob's catch: a unique
    // violation reaching Sentry here would mean the arbiter clause is gone.
    expect(captureExceptionMock).not.toHaveBeenCalled();

    expect(await verifyProviderJobOwner(a.id, 'meshy', 'task-shared')).toBe('owner');
    expect(await verifyProviderJobOwner(b.id, 'meshy', 'task-shared')).toBe('not_owner');
    expect(await findOtherProviderJobOwnerId('task-shared', b.id)).toBe(a.id);
    expect(await findOtherProviderJobOwnerId('task-shared', a.id)).toBeNull();
  });

  it('the same job id under a DIFFERENT provider is a separate binding', async () => {
    const a = await seedUser(harness().neonSql);
    const b = await seedUser(harness().neonSql);

    await bindProviderJob(a.id, 'meshy', 'task-same-id');
    await bindProviderJob(b.id, 'replicate', 'task-same-id');

    expect(await bindings('task-same-id')).toEqual([
      { provider: 'meshy', user_id: a.id },
      { provider: 'replicate', user_id: b.id },
    ]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(await verifyProviderJobOwner(b.id, 'replicate', 'task-same-id')).toBe('owner');
    expect(await verifyProviderJobOwner(b.id, 'meshy', 'task-same-id')).toBe('not_owner');
  });

  it('the migration chain creates a UNIQUE index on exactly (provider, provider_job_id)', async () => {
    const { rows } = await harness().pglite.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'provider_job_owners'
         AND indexname = 'uq_provider_job_owners_provider_job'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/^CREATE UNIQUE INDEX /);
    expect(rows[0].indexdef).toMatch(/\(provider, provider_job_id\)$/);
  });
});

describe('schema.ts declares the same arbiter (drizzle-kit push reads this, not the migrations)', () => {
  it('uq_provider_job_owners_provider_job is UNIQUE on exactly provider and provider_job_id', () => {
    const indexes = getTableConfig(providerJobOwners).indexes.filter(
      (ix) => ix.config.name === 'uq_provider_job_owners_provider_job',
    );
    expect(indexes).toHaveLength(1);
    const [ix] = indexes;
    expect(ix.config.unique).toBe(true);
    expect(ix.config.where).toBeUndefined();
    expect(ix.config.columns.map((c) => ('name' in c ? c.name : '<expression>'))).toEqual([
      'provider',
      'provider_job_id',
    ]);
  });
});
