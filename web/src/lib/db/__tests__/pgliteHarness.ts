/**
 * In-process Postgres test harness (PGlite) for real-DB money-path tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The token/billing money paths (creditAddonTokens, reverseAddonTokens,
 * handleChargeRefunded, subscription lifecycle) are guarded by SQL-level
 * invariants — atomic CTE claims, partial-unique-index `ON CONFLICT` idempotency,
 * `FOR UPDATE` row locks, `FLOOR`/`GREATEST` arithmetic. Mock-based tests that
 * assert on the interpolated SQL string ("the query contains 'NOT EXISTS'")
 * prove nothing about the behaviour those invariants encode: a query can contain
 * the right substring and still double-credit. These tests run the *real* SQL
 * against a *real* Postgres and assert on the resulting rows.
 *
 * APPROACH (decided 2026-06-06)
 * -----------------------------
 * PGlite (Postgres compiled to WASM) runs in-process, always-on — real SQL in
 * every CI run, no network, no skips, always merge-enforced. The trade-off is it
 * cannot exercise true multi-connection concurrency; idempotency is therefore
 * proven by *sequential* webhook re-fire (the exact shape Stripe's at-least-once
 * redelivery produces), which is what the `ON CONFLICT` / `refunded_cents` guards
 * defend against.
 *
 * NO PRODUCTION CODE CHANGES. The system-under-test still imports
 * `@/lib/db/client`; each test file `vi.mock`s that module so `getNeonSql()`,
 * `getDb()` and `queryWithResilience()` resolve to this harness. Both the neon
 * tagged-template adapter and the Drizzle instance share ONE PGlite client, so
 * writes through either surface are visible to the other.
 *
 * SCHEMA BUILD
 * ------------
 * The schema is built by replaying the real migration SQL in `web/drizzle/` (so
 * the partial/expression unique indexes that `ON CONFLICT` arbiters depend on —
 * `idx_credit_txn_idempotent`, `uq_token_usage_refund_idempotent` — are created
 * exactly as production has them; Drizzle's schema DSL cannot model their WHERE
 * predicates). The replay is deliberately reconciliation-free: the migration
 * chain alone must produce the full schema.ts surface, and
 * `schemaMigrationParity.db.test.ts` (#8707) fails CI on any schema.ts
 * table/column the chain does not create.
 *
 * NEON ADAPTER FIDELITY
 * ---------------------
 * `makeNeonAdapter` reimplements neon's tagged-template composition
 * (`toParameterizedQuery`) and runs the composed `{ query, params }` directly on
 * PGlite with native JS parameter values. The real `@neondatabase/serverless`
 * driver stringifies params for its text-over-HTTP wire protocol; PGlite infers
 * types from native values instead. The fidelity concern is the *composition*
 * (SQL text + parameter order + `$N` placeholder numbering): this adapter mirrors
 * neon's documented composition algorithm, but that equivalence is NOT yet
 * asserted against the live `@neondatabase/serverless` driver in CI. Treat it as
 * "matches neon's documented algorithm", not "proven byte-identical", and
 * re-verify whenever `@neondatabase/serverless` is bumped (pinned `^1.1.0`, so a
 * minor bump can change composition). A committed, repeatable fidelity test —
 * compose representative SUT queries through BOTH this adapter and the real
 * driver's tagged template via a capturing `fetchFunction`, asserting identical
 * `{ query, params }` — is tracked in #8713.
 *
 * CANONICAL SHARED COPY — cross-branch convergence
 * ------------------------------------------------
 * This file is one canonical harness shared by the four real-DB money-path test
 * branches from the 2026-05-30 audit (F16 reverseAddonTokens, F17
 * creditAddonTokens, F18 handleChargeRefunded, F19 subscription lifecycle). It is
 * introduced *byte-identically* on every one of those branches — same git blob —
 * so the add/add merges into `main` auto-resolve regardless of merge order and
 * the second-through-fourth merges see it as already present. KEEP THE COPIES
 * IDENTICAL: edit the harness on one branch, then copy that exact blob to the
 * others (`git checkout <branch> -- <this path>`) rather than re-typing the edit.
 *
 * Consequence: this file exports the UNION of helpers every branch needs, so any
 * single branch leaves some exports unused (e.g. `countByUser` — see its note).
 * That is intentional, not dead code to prune — dropping a "locally unused" helper
 * would fork the blob and reintroduce the add/add conflict the convergence avoids.
 * `@typescript-eslint/no-unused-vars` does not flag unused *exported* members, so
 * the zero-warnings lint gate stays green either way.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as schema from '../schema';

export type QueryRow = Record<string, unknown>;
export type ParameterizedQuery = { query: string; params: unknown[] };

// ───────────────────────── neon tagged-template composition ─────────────────────
// Mirrors @neondatabase/serverless: a tagged template is lazy (composes on await,
// not on construction), embedded fragments compose recursively, and a fragment
// carrying bound params cannot be spliced into another query's text.

/** A raw SQL fragment spliced verbatim (no parameter binding). */
export class UnsafeRawSql {
  constructor(readonly sql: string) {}
}

/** A `${...}`-interpolated template, compiled to a parameterized query on demand. */
export class SqlTemplate {
  constructor(
    readonly strings: readonly string[],
    readonly values: readonly unknown[],
  ) {}

  toParameterizedQuery(acc: ParameterizedQuery = { query: '', params: [] }): ParameterizedQuery {
    const { strings, values } = this;
    for (let i = 0; i < strings.length; i++) {
      acc.query += strings[i];
      if (i < values.length) {
        const value = values[i];
        if (value instanceof UnsafeRawSql) {
          acc.query += value.sql;
        } else if (value instanceof NeonQueryPromise) {
          const inner = value.queryData;
          if (inner instanceof SqlTemplate) {
            inner.toParameterizedQuery(acc);
          } else {
            if (inner.params.length > 0) throw new Error('This query is not composable');
            acc.query += inner.query;
          }
        } else {
          acc.params.push(value);
          acc.query += `$${acc.params.length}`;
        }
      }
    }
    return acc;
  }
}

type RunQuery = (queryData: SqlTemplate | ParameterizedQuery) => Promise<QueryRow[]>;

/**
 * Thenable returned by the adapter. Execution is deferred until `await` (or
 * `.then`), matching neon — so the query objects passed to `.transaction([...])`
 * are composed but not yet run.
 */
export class NeonQueryPromise implements PromiseLike<QueryRow[]> {
  constructor(
    private readonly run: RunQuery,
    readonly queryData: SqlTemplate | ParameterizedQuery,
  ) {}

  then<TResult1 = QueryRow[], TResult2 = never>(
    onfulfilled?: ((value: QueryRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run(this.queryData).then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<QueryRow[] | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<QueryRow[]> {
    return this.then().finally(onfinally);
  }
}

/** Callable surface compatible with the subset of neon's client our SUTs use. */
export interface NeonSqlAdapter {
  (strings: TemplateStringsArray, ...values: unknown[]): NeonQueryPromise;
  query(query: string, params?: unknown[]): NeonQueryPromise;
  unsafe(raw: string): UnsafeRawSql;
  transaction(queries: NeonQueryPromise[]): Promise<QueryRow[][]>;
}

export function makeNeonAdapter(pglite: PGlite): NeonSqlAdapter {
  const run: RunQuery = async (queryData) => {
    const { query, params } =
      queryData instanceof SqlTemplate ? queryData.toParameterizedQuery() : queryData;
    const result = await pglite.query<QueryRow>(query, params);
    return result.rows;
  };

  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]): NeonQueryPromise =>
      new NeonQueryPromise(run, new SqlTemplate(strings, values)),
    {
      query: (query: string, params: unknown[] = []): NeonQueryPromise =>
        new NeonQueryPromise(run, { query, params }),
      unsafe: (raw: string): UnsafeRawSql => new UnsafeRawSql(raw),
      transaction: async (queries: NeonQueryPromise[]): Promise<QueryRow[][]> => {
        const compiled = queries.map((q) =>
          q.queryData instanceof SqlTemplate ? q.queryData.toParameterizedQuery() : q.queryData,
        );
        return pglite.transaction(async (tx) => {
          const out: QueryRow[][] = [];
          for (const { query, params } of compiled) {
            const r = await tx.query<QueryRow>(query, params);
            out.push(r.rows);
          }
          return out;
        });
      },
    },
  );

  return sql as NeonSqlAdapter;
}

// ───────────────────────── schema build (migration replay) ─────────────────────
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle/', import.meta.url));

async function buildSchema(pglite: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const ddl = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      // We exec whole files, so drizzle's per-statement markers are noise.
      .replace(/-->\s*statement-breakpoint/g, '')
      // CONCURRENTLY cannot run inside a transaction block; PGlite.exec wraps the
      // file in one. The index is otherwise identical (same columns/predicate).
      .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi, (m) =>
        m.replace(/\s+CONCURRENTLY/i, ''),
      )
      // pgvector compat shim (PF-985 #8977): the graph migration
      // (0010_graph_retrieval_nodes_edges.sql) is the only place we depend on
      // the `vector` extension, and @electric-sql/pglite 0.5.x does not bundle
      // pgvector — `CREATE EXTENSION vector` throws "extension not available"
      // and the whole harness build fails, breaking EVERY *.db.test.ts, not
      // just the graph tests. Parity's scope is explicitly name-existence only
      // ("does NOT diff column types … or index column lists/predicates" — see
      // schemaMigrationParity.db.test.ts SCOPE docblock), so degrading the
      // vector column to `text` and the HNSW index to a plain btree under the
      // SAME index name keeps every parity assertion honest (table/column/index
      // NAME all still created) without needing the real extension. Production
      // keeps the real `vector(1536)` + hnsw — this rewrite is test-harness-only.
      .replace(/\bCREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?vector\s*;/gi, '')
      .replace(/\bvector\(\s*\d+\s*\)/gi, 'text')
      .replace(
        /\bUSING\s+hnsw\s*\(\s*("?[\w]+"?)\s+vector_cosine_ops\s*\)/gi,
        'USING btree ($1)',
      );
    await pglite.exec(ddl);
  }
}

function makeDrizzle(pglite: PGlite) {
  return drizzle(pglite, { schema });
}

/** Drizzle instance bound to the harness PGlite — what mocked `getDb()` returns. */
export type TestDb = ReturnType<typeof makeDrizzle>;

export interface TestHarness {
  pglite: PGlite;
  /** Drizzle instance (production uses neon-http; same pg dialect, identical SQL). */
  db: TestDb;
  /** neon tagged-template surface (production uses @neondatabase/serverless). */
  neonSql: NeonSqlAdapter;
  /** Wipe every public table — call in `beforeEach` for per-test isolation. */
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Create a fresh in-memory Postgres with the full schema. Call once per test file
 * (`beforeAll`); migration replay is the only meaningful per-instance cost.
 */
export async function createTestHarness(): Promise<TestHarness> {
  const pglite = new PGlite();
  await buildSchema(pglite);
  const neonSql = makeNeonAdapter(pglite);
  const db = makeDrizzle(pglite);

  const truncateAll = async (): Promise<void> => {
    const result = await pglite.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    if (result.rows.length === 0) return;
    const tables = result.rows.map((r) => `"${r.tablename}"`).join(', ');
    await pglite.exec(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  };

  const close = async (): Promise<void> => {
    await pglite.close();
  };

  return { pglite, db, neonSql, truncateAll, close };
}

// ───────────────────────── seed / read helpers ─────────────────────
export interface SeedUserOverrides {
  id?: string;
  clerkId?: string;
  email?: string;
  tier?: 'starter' | 'hobbyist' | 'creator' | 'pro';
  monthlyTokens?: number;
  monthlyTokensUsed?: number;
  addonTokens?: number;
  earnedCredits?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  billingCycleStart?: string | null;
  /** Stripe-entitlement feature lookup_keys (jsonb `active_features`). */
  activeFeatures?: string[] | null;
}

export interface SeededUser {
  id: string;
  clerkId: string;
  email: string;
  tier: string;
  monthlyTokens: number;
  monthlyTokensUsed: number;
  addonTokens: number;
  earnedCredits: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/** Insert a user with sensible defaults; override any column. Returns the row. */
export async function seedUser(
  sql: NeonSqlAdapter,
  over: SeedUserOverrides = {},
): Promise<SeededUser> {
  const id = over.id ?? randomUUID();
  const rows = await sql`
    INSERT INTO users (
      id, clerk_id, email, tier,
      monthly_tokens, monthly_tokens_used, addon_tokens, earned_credits,
      stripe_customer_id, stripe_subscription_id, billing_cycle_start,
      active_features
    ) VALUES (
      ${id},
      ${over.clerkId ?? `clerk_${id}`},
      ${over.email ?? `${id}@test.local`},
      ${over.tier ?? 'starter'},
      ${over.monthlyTokens ?? 0},
      ${over.monthlyTokensUsed ?? 0},
      ${over.addonTokens ?? 0},
      ${over.earnedCredits ?? 0},
      ${over.stripeCustomerId ?? null},
      ${over.stripeSubscriptionId ?? null},
      ${over.billingCycleStart ?? null},
      ${over.activeFeatures === undefined ? null : JSON.stringify(over.activeFeatures)}::jsonb
    )
    RETURNING id, clerk_id, email, tier, monthly_tokens, monthly_tokens_used,
              addon_tokens, earned_credits, stripe_customer_id, stripe_subscription_id
  `;
  return toSeededUser(rows[0]);
}

function toSeededUser(row: QueryRow): SeededUser {
  return {
    id: String(row.id),
    clerkId: String(row.clerk_id),
    email: String(row.email),
    tier: String(row.tier),
    monthlyTokens: Number(row.monthly_tokens),
    monthlyTokensUsed: Number(row.monthly_tokens_used),
    addonTokens: Number(row.addon_tokens),
    earnedCredits: Number(row.earned_credits),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId:
      row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id),
  };
}

/** Read a single user row (raw columns) by id, or `undefined` if absent. */
export async function getUserRow(
  sql: NeonSqlAdapter,
  userId: string,
): Promise<QueryRow | undefined> {
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}::uuid`;
  return rows[0];
}

/**
 * `COUNT(*)` over `table` filtered by `userId`, as a number.
 *
 * Part of the harness's union API (see "CANONICAL SHARED COPY" above): some
 * branches assert row counts with this, others don't. Kept exported even where a
 * given branch never calls it so all four copies stay byte-identical — do not
 * delete as "unused".
 */
export async function countByUser(
  sql: NeonSqlAdapter,
  table: 'token_purchases' | 'token_usage' | 'credit_transactions',
  userId: string,
): Promise<number> {
  // `table` is a closed union of literal identifiers — never user input.
  const rows = await sql.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1::uuid`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}
