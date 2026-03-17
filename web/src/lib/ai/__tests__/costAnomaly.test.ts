import { describe, it, expect, beforeEach } from 'vitest';
import { CostAnomalyDetector } from '../costAnomaly';

describe('CostAnomalyDetector', () => {
  let detector: CostAnomalyDetector;

  beforeEach(() => {
    detector = new CostAnomalyDetector();
  });

  describe('recordCost', () => {
    it('should record costs for a provider', () => {
      detector.recordCost('anthropic', 'chat', 0.02);
      expect(detector.getTotalCost('anthropic')).toBeCloseTo(0.02, 5);
    });

    it('should accumulate costs across multiple operations', () => {
      detector.recordCost('anthropic', 'chat', 0.02);
      detector.recordCost('anthropic', 'embedding', 0.001);
      detector.recordCost('anthropic', 'chat', 0.03);
      expect(detector.getTotalCost('anthropic')).toBeCloseTo(0.051, 5);
    });

    it('should track providers independently', () => {
      detector.recordCost('anthropic', 'chat', 0.10);
      detector.recordCost('openai', 'chat', 0.05);
      expect(detector.getTotalCost('anthropic')).toBeCloseTo(0.10, 5);
      expect(detector.getTotalCost('openai')).toBeCloseTo(0.05, 5);
    });

    it('should enforce max records per provider', () => {
      const small = new CostAnomalyDetector({ maxRecordsPerProvider: 5 });
      for (let i = 0; i < 10; i++) {
        small.recordCost('anthropic', 'chat', 1.0);
      }
      // Only last 5 records should remain
      expect(small.getTotalCost('anthropic')).toBeCloseTo(5.0, 5);
    });
  });

  describe('detectAnomaly', () => {
    it('should return no anomaly for unknown provider', () => {
      const result = detector.detectAnomaly('unknown');
      expect(result.anomaly).toBe(false);
      expect(result.currentAvg).toBe(0);
      expect(result.historicalAvg).toBe(0);
    });

    it('should return no anomaly with insufficient historical data', () => {
      // Default minHistoricalRecords = 20, recentWindowSize = 10
      // 15 records total => 5 historical (< 20 min)
      for (let i = 0; i < 15; i++) {
        detector.recordCost('anthropic', 'chat', 0.02);
      }
      const result = detector.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(false);
    });

    it('should detect anomaly when current avg exceeds 2x historical avg', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      // 15 historical records at $0.02
      for (let i = 0; i < 15; i++) {
        det.recordCost('anthropic', 'chat', 0.02);
      }
      // 5 recent records at $0.10 (5x the historical avg)
      for (let i = 0; i < 5; i++) {
        det.recordCost('anthropic', 'chat', 0.10);
      }

      const result = det.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(true);
      expect(result.reason).toContain('Cost spike');
      expect(result.reason).toContain('anthropic');
      expect(result.currentAvg).toBeCloseTo(0.10, 5);
      expect(result.historicalAvg).toBeCloseTo(0.02, 5);
    });

    it('should not detect anomaly when costs are stable', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      // All records at roughly the same cost
      for (let i = 0; i < 20; i++) {
        det.recordCost('anthropic', 'chat', 0.02);
      }

      const result = det.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(false);
      expect(result.currentAvg).toBeCloseTo(0.02, 5);
      expect(result.historicalAvg).toBeCloseTo(0.02, 5);
    });

    it('should not alert at exactly 1.9x (below threshold)', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      for (let i = 0; i < 15; i++) {
        det.recordCost('anthropic', 'chat', 0.10);
      }
      // Recent at 1.9x = $0.19
      for (let i = 0; i < 5; i++) {
        det.recordCost('anthropic', 'chat', 0.19);
      }

      const result = det.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(false);
    });

    it('should alert when cost exceeds 2x threshold', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      for (let i = 0; i < 15; i++) {
        det.recordCost('anthropic', 'chat', 0.10);
      }
      // Recent at 2.1x — clearly above threshold (avoids floating-point edge)
      for (let i = 0; i < 5; i++) {
        det.recordCost('anthropic', 'chat', 0.21);
      }

      const result = det.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(true);
    });

    it('should handle zero historical average with nonzero current', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      // 15 records at $0
      for (let i = 0; i < 15; i++) {
        det.recordCost('anthropic', 'chat', 0);
      }
      // Recent at nonzero
      for (let i = 0; i < 5; i++) {
        det.recordCost('anthropic', 'chat', 0.05);
      }

      const result = det.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(true);
      expect(result.reason).toContain('$0.0000');
    });

    it('should handle zero historical and zero current', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      for (let i = 0; i < 20; i++) {
        det.recordCost('anthropic', 'chat', 0);
      }

      const result = det.detectAnomaly('anthropic');
      expect(result.anomaly).toBe(false);
    });
  });

  describe('detectOperationAnomaly', () => {
    it('should detect anomalies per operation', () => {
      const det = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
      });

      // Chat operations: stable
      for (let i = 0; i < 20; i++) {
        det.recordCost('anthropic', 'chat', 0.02);
      }
      // Embedding operations: spike
      for (let i = 0; i < 15; i++) {
        det.recordCost('anthropic', 'embedding', 0.001);
      }
      for (let i = 0; i < 5; i++) {
        det.recordCost('anthropic', 'embedding', 0.01);
      }

      const chatResult = det.detectOperationAnomaly('anthropic', 'chat');
      expect(chatResult.anomaly).toBe(false);

      const embeddingResult = det.detectOperationAnomaly('anthropic', 'embedding');
      expect(embeddingResult.anomaly).toBe(true);
    });

    it('should return no anomaly for unknown operation', () => {
      detector.recordCost('anthropic', 'chat', 0.02);
      const result = detector.detectOperationAnomaly('anthropic', 'unknown_op');
      expect(result.anomaly).toBe(false);
      expect(result.currentAvg).toBe(0);
    });

    it('should return no anomaly for unknown provider', () => {
      const result = detector.detectOperationAnomaly('unknown', 'chat');
      expect(result.anomaly).toBe(false);
    });
  });

  describe('getTrackedProviders', () => {
    it('should return all tracked providers', () => {
      detector.recordCost('anthropic', 'chat', 0.02);
      detector.recordCost('openai', 'chat', 0.03);
      const providers = detector.getTrackedProviders();
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).toHaveLength(2);
    });

    it('should return empty array when no costs recorded', () => {
      expect(detector.getTrackedProviders()).toEqual([]);
    });
  });

  describe('getTotalCost', () => {
    it('should return 0 for unknown provider', () => {
      expect(detector.getTotalCost('unknown')).toBe(0);
    });
  });

  describe('resetProvider', () => {
    it('should clear data for a specific provider', () => {
      detector.recordCost('anthropic', 'chat', 0.02);
      detector.recordCost('openai', 'chat', 0.03);
      detector.resetProvider('anthropic');
      expect(detector.getTotalCost('anthropic')).toBe(0);
      expect(detector.getTotalCost('openai')).toBeCloseTo(0.03, 5);
    });
  });

  describe('resetAll', () => {
    it('should clear all data', () => {
      detector.recordCost('anthropic', 'chat', 0.02);
      detector.recordCost('openai', 'chat', 0.03);
      detector.resetAll();
      expect(detector.getTrackedProviders()).toEqual([]);
    });
  });

  describe('custom config', () => {
    it('should respect custom anomaly threshold', () => {
      const strict = new CostAnomalyDetector({
        recentWindowSize: 5,
        minHistoricalRecords: 10,
        anomalyThreshold: 1.5,
      });

      for (let i = 0; i < 15; i++) {
        strict.recordCost('anthropic', 'chat', 0.10);
      }
      // 1.6x should trigger at 1.5x threshold
      for (let i = 0; i < 5; i++) {
        strict.recordCost('anthropic', 'chat', 0.16);
      }

      expect(strict.detectAnomaly('anthropic').anomaly).toBe(true);
    });
  });
});
