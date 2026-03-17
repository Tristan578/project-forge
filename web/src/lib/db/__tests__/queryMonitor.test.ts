import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  recordQuery,
  getMetrics,
  setCurrentRoute,
  getCurrentRoute,
  monitoredQuery,
  _resetForTesting,
  _getRecordsForTesting,
  SLOW_QUERY_THRESHOLD_MS,
  DEGRADED_AVG_THRESHOLD_MS,
  METRICS_WINDOW_MS,
} from '../queryMonitor';

beforeEach(() => {
  _resetForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('SLOW_QUERY_THRESHOLD_MS is 500', () => {
    expect(SLOW_QUERY_THRESHOLD_MS).toBe(500);
  });

  it('DEGRADED_AVG_THRESHOLD_MS is 1000', () => {
    expect(DEGRADED_AVG_THRESHOLD_MS).toBe(1_000);
  });

  it('METRICS_WINDOW_MS is 5 minutes', () => {
    expect(METRICS_WINDOW_MS).toBe(5 * 60 * 1_000);
  });
});

// ---------------------------------------------------------------------------
// Route tracking
// ---------------------------------------------------------------------------

describe('setCurrentRoute / getCurrentRoute', () => {
  it('defaults to "unknown"', () => {
    expect(getCurrentRoute()).toBe('unknown');
  });

  it('stores and returns the set route', () => {
    setCurrentRoute('/api/test');
    expect(getCurrentRoute()).toBe('/api/test');
  });

  it('updates the route on subsequent calls', () => {
    setCurrentRoute('/api/first');
    setCurrentRoute('/api/second');
    expect(getCurrentRoute()).toBe('/api/second');
  });
});

// ---------------------------------------------------------------------------
// recordQuery
// ---------------------------------------------------------------------------

describe('recordQuery', () => {
  it('adds a record to the buffer', () => {
    recordQuery(100);
    expect(_getRecordsForTesting()).toHaveLength(1);
  });

  it('marks fast queries as not slow', () => {
    const rec = recordQuery(SLOW_QUERY_THRESHOLD_MS - 1);
    expect(rec.isSlow).toBe(false);
  });

  it('marks queries at exactly the threshold as slow', () => {
    const rec = recordQuery(SLOW_QUERY_THRESHOLD_MS);
    expect(rec.isSlow).toBe(true);
  });

  it('marks queries above the threshold as slow', () => {
    const rec = recordQuery(SLOW_QUERY_THRESHOLD_MS + 1);
    expect(rec.isSlow).toBe(true);
  });

  it('attaches the current route to the record', () => {
    setCurrentRoute('/api/example');
    const rec = recordQuery(50);
    expect(rec.route).toBe('/api/example');
  });

  it('attaches an optional label', () => {
    const rec = recordQuery(50, 'select-users');
    expect(rec.label).toBe('select-users');
  });

  it('record without label has undefined label', () => {
    const rec = recordQuery(50);
    expect(rec.label).toBeUndefined();
  });

  it('sets startedAt to approximately now - durationMs', () => {
    const before = Date.now();
    const rec = recordQuery(200);
    const after = Date.now();
    // startedAt should be in [before - 200, after - 200]
    expect(rec.startedAt).toBeGreaterThanOrEqual(before - 200);
    expect(rec.startedAt).toBeLessThanOrEqual(after - 200 + 5); // 5ms tolerance
  });

  it('emits a console.warn for slow queries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordQuery(SLOW_QUERY_THRESHOLD_MS + 100, 'slow-op');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('Slow query detected');
    warnSpy.mockRestore();
  });

  it('does NOT emit console.warn for fast queries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordQuery(SLOW_QUERY_THRESHOLD_MS - 1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('evicts oldest records when buffer exceeds 500', () => {
    // Fill to 500
    for (let i = 0; i < 500; i++) {
      recordQuery(10);
    }
    expect(_getRecordsForTesting()).toHaveLength(500);

    // Add one more — should stay at 500
    recordQuery(10);
    expect(_getRecordsForTesting()).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// getMetrics — empty state
// ---------------------------------------------------------------------------

describe('getMetrics with no records', () => {
  it('returns zero counts', () => {
    const m = getMetrics();
    expect(m.totalQueryCount).toBe(0);
    expect(m.slowQueryCount).toBe(0);
    expect(m.avgQueryTimeMs).toBe(0);
    expect(m.top5Slowest).toHaveLength(0);
    expect(m.queryCountByRoute).toEqual({});
  });

  it('sets window bounds around now', () => {
    const before = Date.now();
    const m = getMetrics();
    const after = Date.now();
    expect(m.windowEndMs).toBeGreaterThanOrEqual(before);
    expect(m.windowEndMs).toBeLessThanOrEqual(after + 1);
    expect(m.windowStartMs).toBe(m.windowEndMs - METRICS_WINDOW_MS);
  });
});

// ---------------------------------------------------------------------------
// getMetrics — aggregation
// ---------------------------------------------------------------------------

describe('getMetrics aggregation', () => {
  it('counts total queries', () => {
    recordQuery(100);
    recordQuery(200);
    recordQuery(300);
    expect(getMetrics().totalQueryCount).toBe(3);
  });

  it('counts slow queries correctly', () => {
    recordQuery(200);           // fast
    recordQuery(600);           // slow
    recordQuery(700);           // slow
    expect(getMetrics().slowQueryCount).toBe(2);
  });

  it('computes correct average query time', () => {
    recordQuery(100);
    recordQuery(300);
    recordQuery(500); // slow — still averaged
    const m = getMetrics();
    expect(m.avgQueryTimeMs).toBeCloseTo((100 + 300 + 500) / 3);
  });

  it('returns top 5 slowest in descending order', () => {
    [10, 900, 50, 800, 300, 700, 600].forEach((d) => recordQuery(d));
    const m = getMetrics();
    expect(m.top5Slowest).toHaveLength(5);
    expect(m.top5Slowest[0].durationMs).toBe(900);
    expect(m.top5Slowest[1].durationMs).toBe(800);
    expect(m.top5Slowest[2].durationMs).toBe(700);
    expect(m.top5Slowest[3].durationMs).toBe(600);
    expect(m.top5Slowest[4].durationMs).toBe(300);
  });

  it('returns fewer than 5 slowest when fewer queries exist', () => {
    recordQuery(100);
    recordQuery(200);
    expect(getMetrics().top5Slowest).toHaveLength(2);
  });

  it('tracks query counts per route', () => {
    setCurrentRoute('/api/users');
    recordQuery(50);
    recordQuery(60);
    setCurrentRoute('/api/projects');
    recordQuery(70);
    const m = getMetrics();
    expect(m.queryCountByRoute['/api/users']).toBe(2);
    expect(m.queryCountByRoute['/api/projects']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getMetrics — windowing
// ---------------------------------------------------------------------------

describe('getMetrics window exclusion', () => {
  it('excludes records older than the 5-minute window', () => {
    // Record a query "now"
    recordQuery(100);

    // Advance time by 6 minutes
    vi.advanceTimersByTime(6 * 60 * 1_000);

    // Record another query in the new "now"
    recordQuery(200);

    const m = getMetrics();
    // Only the second query falls in the window
    expect(m.totalQueryCount).toBe(1);
    expect(m.avgQueryTimeMs).toBe(200);
  });

  it('includes records that are still within the window', () => {
    // Record a zero-duration query so startedAt == Date.now(), then advance by
    // less than the full window so it's still in range.
    recordQuery(0);
    vi.advanceTimersByTime(METRICS_WINDOW_MS - 1_000);
    const m = getMetrics();
    expect(m.totalQueryCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// monitoredQuery
// ---------------------------------------------------------------------------

describe('monitoredQuery', () => {
  it('returns the operation result', async () => {
    const result = await monitoredQuery(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('records the query duration', async () => {
    await monitoredQuery(() => Promise.resolve('ok'));
    expect(_getRecordsForTesting()).toHaveLength(1);
  });

  it('re-throws errors from the operation', async () => {
    await expect(
      monitoredQuery(() => Promise.reject(new Error('DB error')))
    ).rejects.toThrow('DB error');
  });

  it('still records a query on error', async () => {
    await monitoredQuery(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(_getRecordsForTesting()).toHaveLength(1);
  });

  it('appends ":error" to the label when the operation throws', async () => {
    await monitoredQuery(
      () => Promise.reject(new Error('fail')),
      'select-user'
    ).catch(() => {});
    const rec = _getRecordsForTesting()[0];
    expect(rec.label).toBe('select-user:error');
  });

  it('records label "error" when no label provided and operation throws', async () => {
    await monitoredQuery(
      () => Promise.reject(new Error('fail'))
    ).catch(() => {});
    const rec = _getRecordsForTesting()[0];
    expect(rec.label).toBe('error');
  });

  it('attaches the current route to the recorded entry', async () => {
    setCurrentRoute('/api/items');
    await monitoredQuery(() => Promise.resolve(null));
    const rec = _getRecordsForTesting()[0];
    expect(rec.route).toBe('/api/items');
  });
});

// ---------------------------------------------------------------------------
// _resetForTesting
// ---------------------------------------------------------------------------

describe('_resetForTesting', () => {
  it('clears all records', () => {
    recordQuery(100);
    recordQuery(200);
    _resetForTesting();
    expect(_getRecordsForTesting()).toHaveLength(0);
  });

  it('resets the current route to "unknown"', () => {
    setCurrentRoute('/api/something');
    _resetForTesting();
    expect(getCurrentRoute()).toBe('unknown');
  });
});
