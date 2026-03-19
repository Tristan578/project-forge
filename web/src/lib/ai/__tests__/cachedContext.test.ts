import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedSceneContext,
  getCachedSystemPrompt,
  invalidateSceneCache,
  getCachedCompoundAnalysis,
  invalidateCompoundAnalysis,
  invalidateAllCaches,
} from '../cachedContext';
import { promptCache } from '../promptCache';

beforeEach(() => {
  // Start each test with a clean cache
  invalidateAllCaches();
});

afterEach(() => {
  vi.useRealTimers();
  invalidateAllCaches();
});

// ---------------------------------------------------------------------------
// getCachedSystemPrompt
// ---------------------------------------------------------------------------

describe('getCachedSystemPrompt', () => {
  it('calls buildFn on first call (cache miss)', () => {
    const buildFn = vi.fn(() => 'system prompt text');
    const result = getCachedSystemPrompt(buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
    expect(result).toBe('system prompt text');
  });

  it('returns cached value on subsequent calls without calling buildFn', () => {
    const buildFn = vi.fn(() => 'system prompt text');
    getCachedSystemPrompt(buildFn);
    const result = getCachedSystemPrompt(buildFn);
    expect(buildFn).toHaveBeenCalledOnce(); // not called again
    expect(result).toBe('system prompt text');
  });

  it('cached value persists across multiple calls', () => {
    const buildFn = vi.fn(() => 'cached system');
    getCachedSystemPrompt(buildFn);
    getCachedSystemPrompt(buildFn);
    getCachedSystemPrompt(buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// getCachedSceneContext + invalidateSceneCache
// ---------------------------------------------------------------------------

describe('getCachedSceneContext', () => {
  it('calls buildFn on first call (cache miss)', () => {
    const buildFn = vi.fn(() => 'scene context v1');
    const result = getCachedSceneContext(buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
    expect(result).toBe('scene context v1');
  });

  it('returns cached value on second call without calling buildFn', () => {
    const buildFn = vi.fn(() => 'scene context v1');
    getCachedSceneContext(buildFn);
    const result = getCachedSceneContext(buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
    expect(result).toBe('scene context v1');
  });

  it('rebuilds after invalidateSceneCache()', () => {
    let callCount = 0;
    const buildFn = vi.fn(() => {
      callCount++;
      return `scene context v${callCount}`;
    });

    expect(getCachedSceneContext(buildFn)).toBe('scene context v1');
    invalidateSceneCache();
    expect(getCachedSceneContext(buildFn)).toBe('scene context v2');
    expect(buildFn).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh=true bypasses cache and rebuilds', () => {
    let callCount = 0;
    const buildFn = vi.fn(() => {
      callCount++;
      return `scene v${callCount}`;
    });

    expect(getCachedSceneContext(buildFn)).toBe('scene v1');
    expect(getCachedSceneContext(buildFn, true)).toBe('scene v2');
    expect(buildFn).toHaveBeenCalledTimes(2);
  });

  it('stores forceRefresh result in cache for subsequent non-forced calls', () => {
    let callCount = 0;
    const buildFn = vi.fn(() => {
      callCount++;
      return `scene v${callCount}`;
    });

    getCachedSceneContext(buildFn, true); // force build — stores v1
    const result = getCachedSceneContext(buildFn); // should use cached v1
    expect(result).toBe('scene v1');
    expect(buildFn).toHaveBeenCalledOnce();
  });

  it('invalidateSceneCache does not affect system prompt cache', () => {
    const sysBuildFn = vi.fn(() => 'system prompt');
    const ctxBuildFn = vi.fn(() => 'scene context');

    getCachedSystemPrompt(sysBuildFn);
    getCachedSceneContext(ctxBuildFn);

    invalidateSceneCache();

    getCachedSystemPrompt(sysBuildFn); // should still be cached
    getCachedSceneContext(ctxBuildFn); // should rebuild

    expect(sysBuildFn).toHaveBeenCalledOnce();
    expect(ctxBuildFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getCachedCompoundAnalysis + invalidateCompoundAnalysis
// ---------------------------------------------------------------------------

describe('getCachedCompoundAnalysis', () => {
  it('calls buildFn on first call (cache miss)', () => {
    const buildFn = vi.fn(() => 'analysis result');
    const result = getCachedCompoundAnalysis('describe:abc123', buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
    expect(result).toBe('analysis result');
  });

  it('returns cached result on second call', () => {
    const buildFn = vi.fn(() => 'analysis result');
    getCachedCompoundAnalysis('describe:abc123', buildFn);
    const result = getCachedCompoundAnalysis('describe:abc123', buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
    expect(result).toBe('analysis result');
  });

  it('different keys are cached independently', () => {
    const buildFn1 = vi.fn(() => 'result 1');
    const buildFn2 = vi.fn(() => 'result 2');
    getCachedCompoundAnalysis('describe:hash1', buildFn1);
    getCachedCompoundAnalysis('analyze:hash2', buildFn2);
    expect(getCachedCompoundAnalysis('describe:hash1', buildFn1)).toBe('result 1');
    expect(getCachedCompoundAnalysis('analyze:hash2', buildFn2)).toBe('result 2');
    // Both factories called once each
    expect(buildFn1).toHaveBeenCalledOnce();
    expect(buildFn2).toHaveBeenCalledOnce();
  });

  it('invalidateCompoundAnalysis clears specific key', () => {
    let count = 0;
    const buildFn = vi.fn(() => {
      count++;
      return `result ${count}`;
    });

    getCachedCompoundAnalysis('describe:key', buildFn);
    invalidateCompoundAnalysis('describe:key');
    const result = getCachedCompoundAnalysis('describe:key', buildFn);
    expect(result).toBe('result 2');
    expect(buildFn).toHaveBeenCalledTimes(2);
  });

  it('expires after 30 seconds', () => {
    vi.useFakeTimers();
    const buildFn = vi.fn(() => 'result');
    getCachedCompoundAnalysis('analyze:key', buildFn);
    vi.advanceTimersByTime(30_001);
    getCachedCompoundAnalysis('analyze:key', buildFn);
    expect(buildFn).toHaveBeenCalledTimes(2);
  });

  it('does not expire before 30 seconds', () => {
    vi.useFakeTimers();
    const buildFn = vi.fn(() => 'result');
    getCachedCompoundAnalysis('analyze:key', buildFn);
    vi.advanceTimersByTime(29_999);
    getCachedCompoundAnalysis('analyze:key', buildFn);
    expect(buildFn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// invalidateAllCaches
// ---------------------------------------------------------------------------

describe('invalidateAllCaches', () => {
  it('clears scene context, system prompt, and compound analyses', () => {
    const sysFn = vi.fn(() => 'sys');
    const ctxFn = vi.fn(() => 'ctx');
    const analysisFn = vi.fn(() => 'analysis');

    getCachedSystemPrompt(sysFn);
    getCachedSceneContext(ctxFn);
    getCachedCompoundAnalysis('key', analysisFn);

    invalidateAllCaches();

    getCachedSystemPrompt(sysFn);
    getCachedSceneContext(ctxFn);
    getCachedCompoundAnalysis('key', analysisFn);

    expect(sysFn).toHaveBeenCalledTimes(2);
    expect(ctxFn).toHaveBeenCalledTimes(2);
    expect(analysisFn).toHaveBeenCalledTimes(2);
  });

  it('leaves cache empty after clearing', () => {
    promptCache.setCachedPrompt('some:key', 'value');
    invalidateAllCaches();
    expect(promptCache.stats.size).toBe(0);
  });
});
