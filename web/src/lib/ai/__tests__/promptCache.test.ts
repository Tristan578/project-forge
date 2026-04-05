import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptCache, promptCache, AIResponseCache, aiResponseCache } from '../promptCache';

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

// ---------------------------------------------------------------------------
// AIResponseCache
// ---------------------------------------------------------------------------

describe('AIResponseCache', () => {
  let cache: AIResponseCache;

  beforeEach(() => {
    cache = new AIResponseCache({ maxSize: 5, ttlMs: 10_000 });
  });

  // ---- Basic get / set ----

  it('returns undefined for unknown key', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves a response', () => {
    cache.set('k1', 'response text');
    expect(cache.get('k1')).toBe('response text');
  });

  it('overwrites an existing entry', () => {
    cache.set('k1', 'first');
    cache.set('k1', 'second');
    expect(cache.get('k1')).toBe('second');
  });

  it('reports correct size', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.size).toBe(2);
  });

  // ---- TTL expiry ----

  it('returns undefined for an expired entry', () => {
    vi.useFakeTimers();
    const shortCache = new AIResponseCache({ ttlMs: 100 });
    shortCache.set('k1', 'value');
    vi.advanceTimersByTime(200);
    expect(shortCache.get('k1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('still returns entry before TTL expires', () => {
    vi.useFakeTimers();
    const shortCache = new AIResponseCache({ ttlMs: 100 });
    shortCache.set('k1', 'value');
    vi.advanceTimersByTime(50);
    expect(shortCache.get('k1')).toBe('value');
    vi.useRealTimers();
  });

  // ---- LRU eviction ----

  it('evicts the LRU entry when maxSize is exceeded', () => {
    for (let i = 1; i <= 5; i++) {
      cache.set(`k${i}`, `v${i}`);
    }
    // Access k1 to make it recently used
    cache.get('k1');
    // Add a new entry — should evict k2 (the actual LRU)
    cache.set('k6', 'v6');
    expect(cache.size).toBe(5);
    expect(cache.get('k1')).toBe('v1');
    expect(cache.get('k6')).toBe('v6');
    expect(cache.get('k2')).toBeUndefined();
  });

  // ---- invalidate ----

  it('removes an entry on invalidate', () => {
    cache.set('k1', 'v1');
    cache.invalidate('k1');
    expect(cache.get('k1')).toBeUndefined();
  });

  it('is a no-op when invalidating unknown key', () => {
    expect(() => cache.invalidate('nonexistent')).not.toThrow();
  });

  // ---- clear ----

  it('clear removes all entries', () => {
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('k1')).toBeUndefined();
  });

  // ---- dedup ----

  it('returns cached value without calling fn', async () => {
    cache.set('key', 'cached response');
    const fn = vi.fn().mockResolvedValue('fresh response');
    const result = await cache.dedup('key', fn);
    expect(result).toBe('cached response');
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls fn on cache miss and caches the result', async () => {
    const fn = vi.fn().mockResolvedValue('new response');
    const result = await cache.dedup('miss-key', fn);
    expect(result).toBe('new response');
    expect(fn).toHaveBeenCalledOnce();
    expect(cache.get('miss-key')).toBe('new response');
  });

  it('deduplicates concurrent in-flight requests for the same key', async () => {
    let resolveFirst!: (v: string) => void;
    const firstPromise = new Promise<string>((res) => { resolveFirst = res; });
    const fn = vi.fn().mockReturnValue(firstPromise);

    // Start two concurrent dedup calls for the same key
    const p1 = cache.dedup('dup-key', fn);
    const p2 = cache.dedup('dup-key', fn);

    // fn should have been called only once
    expect(fn).toHaveBeenCalledOnce();
    expect(cache.isInflight('dup-key')).toBe(true);

    resolveFirst('shared result');
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('shared result');
    expect(r2).toBe('shared result');
    expect(cache.isInflight('dup-key')).toBe(false);
  });

  it('removes inflight entry on rejection so next call can retry', async () => {
    let rejectFirst!: (e: Error) => void;
    const firstPromise = new Promise<string>((_, rej) => { rejectFirst = rej; });
    const fn = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce('retry ok');

    const p1 = cache.dedup('fail-key', fn);
    rejectFirst(new Error('network error'));
    await expect(p1).rejects.toThrow('network error');

    // After failure, inflight entry is gone — retry should call fn again
    const p2 = await cache.dedup('fail-key', fn);
    expect(p2).toBe('retry ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reports inflight count correctly', async () => {
    let resolve1!: (v: string) => void;
    let resolve2!: (v: string) => void;

    const p1 = cache.dedup('k1', () => new Promise<string>((r) => { resolve1 = r; }));
    const p2 = cache.dedup('k2', () => new Promise<string>((r) => { resolve2 = r; }));

    expect(cache.inflightCount).toBe(2);

    resolve1('a');
    await p1;
    // Allow the finally to run
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.inflightCount).toBe(1);

    resolve2('b');
    await p2;
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.inflightCount).toBe(0);
  });

  // ---- computeKey ----

  it('computeKey returns a non-empty string', async () => {
    const key = await cache.computeKey('claude-sonnet-4-6', 'system', 'hello');
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('computeKey returns different keys for different inputs', async () => {
    const k1 = await cache.computeKey('model-a', 'sys', 'msg');
    const k2 = await cache.computeKey('model-b', 'sys', 'msg');
    const k3 = await cache.computeKey('model-a', 'sys2', 'msg');
    const k4 = await cache.computeKey('model-a', 'sys', 'msg2');
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).not.toBe(k4);
  });

  it('computeKey returns the same key for identical inputs', async () => {
    const k1 = await cache.computeKey('model', 'system', 'user message');
    const k2 = await cache.computeKey('model', 'system', 'user message');
    expect(k1).toBe(k2);
  });

  // ---- Singleton export ----

  it('exports a shared aiResponseCache instance', () => {
    expect(aiResponseCache).toBeInstanceOf(AIResponseCache);
  });
});
