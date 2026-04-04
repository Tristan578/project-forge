/**
 * AI Provider Circuit Breaker
 *
 * Tracks per-provider error rates and cost anomalies using a sliding window.
 * Protects against runaway API spend and cascading failures.
 *
 * State machine:
 *   CLOSED → OPEN  : error rate exceeds threshold OR cost anomaly detected
 *   OPEN → HALF_OPEN: after 60 seconds
 *   HALF_OPEN → CLOSED: on first success
 *   HALF_OPEN → OPEN  : on failure
 *
 * Essential operations (single chat messages) proceed even when OPEN but log
 * a warning. Non-essential operations (bulk generation, compound actions) are
 * rejected immediately when OPEN.
 */

import {
  PROVIDER_NAMES,
  CIRCUIT_BREAKER_DEFAULTS,
  type ProviderName,
} from '@/lib/config/providers';
import {
  CIRCUIT_BREAKER_WINDOW_MS,
  CIRCUIT_BREAKER_HALF_OPEN_MS,
} from '@/lib/config/timeouts';

// Re-export ProviderName from centralized config
export type { ProviderName } from '@/lib/config/providers';

export type ProviderCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderCircuitStats {
  state: ProviderCircuitState;
  provider: string;
  errorCount: number;
  requestCount: number;
  errorRate: number;
  lastErrorAt: number | null;
  lastOpenedAt: number | null;
  costAnomalyDetected: boolean;
  lastCostCents: number | null;
}

export interface CircuitBreakerConfig {
  /** Size of the sliding window in milliseconds. Default: 5 minutes */
  windowMs?: number;
  /** Error rate (0–1) that trips the circuit. Default: 0.5 */
  errorRateThreshold?: number;
  /** Minimum requests before evaluating error rate. Default: 3 */
  minRequestsToEvaluate?: number;
  /** Cost multiplier vs configured estimate that triggers anomaly detection. Default: 2 */
  costAnomalyMultiplier?: number;
  /** Milliseconds to stay OPEN before probing. Default: 60 seconds */
  halfOpenAfterMs?: number;
}

interface WindowEntry {
  timestampMs: number;
  isError: boolean;
}

interface CostEntry {
  timestampMs: number;
  costCents: number;
  estimatedCostCents: number;
}

export class ProviderCircuitBreaker {
  private state: ProviderCircuitState = 'CLOSED';
  private window: WindowEntry[] = [];
  private costWindow: CostEntry[] = [];
  private lastOpenedAt: number | null = null;
  private costAnomalyDetected = false;

  private readonly windowMs: number;
  private readonly errorRateThreshold: number;
  private readonly minRequestsToEvaluate: number;
  private readonly costAnomalyMultiplier: number;
  private readonly halfOpenAfterMs: number;

  constructor(
    public readonly provider: string,
    config: CircuitBreakerConfig = {}
  ) {
    this.windowMs = config.windowMs ?? CIRCUIT_BREAKER_WINDOW_MS;
    this.errorRateThreshold = config.errorRateThreshold ?? CIRCUIT_BREAKER_DEFAULTS.errorRateThreshold;
    this.minRequestsToEvaluate = config.minRequestsToEvaluate ?? CIRCUIT_BREAKER_DEFAULTS.minRequestsToEvaluate;
    this.costAnomalyMultiplier = config.costAnomalyMultiplier ?? CIRCUIT_BREAKER_DEFAULTS.costAnomalyMultiplier;
    this.halfOpenAfterMs = config.halfOpenAfterMs ?? CIRCUIT_BREAKER_HALF_OPEN_MS;
  }

  /** Get current circuit state (checks for auto-transition to HALF_OPEN). */
  getState(): ProviderCircuitState {
    this._maybeTransitionToHalfOpen();
    return this.state;
  }

  /** Get observable statistics for monitoring/admin. */
  getStats(): ProviderCircuitStats {
    this._maybeTransitionToHalfOpen();
    this._pruneWindow();

    const requestCount = this.window.length;
    const errorCount = this.window.filter((e) => e.isError).length;
    const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
    const lastError = this.window.filter((e) => e.isError).at(-1);
    const lastCost = this.costWindow.at(-1);

    return {
      state: this.state,
      provider: this.provider,
      errorCount,
      requestCount,
      errorRate,
      lastErrorAt: lastError?.timestampMs ?? null,
      lastOpenedAt: this.lastOpenedAt,
      costAnomalyDetected: this.costAnomalyDetected,
      lastCostCents: lastCost?.costCents ?? null,
    };
  }

  /**
   * Record a successful request outcome.
   * Call this after a provider call completes without error.
   */
  recordSuccess(actualCostCents?: number, estimatedCostCents?: number): void {
    this._maybeTransitionToHalfOpen();
    this._pruneWindow();
    this.window.push({ timestampMs: Date.now(), isError: false });

    if (actualCostCents !== undefined && estimatedCostCents !== undefined) {
      this.costWindow.push({
        timestampMs: Date.now(),
        costCents: actualCostCents,
        estimatedCostCents,
      });

      // Check cost anomaly — actual cost is more than multiplier × estimate.
      // Open the circuit regardless of current state so the timer is always
      // reset when a new anomaly is detected (including when already OPEN).
      if (
        estimatedCostCents > 0 &&
        actualCostCents > estimatedCostCents * this.costAnomalyMultiplier
      ) {
        this.costAnomalyDetected = true;
        this._openCircuit();
        return;
      }
    }

    if (this.state === 'HALF_OPEN') {
      // Probe succeeded with no cost anomaly — close the circuit.
      this._closeCircuit();
    }
  }

  /**
   * Record a failed request outcome.
   * Call this when a provider call throws an error.
   */
  recordFailure(): void {
    this._maybeTransitionToHalfOpen();
    this._pruneWindow();
    this.window.push({ timestampMs: Date.now(), isError: true });

    if (this.state === 'HALF_OPEN') {
      // Probe failed — reopen
      this._openCircuit();
      return;
    }

    if (this.state === 'CLOSED') {
      this._evaluateErrorRate();
    }
  }

  /**
   * Check whether a non-essential operation should be rejected.
   * Non-essential: bulk generation, compound AI actions, asset generation.
   *
   * Returns an error message string when the request should be blocked,
   * or null when the request may proceed.
   */
  checkNonEssential(): string | null {
    const state = this.getState();
    if (state === 'OPEN') {
      const secsUntilProbe = this.lastOpenedAt
        ? Math.max(0, Math.ceil((this.halfOpenAfterMs - (Date.now() - this.lastOpenedAt)) / 1000))
        : 0;
      return (
        `The ${this.provider} provider is temporarily unavailable due to ` +
        `${this.costAnomalyDetected ? 'a cost anomaly' : 'repeated errors'}. ` +
        `Non-essential operations are paused to protect against runaway costs. ` +
        (secsUntilProbe > 0
          ? `Automatic retry in ${secsUntilProbe}s.`
          : 'Retrying now.')
      );
    }
    return null;
  }

  /**
   * Check whether an essential operation should log a warning.
   * Essential: single chat messages, critical user-initiated actions.
   *
   * Returns a warning string when the circuit is OPEN (operation proceeds
   * but callers should log this), or null when the circuit is healthy.
   */
  checkEssential(): string | null {
    const state = this.getState();
    if (state === 'OPEN') {
      return (
        `WARNING: ${this.provider} circuit breaker is OPEN ` +
        `(${this.costAnomalyDetected ? 'cost anomaly' : 'error rate exceeded'}). ` +
        `Proceeding with essential operation.`
      );
    }
    if (state === 'HALF_OPEN') {
      return (
        `WARNING: ${this.provider} circuit breaker is HALF_OPEN ` +
        `(${this.costAnomalyDetected ? 'cost anomaly' : 'error rate exceeded'}). ` +
        `Proceeding cautiously — provider was recently unstable.`
      );
    }
    return null;
  }

  /** Manually reset the circuit to CLOSED (for admin override). */
  reset(): void {
    this.state = 'CLOSED';
    this.lastOpenedAt = null;
    this.costAnomalyDetected = false;
    this.window = [];
    this.costWindow = [];
  }

  private _openCircuit(): void {
    this.state = 'OPEN';
    this.lastOpenedAt = Date.now();
  }

  private _closeCircuit(): void {
    this.state = 'CLOSED';
    this.lastOpenedAt = null;
    this.costAnomalyDetected = false;
    this.window = [];
    this.costWindow = [];
  }

  private _maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'OPEN' &&
      this.lastOpenedAt !== null &&
      Date.now() - this.lastOpenedAt >= this.halfOpenAfterMs
    ) {
      this.state = 'HALF_OPEN';
    }
  }

  private _pruneWindow(): void {
    const cutoff = Date.now() - this.windowMs;
    this.window = this.window.filter((e) => e.timestampMs >= cutoff);
    this.costWindow = this.costWindow.filter((e) => e.timestampMs >= cutoff);
  }

  private _evaluateErrorRate(): void {
    const requestCount = this.window.length;
    if (requestCount < this.minRequestsToEvaluate) return;

    const errorCount = this.window.filter((e) => e.isError).length;
    const errorRate = errorCount / requestCount;

    if (errorRate >= this.errorRateThreshold) {
      this._openCircuit();
    }
  }
}

// ---------------------------------------------------------------------------
// Registry — singleton breakers per provider
// ---------------------------------------------------------------------------

const BREAKER_REGISTRY = new Map<ProviderName, ProviderCircuitBreaker>();

/**
 * Get or create the circuit breaker for a named provider.
 * All breakers are singletons — one per provider name per process.
 */
export function getProviderBreaker(provider: ProviderName): ProviderCircuitBreaker {
  const existing = BREAKER_REGISTRY.get(provider);
  if (existing) return existing;

  const breaker = new ProviderCircuitBreaker(provider, {
    windowMs: CIRCUIT_BREAKER_WINDOW_MS,
    errorRateThreshold: CIRCUIT_BREAKER_DEFAULTS.errorRateThreshold,
    minRequestsToEvaluate: CIRCUIT_BREAKER_DEFAULTS.minRequestsToEvaluate,
    costAnomalyMultiplier: CIRCUIT_BREAKER_DEFAULTS.costAnomalyMultiplier,
    halfOpenAfterMs: CIRCUIT_BREAKER_HALF_OPEN_MS,
  });

  BREAKER_REGISTRY.set(provider, breaker);
  return breaker;
}

/**
 * Get all circuit breaker states — used by the admin endpoint.
 */
export function getAllBreakerStats(): ProviderCircuitStats[] {
  return [...PROVIDER_NAMES].map((name) => getProviderBreaker(name).getStats());
}

/**
 * Reset all circuit breakers (admin action — use carefully).
 */
export function resetAllBreakers(): void {
  for (const breaker of BREAKER_REGISTRY.values()) {
    breaker.reset();
  }
}

/**
 * Reset a specific provider's circuit breaker.
 */
export function resetProviderBreaker(provider: ProviderName): void {
  const breaker = BREAKER_REGISTRY.get(provider);
  if (breaker) {
    breaker.reset();
  } else {
    // Create a fresh one — same as reset
    BREAKER_REGISTRY.set(
      provider,
      new ProviderCircuitBreaker(provider, {
        windowMs: CIRCUIT_BREAKER_WINDOW_MS,
        errorRateThreshold: CIRCUIT_BREAKER_DEFAULTS.errorRateThreshold,
        minRequestsToEvaluate: CIRCUIT_BREAKER_DEFAULTS.minRequestsToEvaluate,
        costAnomalyMultiplier: CIRCUIT_BREAKER_DEFAULTS.costAnomalyMultiplier,
        halfOpenAfterMs: CIRCUIT_BREAKER_HALF_OPEN_MS,
      })
    );
  }
}
