import 'server-only';
import { isTransientError } from './withRetry';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds in open state before transitioning to half-open. Default: 30000 */
  openTimeoutMs?: number;
  /** Callback fired on state transitions for observability (Sentry, logging). */
  onTransition?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super('Circuit breaker is open — refusing DB request to prevent cascading failures');
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private lastOpenedAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly openTimeoutMs: number;
  private readonly onTransition?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.openTimeoutMs = options.openTimeoutMs ?? 30_000;
    this.onTransition = options.onTransition;
  }

  getState(): CircuitState {
    this._maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * Execute the provided operation through the circuit breaker.
   * Throws CircuitBreakerOpenError immediately when the circuit is open.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this._maybeTransitionToHalfOpen();

    if (this.state === 'open') {
      throw new CircuitBreakerOpenError();
    }

    try {
      const result = await operation();
      this._onSuccess();
      return result;
    } catch (error) {
      // Only count transient errors (connection, timeout) toward the failure
      // threshold. Non-transient errors (auth, syntax, constraints) should not
      // trip the circuit breaker.
      if (isTransientError(error)) {
        this._onFailure();
      }
      throw error;
    }
  }

  /** Reset the circuit breaker to closed state (useful for testing). */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.lastOpenedAt = null;
  }

  /** Expose internal counters for observability (e.g., health checks). */
  getStats(): { state: CircuitState; consecutiveFailures: number; lastOpenedAt: number | null } {
    this._maybeTransitionToHalfOpen();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastOpenedAt: this.lastOpenedAt,
    };
  }

  private _transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    try {
      this.onTransition?.(from, to);
    } catch {
      // Observer errors must not break circuit breaker logic
    }
  }

  private _maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'open' &&
      this.lastOpenedAt !== null &&
      Date.now() - this.lastOpenedAt >= this.openTimeoutMs
    ) {
      this._transition('half-open');
    }
  }

  private _onSuccess(): void {
    if (this.state === 'half-open') {
      // Probe succeeded — close the circuit
      this._transition('closed');
      this.consecutiveFailures = 0;
      this.lastOpenedAt = null;
    } else if (this.state === 'closed') {
      // Normal success — reset failure counter
      this.consecutiveFailures = 0;
    }
  }

  private _onFailure(): void {
    this.consecutiveFailures += 1;

    if (this.state === 'half-open') {
      // Probe failed — go back to open
      this._transition('open');
      this.lastOpenedAt = Date.now();
    } else if (this.state === 'closed' && this.consecutiveFailures >= this.failureThreshold) {
      this._transition('open');
      this.lastOpenedAt = Date.now();
    }
  }
}

/** Singleton circuit breaker for the Neon DB connection. */
export const dbCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  openTimeoutMs: 30_000,
  onTransition: (from, to) => {
    // Lazy import to avoid circular deps — sentry-server is lightweight
    import('@/lib/monitoring/sentry-server').then(({ addBreadcrumb, captureMessage }) => {
      addBreadcrumb({
        category: 'db.circuit_breaker',
        message: `Circuit breaker: ${from} → ${to}`,
        level: to === 'open' ? 'error' : to === 'closed' ? 'info' : 'warning',
        data: { from, to },
      });

      // Alert-level message when circuit opens (DB down) or closes (recovered)
      if (to === 'open') {
        captureMessage(
          `DB circuit breaker opened — refusing connections after ${5} consecutive failures`,
          'error',
        );
      } else if (to === 'closed' && from === 'half-open') {
        captureMessage('DB circuit breaker closed — database connection recovered', 'info');
      }
    }).catch(() => {
      // Sentry unavailable — non-critical
    });
  },
});
