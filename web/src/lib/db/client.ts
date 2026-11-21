/**
 * Neon PostgreSQL client (server-only).
 *
 * Exports `getDb()` (Drizzle ORM for typed queries) and `getNeonSql()` (raw
 * neon-http client for batched transactions). Both are lazy-initialized from
 * `DATABASE_URL`. See the comment block below for why `db.transaction()` must
 * NOT be used with the neon-http driver.
 */

import 'server-only';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { headers } from 'next/headers';
import * as schema from './schema';
import { withRetry, RetryOptions } from './withRetry';
import { dbCircuitBreaker } from './circuitBreaker';
import { checkDbRateLimit } from './dbRateLimit';
import { setCurrentRoute } from './queryMonitor';

// PF-525: Transaction support with neon-http driver.
//
// Drizzle ORM's neon-http session throws "No transactions support in
// neon-http driver" when db.transaction() is called. The underlying
// @neondatabase/serverless neon() client supports non-interactive
// transactions via sql.transaction(queries, opts) which batches queries
// in a single HTTP request wrapped in BEGIN/COMMIT, but Drizzle's ORM
// layer does not expose this.
//
// db.transaction() MUST NOT be used with neon-http. Code requiring
// transactional semantics should either:
//   1. Use atomic SQL expressions (sql`UPDATE ... SET x = x + 1`) with
//      WHERE guards to prevent races, OR
//   2. Switch to the WebSocket-based @neondatabase/serverless Pool/Client
//      driver with drizzle-orm/neon-serverless for interactive transactions.
//
// Current approach: option (1). The Stripe webhook handler has event-level
// idempotency via claimEvent(), so partial writes from non-transactional
// sequences are recoverable via webhook redelivery.

// Create a Neon SQL client from the DATABASE_URL env var.
// This is used for serverless edge-compatible DB access.
function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  const sqlClient = neon(databaseUrl);
  return { db: drizzle(sqlClient, { schema }), sql: sqlClient };
}

// Singleton for hot-reload in dev
let _instance: ReturnType<typeof createDb> | null = null;

function getInstance() {
  if (!_instance) {
    _instance = createDb();
  }
  return _instance;
}

export function getDb(): ReturnType<typeof createDb>['db'] {
  return getInstance().db;
}

/**
 * Get the raw Neon SQL client for use with sql.transaction([...queries]).
 *
 * This is the ONLY supported way to run multi-statement transactions with the
 * neon-http driver (PF-525). Use this when you need atomicity across multiple
 * INSERT/UPDATE operations. Pass raw tagged-template queries built with the
 * returned function.
 *
 * Example:
 *   const sql = getNeonSql();
 *   await sql.transaction([
 *     sql`UPDATE users SET addon_tokens = addon_tokens + ${n} WHERE id = ${userId}`,
 *     sql`INSERT INTO token_purchases (...) VALUES (...)`,
 *   ]);
 */
export function getNeonSql(): ReturnType<typeof createDb>['sql'] {
  return getInstance().sql;
}

export type Db = ReturnType<typeof getDb>;

/**
 * Execute a database operation with circuit breaker protection and exponential
 * backoff retry on transient errors.
 *
 * Usage:
 *   const rows = await queryWithResilience(() => db.select().from(users));
 *
 * The circuit breaker is checked first. If the circuit is open (too many recent
 * failures) a CircuitBreakerOpenError is thrown immediately without hitting the
 * database. On transient errors the operation is retried up to 3 times with
 * exponential backoff. Non-transient errors (auth, syntax, constraints) are
 * propagated immediately.
 */
export async function queryWithResilience<T>(
  operation: () => Promise<T>,
  retryOptions?: RetryOptions
): Promise<T> {
  // Auto-derive route label from the incoming request path so the query
  // monitor can attribute metrics per-route without requiring each handler
  // to call setCurrentRoute() manually (PF-704).
  try {
    const h = await headers();
    const url = h.get('x-invoke-path') ?? h.get('x-pathname') ?? h.get('x-url');
    if (url) {
      setCurrentRoute(url);
    }
  } catch {
    // headers() throws outside of a request context (e.g. during tests or
    // background jobs). Swallow silently — route will remain 'unknown'.
  }
  // Circuit breaker checked first — if open, fail fast without incurring
  // an Upstash round-trip for the rate limit check.
  return dbCircuitBreaker.execute(async () => {
    // Global rate limit check (Upstash Redis) prevents stampedes across all
    // Vercel function instances. No-op when Upstash is not configured.
    await checkDbRateLimit();
    return withRetry(operation, retryOptions);
  });
}
