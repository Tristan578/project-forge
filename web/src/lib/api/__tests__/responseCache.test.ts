import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cachedGenerate,
  getCachedResult,
  invalidateCache,
  getCacheStats,
  _generateCacheKey,
  _memoryCache,
  _inFlight,
} from '../responseCache';

// Clear cache and in-flight state between tests
beforeEach(() => {
  _memoryCache.clear();
  _inFlight.clear();
});

describe('responseCache', () => {
  describe('generateCacheKey', () => {
    it('produces consistent keys for same inputs', async () => {
      const key1 = await _generateCacheKey('sfx', { prompt: 'explosion', duration: 3 });
      const key2 = await _generateCacheKey('sfx', { prompt: 'explosion', duration: 3 });
      expect(key1).toBe(key2);
    });

    it('produces different keys for different params', async () => {
      const key1 = await _generateCacheKey('sfx', { prompt: 'explosion' });
      const key2 = await _generateCacheKey('sfx', { prompt: 'rain' });
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different operations', async () => {
      const key1 = await _generateCacheKey('sfx', { prompt: 'explosion' });
      const key2 = await _generateCacheKey('texture', { prompt: 'explosion' });
      expect(key1).not.toBe(key2);
    });

    it('includes operation prefix in key', async () => {
      const key = await _generateCacheKey('sfx_generation', { prompt: 'test' });
      expect(key).toMatch(/^gen-cache:sfx_generation:/);
    });

    it('produces different keys for different userIds', async () => {
      const key1 = await _generateCacheKey('sfx', { prompt: 'boom' }, 'user_A');
      const key2 = await _generateCacheKey('sfx', { prompt: 'boom' }, 'user_B');
      expect(key1).not.toBe(key2);
    });

    it('treats undefined userId same as no userId', async () => {
      const key1 = await _generateCacheKey('sfx', { prompt: 'boom' });
      const key2 = await _generateCacheKey('sfx', { prompt: 'boom' }, undefined);
      expect(key1).toBe(key2);
    });

    it('handles params with undefined values consistently', async () => {
      const key1 = await _generateCacheKey('sfx', { prompt: 'boom', extra: undefined });
      const key2 = await _generateCacheKey('sfx', { prompt: 'boom', extra: undefined });
      expect(key1).toBe(key2);
    });
  });

  describe('cachedGenerate', () => {
    it('executes function on first call', async () => {
      const executeFn = vi.fn().mockResolvedValue({ audio: 'base64data' });

      const result = await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(result.cached).toBe(false);
      expect(result.result).toEqual({ audio: 'base64data' });
    });

    it('returns cached result on second call', async () => {
      const executeFn = vi.fn().mockResolvedValue({ audio: 'base64data' });

      await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);
      const result = await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(result.cached).toBe(true);
      expect(result.result).toEqual({ audio: 'base64data' });
    });

    it('executes for different params', async () => {
      const executeFn = vi.fn()
        .mockResolvedValueOnce({ audio: 'boom' })
        .mockResolvedValueOnce({ audio: 'rain' });

      await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);
      await cachedGenerate('sfx_generation', { prompt: 'rain' }, executeFn);

      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('skips cache when skipCache is true', async () => {
      const executeFn = vi.fn().mockResolvedValue({ audio: 'data' });

      await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { skipCache: true });
      await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { skipCache: true });

      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('never caches chat operations', async () => {
      const executeFn = vi.fn().mockResolvedValue({ message: 'hi' });

      await cachedGenerate('chat', { prompt: 'hello' }, executeFn);
      await cachedGenerate('chat', { prompt: 'hello' }, executeFn);

      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('deduplicates in-flight requests', async () => {
      let resolveFirst: (value: { audio: string }) => void;
      const firstPromise = new Promise<{ audio: string }>((resolve) => {
        resolveFirst = resolve;
      });

      const executeFn = vi.fn().mockReturnValue(firstPromise);

      const promise1 = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);
      // Let the first call's async key generation settle before starting the second
      await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(1));
      const promise2 = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);

      resolveFirst!({ audio: 'data' });
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.result).toEqual({ audio: 'data' });
      expect(result2.result).toEqual({ audio: 'data' });
      expect(result2.cached).toBe(true);
    });

    it('isolates cache entries per userId', async () => {
      const executeFn = vi.fn()
        .mockResolvedValueOnce({ audio: 'user_a_result' })
        .mockResolvedValueOnce({ audio: 'user_b_result' });

      const resultA = await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      const resultB = await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_B' });

      expect(executeFn).toHaveBeenCalledTimes(2);
      expect(resultA.result).toEqual({ audio: 'user_a_result' });
      expect(resultB.result).toEqual({ audio: 'user_b_result' });
    });

    it('does not cache on execution failure', async () => {
      const executeFn = vi.fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce({ audio: 'data' });

      await expect(
        cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn)
      ).rejects.toThrow('provider down');

      // Second call should re-execute (not return cached error)
      const result = await cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn);
      expect(executeFn).toHaveBeenCalledTimes(2);
      expect(result.cached).toBe(false);
    });
  });

  describe('getCachedResult', () => {
    it('returns hit:false when nothing is cached', async () => {
      const result = await getCachedResult('sfx_generation', { prompt: 'boom' });
      expect(result.hit).toBe(false);
    });

    it('returns hit:true after cachedGenerate populates the cache', async () => {
      await cachedGenerate('sfx_generation', { prompt: 'boom' }, async () => ({ audio: 'data' }));

      const result = await getCachedResult<{ audio: string }>('sfx_generation', { prompt: 'boom' });
      expect(result.hit).toBe(true);
      if (result.hit) {
        expect(result.result).toEqual({ audio: 'data' });
      }
    });

    it('returns hit:false for chat operations', async () => {
      const result = await getCachedResult('chat', { prompt: 'hello' });
      expect(result.hit).toBe(false);
    });
  });

  describe('invalidateCache', () => {
    it('clears all entries when no operation specified', async () => {
      await cachedGenerate('sfx_generation', { prompt: 'boom' }, async () => ({ audio: 'a' }));
      await cachedGenerate('texture_generation', { prompt: 'stone' }, async () => ({ img: 'b' }));
      expect(_memoryCache.size).toBe(2);

      await invalidateCache();
      expect(_memoryCache.size).toBe(0);
    });

    it('clears only matching operation entries', async () => {
      await cachedGenerate('sfx_generation', { prompt: 'boom' }, async () => ({ audio: 'a' }));
      await cachedGenerate('texture_generation', { prompt: 'stone' }, async () => ({ img: 'b' }));

      await invalidateCache('sfx_generation');
      expect(_memoryCache.size).toBe(1);
    });
  });

  describe('getCacheStats', () => {
    it('reports memory entries', async () => {
      await cachedGenerate('sfx_generation', { prompt: 'boom' }, async () => ({ audio: 'data' }));
      const stats = getCacheStats();
      expect(stats.memoryEntries).toBe(1);
      expect(stats.memoryMaxEntries).toBe(30);
      expect(stats.inFlightRequests).toBe(0);
    });
  });

  describe('TTL expiry', () => {
    it('expires cached entries after TTL', async () => {
      vi.useFakeTimers();

      await cachedGenerate('sfx_generation', { prompt: 'boom' }, async () => ({ audio: 'data' }), {
        ttlSeconds: 60,
      });

      // Should be cached
      const result1 = await getCachedResult('sfx_generation', { prompt: 'boom' });
      expect(result1.hit).toBe(true);

      // Advance past TTL
      vi.advanceTimersByTime(61_000);

      // Should be expired
      const result2 = await getCachedResult('sfx_generation', { prompt: 'boom' });
      expect(result2.hit).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entries when at capacity', async () => {
      // Fill cache to capacity (30 entries)
      for (let i = 0; i < 30; i++) {
        await cachedGenerate('sfx_generation', { prompt: `sound_${i}` }, async () => ({ id: i }));
      }
      expect(_memoryCache.size).toBe(30);

      // Add one more — should evict the oldest
      await cachedGenerate('sfx_generation', { prompt: 'sound_30' }, async () => ({ id: 30 }));
      expect(_memoryCache.size).toBe(30);

      // First entry should be evicted
      const firstResult = await getCachedResult('sfx_generation', { prompt: 'sound_0' });
      expect(firstResult.hit).toBe(false);

      // Last entry should still be cached
      const lastResult = await getCachedResult('sfx_generation', { prompt: 'sound_30' });
      expect(lastResult.hit).toBe(true);
    });
  });
});
