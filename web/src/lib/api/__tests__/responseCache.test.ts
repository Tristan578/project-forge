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

  describe('in-flight dedup failure isolation (PF-843, #8667)', () => {
    // The in-flight map shares ONE promise across every caller on a key. To test
    // the joiner path deterministically we need to know the joiner has actually
    // *joined* (attached to the shared promise) before we settle it — otherwise a
    // late joiner would run its own attempt and a regression test would pass for
    // the wrong reason. This helper exposes a thenable whose 2nd `.then`
    // attachment (1st = the originator's internal `await`, 2nd = the joiner's
    // `await`) resolves `whenJoined()`.
    interface JoinDetectable<T> {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (error: unknown) => void;
      whenJoined: () => Promise<void>;
    }

    // `joinThreshold` is the `.then` attachment count at which `whenJoined()`
    // resolves. The originator's internal `await` is the 1st attachment, so the
    // default of 2 fires once a single joiner has attached. Tests with N joiners
    // pass `1 + N` to wait until every joiner has truly joined the shared promise
    // before it is settled.
    function makeJoinDetectable<T>(joinThreshold = 2): JoinDetectable<T> {
      let resolveInner!: (value: T) => void;
      let rejectInner!: (error: unknown) => void;
      const inner = new Promise<T>((res, rej) => {
        resolveInner = res;
        rejectInner = rej;
      });
      let attachCount = 0;
      let signalJoined: (() => void) | undefined;
      const thenable = {
        then(onF?: ((value: T) => unknown) | null, onR?: ((error: unknown) => unknown) | null) {
          attachCount += 1;
          if (attachCount >= joinThreshold) signalJoined?.();
          return inner.then(onF ?? undefined, onR ?? undefined);
        },
      };
      return {
        promise: thenable as unknown as Promise<T>,
        resolve: (value: T) => resolveInner(value),
        reject: (error: unknown) => rejectInner(error),
        whenJoined: () =>
          new Promise<void>((res) => {
            if (attachCount >= joinThreshold) res();
            else signalJoined = res;
          }),
      };
    }

    // A plain externally-controlled deferred (no join detection needed).
    function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('runs the joiner\'s own attempt when the shared in-flight promise rejects', async () => {
      const ctl = makeJoinDetectable<{ audio: string }>();
      const executeFn = vi.fn()
        .mockReturnValueOnce(ctl.promise)               // originator — will reject
        .mockResolvedValueOnce({ audio: 'joiner_own' }); // joiner's independent attempt

      const originator = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(1));
      const joiner = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await ctl.whenJoined();

      ctl.reject(new Error('transient provider blip'));

      // The originator surfaces its own failure...
      await expect(originator).rejects.toThrow('transient provider blip');
      // ...but the joiner is NOT permanently bound to it — it ran its own attempt.
      const joinerResult = await joiner;
      expect(joinerResult.result).toEqual({ audio: 'joiner_own' });
      expect(joinerResult.cached).toBe(false);
      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('rides a concurrently-cached result instead of re-executing after a rejection', async () => {
      const ctl = makeJoinDetectable<{ audio: string }>();
      const executeFn = vi.fn().mockReturnValueOnce(ctl.promise); // ONLY the originator runs; joiner must not call again

      const originator = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(1));
      const joiner = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await ctl.whenJoined();

      // A concurrent sibling attempt populated the cache for this exact key
      // before the shared promise's rejection propagates to the joiner.
      const key = await _generateCacheKey('sfx_generation', { prompt: 'boom' }, 'user_A');
      _memoryCache.set(key, {
        result: { audio: 'sibling_cached' },
        createdAt: 0,
        ttlMs: Number.MAX_SAFE_INTEGER,
        operation: 'sfx_generation',
      });

      ctl.reject(new Error('transient provider blip'));

      await expect(originator).rejects.toThrow('transient provider blip');
      const joinerResult = await joiner;
      // Joiner re-checked the cache after the rejection — no redundant regen/charge.
      expect(joinerResult.result).toEqual({ audio: 'sibling_cached' });
      expect(joinerResult.cached).toBe(true);
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it('lets a same-user joiner independently re-derive the originator\'s ApiKeyError', async () => {
      // The joiner is the SAME user (userId is in the key), so its own attempt
      // hits the same missing-key failure. This is intentional: the joiner
      // correctly re-derives the same 402 rather than inheriting a shared
      // rejection it cannot retry.
      const ctl = makeJoinDetectable<{ audio: string }>();
      const apiKeyError = new Error('No API key configured');
      const executeFn = vi.fn()
        .mockReturnValueOnce(ctl.promise)
        .mockRejectedValueOnce(apiKeyError); // joiner's own attempt — same user, same failure

      const originator = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(1));
      const joiner = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await ctl.whenJoined();

      ctl.reject(apiKeyError);

      await expect(originator).rejects.toThrow('No API key configured');
      await expect(joiner).rejects.toThrow('No API key configured');
      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('GUARD: generateCacheKey must incorporate userId so dedup never spans users', async () => {
      // In-flight dedup shares ONE promise (and its single result/failure) among
      // all joiners on a key. That is only safe because the key includes userId,
      // so joiners are always the SAME user. If userId is ever dropped from the
      // key, different users would dedup onto each other: one user's result would
      // leak to another AND a joiner would ride a generation it never paid for.
      // This guard fails loudly if that invariant is broken.
      const userA = await _generateCacheKey('sfx_generation', { prompt: 'boom' }, 'user_A');
      const userB = await _generateCacheKey('sfx_generation', { prompt: 'boom' }, 'user_B');
      const userAAgain = await _generateCacheKey('sfx_generation', { prompt: 'boom' }, 'user_A');

      expect(userA, 'different users MUST get different cache keys (no cross-user dedup)').not.toBe(userB);
      expect(userAAgain, 'same user + same request MUST get the same key (dedup works)').toBe(userA);
    });

    it('does not evict a sibling joiner\'s in-flight entry when a clobbered joiner settles first', async () => {
      // Regression for the in-flight cleanup race the failure-isolation fall-through
      // exposes. When two joiners fall through after a shared rejection, each
      // registers its OWN in-flight promise — the second overwrites the first in
      // the map. If the first (now-clobbered) joiner then settles and blindly
      // deletes the key, it evicts the SURVIVING joiner's still-live entry, so a
      // later identical request misses dedup and starts a redundant third
      // generation (an extra charge). Cleanup must only remove the entry it owns.
      const originatorCtl = makeJoinDetectable<{ audio: string }>(3); // originator + 2 joiners attach
      const clobberedCtl = makeDeferred<{ audio: string }>();          // first fall-through joiner (overwritten in map)
      const survivorCtl = makeDeferred<{ audio: string }>();           // second fall-through joiner (set last → survives)
      const executeFn = vi.fn()
        .mockReturnValueOnce(originatorCtl.promise) // call 1: originator — rejects
        .mockReturnValueOnce(clobberedCtl.promise)  // call 2: first joiner's own attempt (clobbered)
        .mockReturnValueOnce(survivorCtl.promise);  // call 3: second joiner's own attempt (survives)

      const originator = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(1));
      const joinerA = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      const joinerB = cachedGenerate('sfx_generation', { prompt: 'boom' }, executeFn, { userId: 'user_A' });
      await originatorCtl.whenJoined(); // both joiners have attached to the shared promise

      originatorCtl.reject(new Error('originator failed'));
      // Attach the rejection expectation now so the originator's failure is always
      // handled, even if a later assertion throws and we never reach the await.
      const originatorRejects = expect(originator).rejects.toThrow('originator failed');

      // Both joiners fall through and register their own in-flight promises.
      // call 2 sets first, call 3 overwrites it → the survivor is call 3's entry.
      await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(3));

      const key = await _generateCacheKey('sfx_generation', { prompt: 'boom' }, 'user_A');
      expect(_inFlight.has(key), 'a fall-through joiner must register an in-flight entry').toBe(true);

      // Settle the CLOBBERED joiner (call 2) first and let its cleanup run.
      clobberedCtl.resolve({ audio: 'clobbered' });
      await Promise.race([joinerA, joinerB]); // the clobbered joiner fully settles → its finally runs

      // The surviving joiner's entry (call 3) MUST still be in the map — the
      // clobbered joiner's cleanup must not have evicted an entry it no longer owns.
      expect(
        _inFlight.has(key),
        'clobbered joiner must not evict the surviving joiner\'s in-flight entry',
      ).toBe(true);

      // Once the survivor itself settles, the entry IS cleaned up by its true owner.
      survivorCtl.resolve({ audio: 'survivor' });
      await Promise.all([joinerA, joinerB]);
      await originatorRejects;
      expect(_inFlight.has(key), 'the surviving joiner cleans up its own entry on settle').toBe(false);
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
