/**
 * Tests for the AI provider circuit breaker.
 *
 * Covers: state machine transitions, sliding window error rate, cost anomaly
 * detection, essential vs non-essential check methods, registry helpers, and
 * auto-transition from OPEN to HALF_OPEN.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProviderCircuitBreaker,
  getProviderBreaker,
  getAllBreakerStats,
  resetAllBreakers,
  resetProviderBreaker,
} from '../circuitBreaker';

// ---------------------------------------------------------------------------
// ProviderCircuitBreaker — unit tests
// ---------------------------------------------------------------------------

function makeBreaker(
  overrides: {
    windowMs?: number;
    errorRateThreshold?: number;
    minRequestsToEvaluate?: number;
    costAnomalyMultiplier?: number;
    halfOpenAfterMs?: number;
  } = {}
) {
  return new ProviderCircuitBreaker('test-provider', {
    windowMs: overrides.windowMs ?? 5 * 60 * 1000,
    errorRateThreshold: overrides.errorRateThreshold ?? 0.5,
    minRequestsToEvaluate: overrides.minRequestsToEvaluate ?? 3,
    costAnomalyMultiplier: overrides.costAnomalyMultiplier ?? 2,
    halfOpenAfterMs: overrides.halfOpenAfterMs ?? 60 * 1000,
  });
}

describe('ProviderCircuitBreaker — initial state', () => {
  it('starts in CLOSED state', () => {
    const cb = makeBreaker();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('getStats returns CLOSED state with zero counts', () => {
    const cb = makeBreaker();
    const stats = cb.getStats();
    expect(stats.state).toBe('CLOSED');
    expect(stats.errorCount).toBe(0);
    expect(stats.requestCount).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.lastErrorAt).toBeNull();
    expect(stats.lastOpenedAt).toBeNull();
    expect(stats.costAnomalyDetected).toBe(false);
  });

  it('checkNonEssential returns null when CLOSED', () => {
    const cb = makeBreaker();
    expect(cb.checkNonEssential()).toBeNull();
  });

  it('checkEssential returns null when CLOSED', () => {
    const cb = makeBreaker();
    expect(cb.checkEssential()).toBeNull();
  });
});

describe('ProviderCircuitBreaker — error rate threshold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('remains CLOSED below the minimum request threshold', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 3, errorRateThreshold: 0.5 });
    cb.recordFailure(); // 1 request, 100% errors — but below min
    cb.recordFailure(); // 2 requests
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens when error rate meets threshold after minRequests', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 3, errorRateThreshold: 0.5 });
    cb.recordSuccess();  // 1 success
    cb.recordFailure();  // 1 failure — 50% rate, 2 requests (below min)
    cb.recordFailure();  // 2 failures — 67% rate, 3 requests (at min, > threshold)
    expect(cb.getState()).toBe('OPEN');
  });

  it('remains CLOSED when error rate is below threshold', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 3, errorRateThreshold: 0.5 });
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure(); // 1/3 = 33% — below 50% threshold
    expect(cb.getState()).toBe('CLOSED');
  });

  it('stays open when checkNonEssential is called', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5 });
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    const msg = cb.checkNonEssential();
    expect(msg).not.toBeNull();
    expect(msg).toContain('test-provider');
    expect(msg).toContain('temporarily unavailable');
  });

  it('checkEssential returns warning string (not null) when OPEN', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5 });
    cb.recordFailure();
    const warning = cb.checkEssential();
    expect(warning).not.toBeNull();
    expect(warning).toContain('WARNING');
    expect(warning).toContain('test-provider');
  });

  it('sliding window expires old entries', () => {
    const cb = makeBreaker({
      windowMs: 1000,
      minRequestsToEvaluate: 3,
      errorRateThreshold: 0.5,
    });

    // Trip the circuit
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');

    // Reset and verify window expiry works
    cb.reset();
    expect(cb.getState()).toBe('CLOSED');

    // Add failures
    cb.recordFailure();
    cb.recordFailure();
    // Advance time past window
    vi.advanceTimersByTime(2000);
    // Add a success — old failures should be pruned
    cb.recordSuccess();
    // Now we have 1 success with no old errors — should stay CLOSED
    expect(cb.getState()).toBe('CLOSED');
  });
});

describe('ProviderCircuitBreaker — OPEN to HALF_OPEN transition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions to HALF_OPEN after halfOpenAfterMs', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5, halfOpenAfterMs: 5000 });
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(5000);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('remains OPEN before halfOpenAfterMs elapses', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5, halfOpenAfterMs: 5000 });
    cb.recordFailure();

    vi.advanceTimersByTime(4999);
    expect(cb.getState()).toBe('OPEN');
  });

  it('transitions HALF_OPEN to CLOSED on success', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5, halfOpenAfterMs: 1000 });
    cb.recordFailure();

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('transitions HALF_OPEN back to OPEN on failure', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5, halfOpenAfterMs: 1000 });
    cb.recordFailure();

    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
  });

  it('resets the open timer when reopened from HALF_OPEN', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5, halfOpenAfterMs: 1000 });
    cb.recordFailure();

    vi.advanceTimersByTime(1000);
    cb.recordFailure(); // probe fails — back to OPEN

    // 500ms later — still OPEN
    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe('OPEN');

    // 600ms later (1100ms total since reopen) — should be HALF_OPEN
    vi.advanceTimersByTime(600);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('checkNonEssential returns seconds until probe when OPEN', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5, halfOpenAfterMs: 30000 });
    cb.recordFailure();

    const msg = cb.checkNonEssential();
    expect(msg).not.toBeNull();
    expect(msg).toContain('30s');
  });
});

describe('ProviderCircuitBreaker — cost anomaly detection', () => {
  it('detects cost anomaly when actual cost exceeds multiplier × estimate', () => {
    const cb = makeBreaker({ costAnomalyMultiplier: 2 });
    // estimate: 10 cents, actual: 25 cents (2.5× estimate — exceeds 2×)
    cb.recordSuccess(25, 10);
    expect(cb.getState()).toBe('OPEN');
    expect(cb.getStats().costAnomalyDetected).toBe(true);
  });

  it('does not trip on cost within multiplier', () => {
    const cb = makeBreaker({ costAnomalyMultiplier: 2 });
    // estimate: 10 cents, actual: 19 cents (1.9× estimate — within 2×)
    cb.recordSuccess(19, 10);
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.getStats().costAnomalyDetected).toBe(false);
  });

  it('does not trip when estimatedCostCents is 0', () => {
    const cb = makeBreaker({ costAnomalyMultiplier: 2 });
    // Zero estimate means we cannot compute a ratio — skip anomaly check
    cb.recordSuccess(1000, 0);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('does not trip when cost args are omitted', () => {
    const cb = makeBreaker();
    cb.recordSuccess(); // no cost args
    expect(cb.getState()).toBe('CLOSED');
  });

  it('cost anomaly message mentions anomaly (not error rate)', () => {
    const cb = makeBreaker({ costAnomalyMultiplier: 2 });
    cb.recordSuccess(25, 10);
    const msg = cb.checkNonEssential();
    expect(msg).not.toBeNull();
    expect(msg).toContain('cost anomaly');
  });

  it('resets costAnomalyDetected on circuit close', () => {
    vi.useFakeTimers();

    const cb = makeBreaker({ costAnomalyMultiplier: 2, halfOpenAfterMs: 1000 });
    cb.recordSuccess(25, 10); // trip
    expect(cb.getStats().costAnomalyDetected).toBe(true);

    vi.advanceTimersByTime(1000);
    cb.recordSuccess(); // probe succeeds — close
    expect(cb.getStats().costAnomalyDetected).toBe(false);

    vi.useRealTimers();
  });
});

describe('ProviderCircuitBreaker — reset', () => {
  it('reset() returns circuit to CLOSED with no history', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 1, errorRateThreshold: 0.5 });
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');

    const stats = cb.getStats();
    expect(stats.errorCount).toBe(0);
    expect(stats.requestCount).toBe(0);
    expect(stats.lastOpenedAt).toBeNull();
    expect(stats.costAnomalyDetected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

describe('provider breaker registry', () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  it('getProviderBreaker returns the same instance for the same provider', () => {
    const a = getProviderBreaker('anthropic');
    const b = getProviderBreaker('anthropic');
    expect(a).toBe(b);
  });

  it('getProviderBreaker returns different instances for different providers', () => {
    const anthropic = getProviderBreaker('anthropic');
    const meshy = getProviderBreaker('meshy');
    expect(anthropic).not.toBe(meshy);
  });

  it('getAllBreakerStats returns entries for all known providers', () => {
    const stats = getAllBreakerStats();
    const providers = stats.map((s) => s.provider);
    expect(providers).toContain('anthropic');
    expect(providers).toContain('meshy');
    expect(providers).toContain('elevenlabs');
    expect(providers).toContain('suno');
    expect(providers).toContain('openrouter');
  });

  it('getAllBreakerStats starts with all CLOSED', () => {
    const stats = getAllBreakerStats();
    expect(stats.every((s) => s.state === 'CLOSED')).toBe(true);
  });

  it('resetAllBreakers resets all open circuits', () => {
    const cb = getProviderBreaker('anthropic');
    // Force open via error rate
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');

    resetAllBreakers();
    // After reset, a new instance is created — old ref is stale
    expect(getProviderBreaker('anthropic').getState()).toBe('CLOSED');
  });

  it('resetProviderBreaker resets only the specified provider', () => {
    vi.useFakeTimers();

    // Trip both anthropic and meshy
    const anthropicCb = getProviderBreaker('anthropic');
    const meshyCb = getProviderBreaker('meshy');

    anthropicCb.recordSuccess(100, 10); // cost anomaly trips anthropic
    meshyCb.recordSuccess(100, 10);     // cost anomaly trips meshy

    expect(anthropicCb.getState()).toBe('OPEN');
    expect(meshyCb.getState()).toBe('OPEN');

    resetProviderBreaker('anthropic');

    // anthropic should be reset, meshy should still be open
    expect(getProviderBreaker('anthropic').getState()).toBe('CLOSED');
    // meshyCb is a stale reference; the registry key was not reset
    expect(meshyCb.getState()).toBe('OPEN');

    vi.useRealTimers();
    resetAllBreakers();
  });
});

// ---------------------------------------------------------------------------
// getStats — errorRate computation
// ---------------------------------------------------------------------------

describe('ProviderCircuitBreaker — getStats detail', () => {
  it('computes errorRate correctly', () => {
    const cb = makeBreaker({ minRequestsToEvaluate: 10 }); // High threshold so circuit stays CLOSED
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure(); // 1/3 = 33%

    const stats = cb.getStats();
    expect(stats.requestCount).toBe(3);
    expect(stats.errorCount).toBe(1);
    expect(stats.errorRate).toBeCloseTo(1 / 3, 5);
  });

  it('reports provider name', () => {
    const cb = new ProviderCircuitBreaker('my-provider');
    expect(cb.getStats().provider).toBe('my-provider');
  });

  it('reports lastCostCents from most recent cost entry', () => {
    const cb = makeBreaker();
    cb.recordSuccess(50, 20);
    cb.recordSuccess(70, 20);
    const stats = cb.getStats();
    expect(stats.lastCostCents).toBe(70);
  });
});
