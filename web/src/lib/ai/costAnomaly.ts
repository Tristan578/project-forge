/**
 * Cost anomaly detection using rolling average comparison.
 *
 * Tracks per-provider, per-operation costs and detects anomalies by comparing
 * recent cost averages against historical averages. Alerts when the recent
 * window exceeds 2x the historical average.
 */

/** Result of an anomaly detection check */
export interface AnomalyResult {
  anomaly: boolean;
  reason?: string;
  currentAvg: number;
  historicalAvg: number;
}

/** Internal cost record */
interface CostRecord {
  timestamp: number;
  provider: string;
  operation: string;
  costUsd: number;
}

/** Configuration for the anomaly detector */
export interface AnomalyDetectorConfig {
  /** Number of recent records to compare (the "current" window) */
  recentWindowSize: number;
  /** Minimum number of historical records required before alerting */
  minHistoricalRecords: number;
  /** Multiplier threshold — current avg must exceed historical avg * this value */
  anomalyThreshold: number;
  /** Maximum records to keep per provider */
  maxRecordsPerProvider: number;
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  recentWindowSize: 10,
  minHistoricalRecords: 20,
  anomalyThreshold: 2.0,
  maxRecordsPerProvider: 1000,
};

/**
 * Detects cost anomalies by comparing recent costs against historical averages.
 *
 * Usage:
 * ```ts
 * const detector = new CostAnomalyDetector();
 * detector.recordCost('anthropic', 'chat', 0.02);
 * const result = detector.detectAnomaly('anthropic');
 * if (result.anomaly) console.warn(result.reason);
 * ```
 */
export class CostAnomalyDetector {
  private readonly records = new Map<string, CostRecord[]>();
  private readonly config: AnomalyDetectorConfig;

  constructor(config?: Partial<AnomalyDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Record a cost event for a provider and operation */
  recordCost(provider: string, operation: string, costUsd: number): void {
    let providerRecords = this.records.get(provider);
    if (!providerRecords) {
      providerRecords = [];
      this.records.set(provider, providerRecords);
    }

    providerRecords.push({
      timestamp: Date.now(),
      provider,
      operation,
      costUsd,
    });

    // Enforce max records
    if (providerRecords.length > this.config.maxRecordsPerProvider) {
      const excess = providerRecords.length - this.config.maxRecordsPerProvider;
      providerRecords.splice(0, excess);
    }
  }

  /**
   * Detect whether the provider's recent costs are anomalous.
   *
   * Compares the average cost of the most recent `recentWindowSize` records
   * against the average of all older (historical) records.
   *
   * Returns no anomaly if there is insufficient historical data.
   */
  detectAnomaly(provider: string): AnomalyResult {
    const providerRecords = this.records.get(provider);

    if (!providerRecords || providerRecords.length === 0) {
      return { anomaly: false, currentAvg: 0, historicalAvg: 0 };
    }

    const totalRecords = providerRecords.length;
    const recentCount = Math.min(this.config.recentWindowSize, totalRecords);
    const historicalCount = totalRecords - recentCount;

    // Not enough historical data to compare against
    if (historicalCount < this.config.minHistoricalRecords) {
      const avg = this.average(providerRecords.map((r) => r.costUsd));
      return { anomaly: false, currentAvg: avg, historicalAvg: avg };
    }

    const historicalRecords = providerRecords.slice(0, historicalCount);
    const recentRecords = providerRecords.slice(totalRecords - recentCount);

    const historicalAvg = this.average(historicalRecords.map((r) => r.costUsd));
    const currentAvg = this.average(recentRecords.map((r) => r.costUsd));

    // Avoid division by zero — if historical average is 0, any nonzero cost is anomalous
    if (historicalAvg === 0) {
      if (currentAvg > 0) {
        return {
          anomaly: true,
          reason: `Cost spike detected for ${provider}: current avg $${currentAvg.toFixed(4)} vs historical avg $0.0000`,
          currentAvg,
          historicalAvg,
        };
      }
      return { anomaly: false, currentAvg: 0, historicalAvg: 0 };
    }

    const ratio = currentAvg / historicalAvg;
    if (ratio >= this.config.anomalyThreshold) {
      return {
        anomaly: true,
        reason: `Cost spike detected for ${provider}: current avg $${currentAvg.toFixed(4)} is ${ratio.toFixed(1)}x the historical avg $${historicalAvg.toFixed(4)}`,
        currentAvg,
        historicalAvg,
      };
    }

    return { anomaly: false, currentAvg, historicalAvg };
  }

  /**
   * Detect anomalies for a specific operation within a provider.
   */
  detectOperationAnomaly(provider: string, operation: string): AnomalyResult {
    const providerRecords = this.records.get(provider);

    if (!providerRecords) {
      return { anomaly: false, currentAvg: 0, historicalAvg: 0 };
    }

    const opRecords = providerRecords.filter((r) => r.operation === operation);
    if (opRecords.length === 0) {
      return { anomaly: false, currentAvg: 0, historicalAvg: 0 };
    }

    const totalRecords = opRecords.length;
    const recentCount = Math.min(this.config.recentWindowSize, totalRecords);
    const historicalCount = totalRecords - recentCount;

    if (historicalCount < this.config.minHistoricalRecords) {
      const avg = this.average(opRecords.map((r) => r.costUsd));
      return { anomaly: false, currentAvg: avg, historicalAvg: avg };
    }

    const historicalRecords = opRecords.slice(0, historicalCount);
    const recentRecords = opRecords.slice(totalRecords - recentCount);

    const historicalAvg = this.average(historicalRecords.map((r) => r.costUsd));
    const currentAvg = this.average(recentRecords.map((r) => r.costUsd));

    if (historicalAvg === 0) {
      if (currentAvg > 0) {
        return {
          anomaly: true,
          reason: `Cost spike for ${provider}/${operation}: current avg $${currentAvg.toFixed(4)} vs $0.0000`,
          currentAvg,
          historicalAvg,
        };
      }
      return { anomaly: false, currentAvg: 0, historicalAvg: 0 };
    }

    const ratio = currentAvg / historicalAvg;
    if (ratio >= this.config.anomalyThreshold) {
      return {
        anomaly: true,
        reason: `Cost spike for ${provider}/${operation}: current avg $${currentAvg.toFixed(4)} is ${ratio.toFixed(1)}x historical avg $${historicalAvg.toFixed(4)}`,
        currentAvg,
        historicalAvg,
      };
    }

    return { anomaly: false, currentAvg, historicalAvg };
  }

  /** Get the total cost recorded for a provider */
  getTotalCost(provider: string): number {
    const providerRecords = this.records.get(provider);
    if (!providerRecords) return 0;
    return providerRecords.reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Get all tracked provider names */
  getTrackedProviders(): string[] {
    return Array.from(this.records.keys());
  }

  /** Reset all data for a provider */
  resetProvider(provider: string): void {
    this.records.delete(provider);
  }

  /** Reset all tracking data */
  resetAll(): void {
    this.records.clear();
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}

/** Singleton instance for application-wide cost anomaly detection */
export const costAnomalyDetector = new CostAnomalyDetector();
