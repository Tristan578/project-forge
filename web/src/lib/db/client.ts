import 'server-only';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { withRetry, RetryOptions } from './withRetry';
import { dbCircuitBreaker } from './circuitBreaker';

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
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

// Singleton for hot-reload in dev
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
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
  return dbCircuitBreaker.execute(() => withRetry(operation, retryOptions));
}
