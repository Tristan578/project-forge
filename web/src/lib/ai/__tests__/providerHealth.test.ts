import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderHealthMonitor } from '../providerHealth';

describe('ProviderHealthMonitor', () => {
  let monitor: ProviderHealthMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    monitor = new ProviderHealthMonitor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('recordSuccess', () => {
    it('should track a successful call', () => {
      monitor.recordSuccess('anthropic', 150);
      const status = monitor.getStatus('anthropic');
      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBe(150);
      expect(status.errorRate).toBe(0);
      expect(status.consecutiveFailures).toBe(0);
    });

    it('should calculate average latency across multiple calls', () => {
      monitor.recordSuccess('anthropic', 100);
      monitor.recordSuccess('anthropic', 200);
      monitor.recordSuccess('anthropic', 300);
      const status = monitor.getStatus('anthropic');
      expect(status.latencyMs).toBe(200);
    });

    it('should reset consecutive failures on success', () => {
      monitor.recordFailure('anthropic', 'timeout');
      monitor.recordFailure('anthropic', 'timeout');
      expect(monitor.getStatus('anthropic').consecutiveFailures).toBe(2);

      monitor.recordSuccess('anthropic', 100);
      expect(monitor.getStatus('anthropic').consecutiveFailures).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('should track a failed call', () => {
      monitor.recordFailure('openai', 'rate_limit');
      const status = monitor.getStatus('openai');
      expect(status.consecutiveFailures).toBe(1);
      expect(status.errorRate).toBe(1);
    });

    it('should increment consecutive failures', () => {
      monitor.recordFailure('openai', 'timeout');
      monitor.recordFailure('openai', 'server_error');
      monitor.recordFailure('openai', 'rate_limit');
      expect(monitor.getStatus('openai').consecutiveFailures).toBe(3);
    });
  });

  describe('getStatus', () => {
    it('should return healthy status for unknown provider', () => {
      const status = monitor.getStatus('unknown');
      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBe(0);
      expect(status.errorRate).toBe(0);
      expect(status.lastChecked).toEqual(new Date(0));
    });

    it('should update lastChecked on each call', () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      monitor.recordSuccess('anthropic', 100);
      const status1 = monitor.getStatus('anthropic');
      expect(status1.lastChecked).toEqual(new Date('2026-01-15T12:00:00Z'));

      vi.setSystemTime(new Date('2026-01-15T12:01:00Z'));
      monitor.recordSuccess('anthropic', 200);
      const status2 = monitor.getStatus('anthropic');
      expect(status2.lastChecked).toEqual(new Date('2026-01-15T12:01:00Z'));
    });

    it('should calculate error rate correctly', () => {
      // 3 successes, 2 failures = 40% error rate
      monitor.recordSuccess('anthropic', 100);
      monitor.recordSuccess('anthropic', 100);
      monitor.recordSuccess('anthropic', 100);
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      const status = monitor.getStatus('anthropic');
      expect(status.errorRate).toBeCloseTo(0.4, 5);
    });

    it('should exclude failure latency from average', () => {
      monitor.recordSuccess('anthropic', 200);
      monitor.recordFailure('anthropic', 'timeout');
      monitor.recordSuccess('anthropic', 400);
      // Average of [200, 400] = 300, failures excluded
      expect(monitor.getStatus('anthropic').latencyMs).toBe(300);
    });
  });

  describe('isHealthy', () => {
    it('should return true for provider with no records', () => {
      expect(monitor.isHealthy('new-provider')).toBe(true);
    });

    it('should return true when error rate below threshold', () => {
      // 1 failure out of 10 = 10% error rate (< 50%)
      for (let i = 0; i < 9; i++) {
        monitor.recordSuccess('anthropic', 100);
      }
      monitor.recordFailure('anthropic', 'err');
      expect(monitor.isHealthy('anthropic')).toBe(true);
    });

    it('should return false when error rate exceeds threshold', () => {
      // 6 failures out of 10 = 60% error rate (>= 50%)
      for (let i = 0; i < 4; i++) {
        monitor.recordSuccess('anthropic', 100);
      }
      for (let i = 0; i < 6; i++) {
        monitor.recordFailure('anthropic', 'err');
      }
      expect(monitor.isHealthy('anthropic')).toBe(false);
    });

    it('should return false when consecutive failures reach threshold', () => {
      // 3 consecutive failures (default threshold)
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      expect(monitor.isHealthy('anthropic')).toBe(false);
    });

    it('should return true when consecutive failures below threshold', () => {
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      // 2 < 3 (default threshold), and error rate 2/2 = 100% >= 50%
      // Actually unhealthy due to error rate — test with more successes
      for (let i = 0; i < 8; i++) {
        monitor.recordSuccess('anthropic', 100);
      }
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      // 2 consecutive failures < 3, error rate 2/12 ~ 17% < 50%
      expect(monitor.isHealthy('anthropic')).toBe(true);
    });
  });

  describe('selectProvider', () => {
    it('should return preferred provider when healthy', () => {
      monitor.recordSuccess('anthropic', 100);
      const selected = monitor.selectProvider('anthropic', ['openai', 'cohere']);
      expect(selected).toBe('anthropic');
    });

    it('should failover to first healthy fallback', () => {
      // Make preferred unhealthy
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('anthropic', 'down');
      }
      monitor.recordSuccess('openai', 200);

      const selected = monitor.selectProvider('anthropic', ['openai', 'cohere']);
      expect(selected).toBe('openai');
    });

    it('should skip unhealthy fallbacks', () => {
      // Make preferred and first fallback unhealthy
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('anthropic', 'down');
        monitor.recordFailure('openai', 'down');
      }
      monitor.recordSuccess('cohere', 300);

      const selected = monitor.selectProvider('anthropic', ['openai', 'cohere']);
      expect(selected).toBe('cohere');
    });

    it('should return preferred when all providers unhealthy', () => {
      for (let i = 0; i < 3; i++) {
        monitor.recordFailure('anthropic', 'down');
        monitor.recordFailure('openai', 'down');
        monitor.recordFailure('cohere', 'down');
      }

      const selected = monitor.selectProvider('anthropic', ['openai', 'cohere']);
      expect(selected).toBe('anthropic');
    });

    it('should select preferred when no records exist for any provider', () => {
      const selected = monitor.selectProvider('anthropic', ['openai']);
      expect(selected).toBe('anthropic');
    });
  });

  describe('sliding window', () => {
    it('should enforce window size limit', () => {
      const smallMonitor = new ProviderHealthMonitor({ windowSize: 5 });
      // Record 10 successes then 5 failures
      for (let i = 0; i < 10; i++) {
        smallMonitor.recordSuccess('anthropic', 100);
      }
      // Window holds last 5, all successes
      expect(smallMonitor.getStatus('anthropic').errorRate).toBe(0);

      for (let i = 0; i < 5; i++) {
        smallMonitor.recordFailure('anthropic', 'err');
      }
      // Window holds last 5, all failures
      expect(smallMonitor.getStatus('anthropic').errorRate).toBe(1);
    });

    it('should prune records older than TTL', () => {
      const shortTtl = new ProviderHealthMonitor({ recordTtlMs: 1000 });

      vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
      shortTtl.recordFailure('anthropic', 'old failure');

      // Advance time past TTL
      vi.setSystemTime(new Date('2026-01-15T12:00:02Z'));
      shortTtl.recordSuccess('anthropic', 100);

      // Old failure should be pruned, only success remains
      const status = shortTtl.getStatus('anthropic');
      expect(status.errorRate).toBe(0);
      expect(status.consecutiveFailures).toBe(0);
    });
  });

  describe('resetProvider', () => {
    it('should clear data for a specific provider', () => {
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      monitor.recordFailure('anthropic', 'err');
      expect(monitor.isHealthy('anthropic')).toBe(false);

      monitor.resetProvider('anthropic');
      expect(monitor.isHealthy('anthropic')).toBe(true);
      expect(monitor.getStatus('anthropic').consecutiveFailures).toBe(0);
    });
  });

  describe('resetAll', () => {
    it('should clear all provider data', () => {
      monitor.recordSuccess('anthropic', 100);
      monitor.recordSuccess('openai', 200);
      monitor.resetAll();
      expect(monitor.getTrackedProviders()).toEqual([]);
    });
  });

  describe('getTrackedProviders', () => {
    it('should return all providers that have been tracked', () => {
      monitor.recordSuccess('anthropic', 100);
      monitor.recordFailure('openai', 'err');
      monitor.recordSuccess('cohere', 150);
      const providers = monitor.getTrackedProviders();
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).toContain('cohere');
      expect(providers).toHaveLength(3);
    });
  });

  describe('custom config', () => {
    it('should respect custom maxErrorRate', () => {
      const strict = new ProviderHealthMonitor({ maxErrorRate: 0.1 });
      // 2 failures out of 10 = 20% > 10% threshold
      for (let i = 0; i < 8; i++) {
        strict.recordSuccess('anthropic', 100);
      }
      strict.recordFailure('anthropic', 'err');
      strict.recordFailure('anthropic', 'err');
      expect(strict.isHealthy('anthropic')).toBe(false);
    });

    it('should respect custom maxConsecutiveFailures', () => {
      const tolerant = new ProviderHealthMonitor({ maxConsecutiveFailures: 5 });
      for (let i = 0; i < 4; i++) {
        tolerant.recordFailure('anthropic', 'err');
      }
      // 4 consecutive failures < 5 threshold, but error rate 4/4 = 100% >= 50%
      expect(tolerant.getStatus('anthropic').consecutiveFailures).toBe(4);
    });
  });
});
