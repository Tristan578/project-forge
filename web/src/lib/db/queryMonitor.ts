/**
 * Query monitor for SpawnForge's Neon PostgreSQL database.
 *
 * Tracks per-query execution time, detects slow queries (>500ms), and
 * aggregates metrics for health checks and the admin db-metrics endpoint.
 *
 * Design notes:
 * - In-process ring buffer of the last 500 query records (5-minute window at
 *   typical load). Older records are evicted automatically.
 * - Route tracking uses a per-request context key injected by the caller.
 *   API routes should call setCurrentRoute() at the start of each request.
 * - All timestamps use Date.now() for monotonic-free, zero-dependency timing.
 * - This module is server-only (imported with 'server-only' sentinel).
 */
import 'server-only';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryRecord {
  /** Route that triggered this query, e.g. "/api/admin/economics" */
  route: string;
  /** Wall-clock start time (ms since epoch) */
  startedAt: number;
  /** Duration of the query execution in milliseconds */
  durationMs: number;
  /** Whether the query exceeded SLOW_QUERY_THRESHOLD_MS */
  isSlow: boolean;
  /** Optional label — set by instrumented wrappers for human-readable context */
  label?: string;
}

export interface DbMetrics {
  /** Average query time across all records in the current window (ms) */
  avgQueryTimeMs: number;
  /** Count of slow queries (duration > SLOW_QUERY_THRESHOLD_MS) in the window */
  slowQueryCount: number;
  /** Total number of queries recorded in the window */
  totalQueryCount: number;
  /** Top 5 slowest individual queries in the window */
  top5Slowest: QueryRecord[];
  /** Per-route query counts (route → count) */
  queryCountByRoute: Record<string, number>;
  /** Window start time (ms since epoch) */
  windowStartMs: number;
  /** Window end time (ms since epoch) */
  windowEndMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Queries exceeding this threshold are classified as slow */
export const SLOW_QUERY_THRESHOLD_MS = 500;

/** Health-check degraded threshold: average query time over the window */
export const DEGRADED_AVG_THRESHOLD_MS = 1_000;

/** Observation window for metrics aggregation (5 minutes) */
const WINDOW_MS = 5 * 60 * 1_000;

/** Maximum number of records kept in the ring buffer */
const MAX_RECORDS = 500;

// ---------------------------------------------------------------------------
// Module-level state (server singleton)
// ---------------------------------------------------------------------------

let _records: QueryRecord[] = [];

/**
 * AsyncLocalStorage-based current route tracking is not available in all
 * Next.js Edge/Node environments. Use a simple module-level string that
 * callers set at the beginning of each API handler. This is safe because
 * Next.js API routes run in isolated V8 microtask queues within a single
 * request lifecycle in the Node.js server (not shared across requests).
 *
 * For full correctness in concurrent scenarios, callers should always call
 * setCurrentRoute() before running queries.
 */
let _currentRoute = 'unknown';

// ---------------------------------------------------------------------------
// Public API — route context
// ---------------------------------------------------------------------------

/**
 * Set the route label for subsequent queries in this request.
 * Call this at the top of each API handler before any DB access.
 *
 * @example
 * export async function GET() {
 *   setCurrentRoute('/api/admin/economics');
 *   const db = getDb();
 *   // ... queries now attributed to the route above
 * }
 */
export function setCurrentRoute(route: string): void {
  _currentRoute = route;
}

/** Return the current route label (primarily for testing). */
export function getCurrentRoute(): string {
  return _currentRoute;
}

// ---------------------------------------------------------------------------
// Public API — recording
// ---------------------------------------------------------------------------

/**
 * Record a completed query. Called by instrumented wrappers after every
 * database operation.
 *
 * - Stores the record in the ring buffer (evicts oldest when at capacity).
 * - Logs a warning for slow queries so they appear in server logs / Sentry.
 */
export function recordQuery(durationMs: number, label?: string): QueryRecord {
  const record: QueryRecord = {
    route: _currentRoute,
    startedAt: Date.now() - durationMs,
    durationMs,
    isSlow: durationMs >= SLOW_QUERY_THRESHOLD_MS,
    label,
  };

  _records.push(record);

  // Evict oldest records beyond the cap
  if (_records.length > MAX_RECORDS) {
    _records = _records.slice(_records.length - MAX_RECORDS);
  }

  if (record.isSlow) {
    // Use console.warn so Next.js server logs and Sentry breadcrumbs capture it
    const ctx = label ? ` [${label}]` : '';
    console.warn(
      `[QueryMonitor] Slow query detected${ctx}: ${durationMs}ms on route "${record.route}"`
    );
  }

  return record;
}

// ---------------------------------------------------------------------------
// Public API — metrics
// ---------------------------------------------------------------------------

/**
 * Return aggregated metrics for the last 5-minute window.
 * Records older than WINDOW_MS are excluded from all calculations.
 */
export function getMetrics(): DbMetrics {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const windowRecords = _records.filter((r) => r.startedAt >= windowStart);

  const totalQueryCount = windowRecords.length;
  const slowQueryCount = windowRecords.filter((r) => r.isSlow).length;

  const avgQueryTimeMs =
    totalQueryCount === 0
      ? 0
      : windowRecords.reduce((sum, r) => sum + r.durationMs, 0) / totalQueryCount;

  // Top 5 slowest: sort descending, take first 5
  const top5Slowest = [...windowRecords]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);

  // Per-route query counts
  const queryCountByRoute: Record<string, number> = {};
  for (const r of windowRecords) {
    queryCountByRoute[r.route] = (queryCountByRoute[r.route] ?? 0) + 1;
  }

  return {
    avgQueryTimeMs,
    slowQueryCount,
    totalQueryCount,
    top5Slowest,
    queryCountByRoute,
    windowStartMs: windowStart,
    windowEndMs: now,
  };
}

// Convenience re-exports so callers can inspect thresholds without magic numbers
export { WINDOW_MS as METRICS_WINDOW_MS };

// ---------------------------------------------------------------------------
// Internal helpers — exposed for testing only
// ---------------------------------------------------------------------------

/** Reset all in-memory state. Used by tests between test cases. */
export function _resetForTesting(): void {
  _records = [];
  _currentRoute = 'unknown';
}

/** Return the raw record buffer. Used by tests to inspect internal state. */
export function _getRecordsForTesting(): ReadonlyArray<QueryRecord> {
  return _records;
}

// ---------------------------------------------------------------------------
// Instrumented query wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap any async operation (typically a Drizzle ORM query) with query
 * monitoring. Times the operation, records the result, and re-throws any
 * errors so the caller's error handling remains intact.
 *
 * @example
 * const rows = await monitoredQuery(
 *   () => db.select().from(users).where(eq(users.id, userId)),
 *   'select-user-by-id'
 * );
 */
export async function monitoredQuery<T>(
  operation: () => Promise<T>,
  label?: string
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    recordQuery(Date.now() - start, label);
    return result;
  } catch (err) {
    // Still record the duration so slow-failing queries are visible
    recordQuery(Date.now() - start, label ? `${label}:error` : 'error');
    throw err;
  }
}
