import { describe, it, expect, beforeEach, vi } from 'vitest';

// These are the only pure (non-DB) functions in subscription-lifecycle
let claimEvent: typeof import('../subscription-lifecycle').claimEvent;
let releaseEvent: typeof import('../subscription-lifecycle').releaseEvent;

describe('subscription-lifecycle idempotency', () => {
  beforeEach(async () => {
    // Reset module state to get a fresh processedEvents Set
    vi.resetModules();
    const mod = await import('../subscription-lifecycle');
    claimEvent = mod.claimEvent;
    releaseEvent = mod.releaseEvent;
  });

  it('should claim an unprocessed event and return true', () => {
    expect(claimEvent('evt_123')).toBe(true);
  });

  it('should reject a duplicate claim (already processed)', () => {
    claimEvent('evt_456');
    expect(claimEvent('evt_456')).toBe(false);
  });

  it('should handle multiple events independently', () => {
    expect(claimEvent('evt_a')).toBe(true);
    expect(claimEvent('evt_b')).toBe(true);
    // Already claimed
    expect(claimEvent('evt_a')).toBe(false);
    expect(claimEvent('evt_b')).toBe(false);
    // New event still claimable
    expect(claimEvent('evt_c')).toBe(true);
  });

  it('should be idempotent (claiming twice returns false on second attempt)', () => {
    expect(claimEvent('evt_same')).toBe(true);
    expect(claimEvent('evt_same')).toBe(false);
  });

  it('should allow reclaiming after releaseEvent', () => {
    expect(claimEvent('evt_retry')).toBe(true);
    releaseEvent('evt_retry');
    expect(claimEvent('evt_retry')).toBe(true);
  });

  it('releaseEvent is safe to call on unclaimed events', () => {
    // Should not throw
    releaseEvent('evt_never_claimed');
  });

  it('should evict oldest event when exceeding 10,000 limit', () => {
    // Claim 10,001 events — the first should be evicted
    for (let i = 0; i <= 10_000; i++) {
      claimEvent(`evt_${i}`);
    }
    // The very first event should have been evicted, so it's claimable again
    expect(claimEvent('evt_0')).toBe(true);
    // The most recent should still be claimed
    expect(claimEvent('evt_10000')).toBe(false);
  });
});
