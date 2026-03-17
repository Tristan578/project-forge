import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptCache, promptCache } from '../promptCache';

describe('PromptCache', () => {
  let cache: PromptCache;

  beforeEach(() => {
    cache = new PromptCache({ maxSize: 5, defaultTtlMs: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // Basic set / get
  // ---------------------------------------------------------------------------

  it('returns undefined for unknown key', () => {
    expect(cache.getCachedPrompt('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves a prompt', () => {
    cache.setCachedPrompt('k1', 'hello world');
    expect(cache.getCachedPrompt('k1')).toBe('hello world');
  });

  it('overwrites an existing entry', () => {
    cache.setCachedPrompt('k1', 'first');
    cache.setCachedPrompt('k1', 'second');
    expect(cache.getCachedPrompt('k1')).toBe('second');
  });

  // ---------------------------------------------------------------------------
  // TTL expiry
  // ---------------------------------------------------------------------------

  it('returns undefined for an expired entry', () => {
    vi.useFakeTimers();
    cache.setCachedPrompt('k1', 'value', 100);
    vi.advanceTimersByTime(200);
    expect(cache.getCachedPrompt('k1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('still returns entry before TTL expires', () => {
    vi.useFakeTimers();
    cache.setCachedPrompt('k1', 'value', 100);
    vi.advanceTimersByTime(50);
    expect(cache.getCachedPrompt('k1')).toBe('value');
    vi.useRealTimers();
  });

  it('counts TTL miss as miss in stats', () => {
    vi.useFakeTimers();
    cache.setCachedPrompt('k1', 'value', 100);
    vi.advanceTimersByTime(200);
    cache.getCachedPrompt('k1');
    expect(cache.stats.misses).toBe(1);
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Hit / miss tracking
  // ---------------------------------------------------------------------------

  it('increments hit count on successful get', () => {
    cache.setCachedPrompt('k1', 'value');
    cache.getCachedPrompt('k1');
    expect(cache.stats.hits).toBe(1);
    expect(cache.stats.misses).toBe(0);
  });

  it('increments miss count on cache miss', () => {
    cache.getCachedPrompt('missing');
    expect(cache.stats.hits).toBe(0);
    expect(cache.stats.misses).toBe(1);
  });

  it('computes hit rate correctly', () => {
    cache.setCachedPrompt('k1', 'v');
    cache.getCachedPrompt('k1');  // hit
    cache.getCachedPrompt('k2');  // miss
    expect(cache.stats.hitRate).toBeCloseTo(0.5);
  });

  it('reports zero hit rate when no accesses', () => {
    expect(cache.stats.hitRate).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // LRU eviction
  // ---------------------------------------------------------------------------

  it('evicts the LRU entry when maxSize is exceeded', () => {
    for (let i = 1; i <= 5; i++) {
      cache.setCachedPrompt(`k${i}`, `v${i}`);
    }
    expect(cache.stats.size).toBe(5);
    // Access k1 to make it recently used
    cache.getCachedPrompt('k1');
    // Add a new entry — should evict k2 (the actual LRU after the k1 access)
    cache.setCachedPrompt('k6', 'v6');
    expect(cache.stats.size).toBe(5);
    expect(cache.getCachedPrompt('k1')).toBe('v1');
    expect(cache.getCachedPrompt('k6')).toBe('v6');
    // k2 should be gone (it was LRU)
    expect(cache.getCachedPrompt('k2')).toBeUndefined();
  });

  it('does not evict when below maxSize', () => {
    cache.setCachedPrompt('k1', 'v1');
    cache.setCachedPrompt('k2', 'v2');
    expect(cache.stats.size).toBe(2);
    expect(cache.getCachedPrompt('k1')).toBe('v1');
    expect(cache.getCachedPrompt('k2')).toBe('v2');
  });

  // ---------------------------------------------------------------------------
  // invalidate / invalidatePrefix
  // ---------------------------------------------------------------------------

  it('removes an entry on invalidate', () => {
    cache.setCachedPrompt('k1', 'v1');
    cache.invalidate('k1');
    expect(cache.getCachedPrompt('k1')).toBeUndefined();
  });

  it('is a no-op when invalidating unknown key', () => {
    expect(() => cache.invalidate('nonexistent')).not.toThrow();
  });

  it('removes all entries matching prefix', () => {
    cache.setCachedPrompt('scene:a', 'va');
    cache.setCachedPrompt('scene:b', 'vb');
    cache.setCachedPrompt('other', 'vo');
    cache.invalidatePrefix('scene:');
    expect(cache.getCachedPrompt('scene:a')).toBeUndefined();
    expect(cache.getCachedPrompt('scene:b')).toBeUndefined();
    expect(cache.getCachedPrompt('other')).toBe('vo');
  });

  // ---------------------------------------------------------------------------
  // pruneExpired
  // ---------------------------------------------------------------------------

  it('prunes expired entries and reduces size', () => {
    vi.useFakeTimers();
    cache.setCachedPrompt('k1', 'v1', 100);
    cache.setCachedPrompt('k2', 'v2', 10_000);
    vi.advanceTimersByTime(200);
    cache.pruneExpired();
    expect(cache.stats.size).toBe(1);
    expect(cache.getCachedPrompt('k2')).toBe('v2');
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------

  it('clears all entries and resets stats', () => {
    cache.setCachedPrompt('k1', 'v1');
    cache.getCachedPrompt('k1');
    cache.clear();
    expect(cache.stats.size).toBe(0);
    expect(cache.stats.hits).toBe(0);
    expect(cache.stats.misses).toBe(0);
    expect(cache.getCachedPrompt('k1')).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Default options
  // ---------------------------------------------------------------------------

  it('uses 50 max size and 5m TTL by default', () => {
    const c = new PromptCache();
    // Fill past 50 and verify size stays at 50
    for (let i = 0; i < 55; i++) {
      c.setCachedPrompt(`k${i}`, `v${i}`);
    }
    expect(c.stats.size).toBe(50);
  });

  // ---------------------------------------------------------------------------
  // Singleton export
  // ---------------------------------------------------------------------------

  it('exports a shared promptCache instance', () => {
    expect(promptCache).toBeInstanceOf(PromptCache);
  });
});
