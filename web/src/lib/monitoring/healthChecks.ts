import 'server-only';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  latencyMs?: number;
  details?: Record<string, unknown>;
}

/**
 * Check the database connection health.
 * Reports circuit breaker state when the module is available.
 */
export async function checkDbHealth(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    // Import lazily so this file can be loaded even when DB env vars are absent.
    const { getDb } = await import('../db/client');
    const db = getDb();

    // Lightweight connectivity probe — execute a trivial SQL expression.
    await db.execute('SELECT 1' as Parameters<typeof db.execute>[0]);

    const latencyMs = Date.now() - start;

    // Optionally attach circuit breaker stats for observability.
    let circuitBreakerDetails: Record<string, unknown> | undefined;
    try {
      const { dbCircuitBreaker } = await import('../db/circuitBreaker');
      circuitBreakerDetails = dbCircuitBreaker.getStats();
    } catch {
      // circuitBreaker module unavailable — skip
    }

    return {
      status: 'ok',
      latencyMs,
      details: circuitBreakerDetails
        ? { circuitBreaker: circuitBreakerDetails }
        : undefined,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;

    let circuitBreakerDetails: Record<string, unknown> | undefined;
    try {
      const { dbCircuitBreaker } = await import('../db/circuitBreaker');
      const stats = dbCircuitBreaker.getStats();
      circuitBreakerDetails = stats;
      const status = stats.state === 'open' ? 'down' : 'degraded';
      return {
        status,
        latencyMs,
        details: {
          error: error instanceof Error ? error.message : String(error),
          circuitBreaker: circuitBreakerDetails,
        },
      };
    } catch {
      // circuitBreaker module unavailable
    }

    return {
      status: 'down',
      latencyMs,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
