/**
 * Provider health monitoring with sliding window tracking and automatic failover.
 *
 * Tracks success/failure rates and latency per provider using an in-memory
 * sliding window of the last N calls. Unhealthy providers are skipped during
 * provider selection, enabling automatic failover to backup providers.
 */

/** Health status snapshot for a single provider */
export interface ProviderStatus {
  provider: string;
  healthy: boolean;
  latencyMs: number;
  errorRate: number;
  lastChecked: Date;
  consecutiveFailures: number;
}

/** Internal record for a single call outcome */
interface CallRecord {
  timestamp: number;
  success: boolean;
  latencyMs: number;
  error?: string;
}

/** Per-provider tracking state */
interface ProviderState {
  records: CallRecord[];
  consecutiveFailures: number;
  lastChecked: number;
}

/** Configuration for the health monitor */
export interface HealthMonitorConfig {
  /** Maximum number of records to keep per provider (sliding window size) */
  windowSize: number;
  /** Maximum error rate (0-1) before a provider is considered unhealthy */
  maxErrorRate: number;
  /** Maximum consecutive failures before a provider is considered unhealthy */
  maxConsecutiveFailures: number;
  /** Time in ms after which stale records are pruned from the window */
  recordTtlMs: number;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  windowSize: 100,
  maxErrorRate: 0.5,
  maxConsecutiveFailures: 3,
  recordTtlMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Monitors provider health using a sliding window of recent call outcomes.
 *
 * Usage:
 * ```ts
 * const monitor = new ProviderHealthMonitor();
 * monitor.recordSuccess('anthropic', 150);
 * monitor.recordFailure('openai', 'timeout');
 * const provider = monitor.selectProvider('openai', ['anthropic', 'cohere']);
 * ```
 */
export class ProviderHealthMonitor {
  private readonly providers = new Map<string, ProviderState>();
  private readonly config: HealthMonitorConfig;

  constructor(config?: Partial<HealthMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Record a successful call to a provider */
  recordSuccess(provider: string, latencyMs: number): void {
    const state = this.getOrCreateState(provider);
    state.records.push({
      timestamp: Date.now(),
      success: true,
      latencyMs,
    });
    state.consecutiveFailures = 0;
    state.lastChecked = Date.now();
    this.pruneRecords(state);
  }

  /** Record a failed call to a provider */
  recordFailure(provider: string, error: string): void {
    const state = this.getOrCreateState(provider);
    state.records.push({
      timestamp: Date.now(),
      success: false,
      latencyMs: 0,
      error,
    });
    state.consecutiveFailures += 1;
    state.lastChecked = Date.now();
    this.pruneRecords(state);
  }

  /** Get the current health status of a provider */
  getStatus(provider: string): ProviderStatus {
    const state = this.providers.get(provider);
    if (!state || state.records.length === 0) {
      return {
        provider,
        healthy: true,
        latencyMs: 0,
        errorRate: 0,
        lastChecked: new Date(0),
        consecutiveFailures: 0,
      };
    }

    const errorRate = this.calculateErrorRate(state);
    const latencyMs = this.calculateAverageLatency(state);
    const healthy =
      errorRate < this.config.maxErrorRate &&
      state.consecutiveFailures < this.config.maxConsecutiveFailures;

    return {
      provider,
      healthy,
      latencyMs,
      errorRate,
      lastChecked: new Date(state.lastChecked),
      consecutiveFailures: state.consecutiveFailures,
    };
  }

  /** Returns true if the provider is currently healthy */
  isHealthy(provider: string): boolean {
    return this.getStatus(provider).healthy;
  }

  /**
   * Select the best available provider from a preferred + fallback list.
   * Returns the first healthy provider, or the preferred provider if all are unhealthy.
   */
  selectProvider(preferred: string, fallbacks: string[]): string {
    if (this.isHealthy(preferred)) {
      return preferred;
    }

    for (const fallback of fallbacks) {
      if (this.isHealthy(fallback)) {
        return fallback;
      }
    }

    // All unhealthy — return preferred as last resort
    return preferred;
  }

  /** Reset all tracking data for a provider */
  resetProvider(provider: string): void {
    this.providers.delete(provider);
  }

  /** Reset all tracking data */
  resetAll(): void {
    this.providers.clear();
  }

  /** Get all tracked provider names */
  getTrackedProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  private getOrCreateState(provider: string): ProviderState {
    let state = this.providers.get(provider);
    if (!state) {
      state = { records: [], consecutiveFailures: 0, lastChecked: 0 };
      this.providers.set(provider, state);
    }
    return state;
  }

  private pruneRecords(state: ProviderState): void {
    const now = Date.now();
    const cutoff = now - this.config.recordTtlMs;

    // Remove expired records
    state.records = state.records.filter((r) => r.timestamp >= cutoff);

    // Enforce window size limit
    if (state.records.length > this.config.windowSize) {
      state.records = state.records.slice(state.records.length - this.config.windowSize);
    }
  }

  private calculateErrorRate(state: ProviderState): number {
    if (state.records.length === 0) return 0;
    const failures = state.records.filter((r) => !r.success).length;
    return failures / state.records.length;
  }

  private calculateAverageLatency(state: ProviderState): number {
    const successRecords = state.records.filter((r) => r.success);
    if (successRecords.length === 0) return 0;
    const total = successRecords.reduce((sum, r) => sum + r.latencyMs, 0);
    return Math.round(total / successRecords.length);
  }
}

/** Singleton instance for application-wide provider health monitoring */
export const providerHealthMonitor = new ProviderHealthMonitor();
