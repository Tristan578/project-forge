import 'server-only';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import { withRetry, RetryOptions } from './withRetry';
import { dbCircuitBreaker } from './circuitBreaker';

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
