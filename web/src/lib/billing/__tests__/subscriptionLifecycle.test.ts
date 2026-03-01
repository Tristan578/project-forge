import { describe, it, expect, beforeEach, vi } from 'vitest';

// These are the only pure (non-DB) functions in subscription-lifecycle
let isEventProcessed: typeof import('../subscription-lifecycle').isEventProcessed;
let markEventProcessed: typeof import('../subscription-lifecycle').markEventProcessed;

describe('subscription-lifecycle idempotency', () => {
  beforeEach(async () => {
    // Reset module state to get a fresh processedEvents Set
    vi.resetModules();
    const mod = await import('../subscription-lifecycle');
    isEventProcessed = mod.isEventProcessed;
    markEventProcessed = mod.markEventProcessed;
  });

  it('should return false for unprocessed events', () => {
    expect(isEventProcessed('evt_123')).toBe(false);
  });

  it('should return true after marking an event as processed', () => {
    markEventProcessed('evt_456');
    expect(isEventProcessed('evt_456')).toBe(true);
  });

  it('should handle multiple events independently', () => {
    markEventProcessed('evt_a');
    markEventProcessed('evt_b');
    expect(isEventProcessed('evt_a')).toBe(true);
    expect(isEventProcessed('evt_b')).toBe(true);
    expect(isEventProcessed('evt_c')).toBe(false);
  });

  it('should be idempotent (marking twice is safe)', () => {
    markEventProcessed('evt_same');
    markEventProcessed('evt_same');
    expect(isEventProcessed('evt_same')).toBe(true);
  });

  it('should evict oldest event when exceeding 10,000 limit', () => {
    // Mark 10,001 events — the first should be evicted
    for (let i = 0; i <= 10_000; i++) {
      markEventProcessed(`evt_${i}`);
    }
    // The very first event should have been evicted
    expect(isEventProcessed('evt_0')).toBe(false);
    // The most recent should still be present
    expect(isEventProcessed('evt_10000')).toBe(true);
  });
});
