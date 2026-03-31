import { describe, it, expect, beforeEach } from 'vitest';
import {
  GameAnalyticsCollector,
  GameAnalyticsAggregator,
  sessionsToCSV,
  _resetIdCounter,
  GAME_EVENT_TYPES,
} from '../gameAnalytics';
import type { GameAnalyticsEvent, PlayerSession } from '../gameAnalytics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: GameAnalyticsEvent['type'],
  timestamp: number,
  position?: { x: number; y: number; z: number },
  metadata?: Record<string, unknown>
): GameAnalyticsEvent {
  return { type, timestamp, position, metadata };
}

function makeSession(
  id: string,
  startTime: number,
  duration: number,
  events: GameAnalyticsEvent[]
): PlayerSession {
  return {
    sessionId: id,
    startTime,
    endTime: startTime + duration,
    duration,
    events,
  };
}

// ---------------------------------------------------------------------------
// GameAnalyticsCollector
// ---------------------------------------------------------------------------

describe('GameAnalyticsCollector', () => {
  let collector: GameAnalyticsCollector;

  beforeEach(() => {
    collector = new GameAnalyticsCollector();
    _resetIdCounter();
  });

  it('starts a session and returns a session id', () => {
    const id = collector.startSession(1000);
    expect(id).toMatch(/^session-/);
  });

  it('creates a session with correct initial state', () => {
    const id = collector.startSession(1000);
    const session = collector.getSessionSummary(id);
    expect(session).toBeDefined();
    expect(session!.startTime).toBe(1000);
    expect(session!.endTime).toBeUndefined();
    expect(session!.duration).toBe(0);
    expect(session!.events).toEqual([]);
  });

  it('tracks events for a session', () => {
    const id = collector.startSession(1000);
    collector.trackEvent(id, makeEvent('PLAYER_SPAWN', 1001, { x: 0, y: 0, z: 0 }));
    collector.trackEvent(id, makeEvent('PLAYER_DEATH', 1500, { x: 5, y: 0, z: 3 }));

    const session = collector.getSessionSummary(id);
    expect(session!.events).toHaveLength(2);
    expect(session!.events[0].type).toBe('PLAYER_SPAWN');
    expect(session!.events[1].type).toBe('PLAYER_DEATH');
  });

  it('ends a session and computes duration', () => {
    const id = collector.startSession(1000);
    collector.endSession(id, 5000);

    const session = collector.getSessionSummary(id);
    expect(session!.endTime).toBe(5000);
    expect(session!.duration).toBe(4000);
    expect(session!.events).toHaveLength(1);
    expect(session!.events[0].type).toBe('SESSION_END');
  });

  it('ignores events for non-existent sessions', () => {
    collector.trackEvent('nonexistent', makeEvent('PLAYER_SPAWN', 100));
    // No error thrown, just silently ignored
    expect(collector.getSessionSummary('nonexistent')).toBeUndefined();
  });

  it('ignores endSession for non-existent sessions', () => {
    collector.endSession('nonexistent', 100);
    expect(collector.getSessionSummary('nonexistent')).toBeUndefined();
  });

  it('getAllSessions returns all sessions', () => {
    collector.startSession(1000);
    collector.startSession(2000);
    expect(collector.getAllSessions()).toHaveLength(2);
  });

  it('clear removes all sessions', () => {
    collector.startSession(1000);
    collector.startSession(2000);
    collector.clear();
    expect(collector.getAllSessions()).toHaveLength(0);
  });

  it('tracks SESSION_END events via trackEvent and sets duration', () => {
    const id = collector.startSession(1000);
    collector.trackEvent(id, makeEvent('SESSION_END', 3000));

    const session = collector.getSessionSummary(id);
    expect(session!.endTime).toBe(3000);
    expect(session!.duration).toBe(2000);
  });

  it('tracks event metadata', () => {
    const id = collector.startSession(1000);
    collector.trackEvent(
      id,
      makeEvent('CUSTOM', 1100, undefined, { score: 42, level: 'forest' })
    );

    const session = collector.getSessionSummary(id);
    expect(session!.events[0].metadata).toEqual({ score: 42, level: 'forest' });
  });

  it('handles multiple sessions independently', () => {
    const id1 = collector.startSession(1000);
    const id2 = collector.startSession(2000);

    collector.trackEvent(id1, makeEvent('PLAYER_SPAWN', 1001));
    collector.trackEvent(id2, makeEvent('PLAYER_DEATH', 2001, { x: 1, y: 2, z: 3 }));

    expect(collector.getSessionSummary(id1)!.events).toHaveLength(1);
    expect(collector.getSessionSummary(id2)!.events).toHaveLength(1);
    expect(collector.getSessionSummary(id1)!.events[0].type).toBe('PLAYER_SPAWN');
    expect(collector.getSessionSummary(id2)!.events[0].type).toBe('PLAYER_DEATH');
  });
});

// ---------------------------------------------------------------------------
// GameAnalyticsAggregator
// ---------------------------------------------------------------------------

describe('GameAnalyticsAggregator', () => {
  let aggregator: GameAnalyticsAggregator;

  beforeEach(() => {
    aggregator = new GameAnalyticsAggregator();
  });

  describe('getDeathHeatmap', () => {
    it('returns empty array when no sessions', () => {
      expect(aggregator.getDeathHeatmap()).toEqual([]);
    });

    it('aggregates death positions into heatmap points', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [
          makeEvent('PLAYER_DEATH', 500, { x: 5, y: 3, z: 0 }),
        ])
      );
      aggregator.addSession(
        makeSession('s2', 0, 1000, [
          makeEvent('PLAYER_DEATH', 600, { x: 5, y: 3, z: 0 }),
        ])
      );

      const heatmap = aggregator.getDeathHeatmap();
      expect(heatmap).toHaveLength(1);
      expect(heatmap[0].count).toBe(2);
      expect(heatmap[0].x).toBe(5);
      expect(heatmap[0].y).toBe(3);
    });

    it('creates separate points for different positions', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [
          makeEvent('PLAYER_DEATH', 500, { x: 0, y: 0, z: 0 }),
          makeEvent('PLAYER_DEATH', 600, { x: 10, y: 10, z: 0 }),
        ])
      );

      const heatmap = aggregator.getDeathHeatmap();
      expect(heatmap).toHaveLength(2);
    });

    it('ignores non-death events', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [
          makeEvent('PLAYER_SPAWN', 100, { x: 0, y: 0, z: 0 }),
          makeEvent('ITEM_COLLECTED', 200, { x: 5, y: 5, z: 0 }),
        ])
      );

      expect(aggregator.getDeathHeatmap()).toEqual([]);
    });

    it('ignores death events without positions', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [makeEvent('PLAYER_DEATH', 500)])
      );

      expect(aggregator.getDeathHeatmap()).toEqual([]);
    });

    it('sorts heatmap by count descending', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [
          makeEvent('PLAYER_DEATH', 500, { x: 0, y: 0, z: 0 }),
        ])
      );
      aggregator.addSession(
        makeSession('s2', 0, 1000, [
          makeEvent('PLAYER_DEATH', 500, { x: 10, y: 10, z: 0 }),
          makeEvent('PLAYER_DEATH', 600, { x: 10, y: 10, z: 0 }),
        ])
      );
      // Add a third for (10,10)
      aggregator.addSession(
        makeSession('s3', 0, 1000, [
          makeEvent('PLAYER_DEATH', 500, { x: 10, y: 10, z: 0 }),
        ])
      );

      const heatmap = aggregator.getDeathHeatmap();
      expect(heatmap[0].count).toBeGreaterThan(heatmap[1].count);
    });
  });

  describe('getCompletionFunnel', () => {
    it('returns correct funnel for empty data', () => {
      const funnel = aggregator.getCompletionFunnel();
      expect(funnel).toHaveLength(3);
      expect(funnel[0].name).toBe('PLAYER_SPAWN');
      expect(funnel[0].count).toBe(0);
      expect(funnel[0].dropoffRate).toBe(0);
    });

    it('computes dropoff rates across stages', () => {
      // 3 sessions: all spawn, 2 reach checkpoint, 1 completes
      aggregator.addSession(
        makeSession('s1', 0, 1000, [
          makeEvent('PLAYER_SPAWN', 100),
          makeEvent('CHECKPOINT_REACHED', 500),
          makeEvent('LEVEL_COMPLETE', 900),
        ])
      );
      aggregator.addSession(
        makeSession('s2', 0, 1000, [
          makeEvent('PLAYER_SPAWN', 100),
          makeEvent('CHECKPOINT_REACHED', 500),
        ])
      );
      aggregator.addSession(
        makeSession('s3', 0, 1000, [makeEvent('PLAYER_SPAWN', 100)])
      );

      const funnel = aggregator.getCompletionFunnel();

      // PLAYER_SPAWN: 3/3 sessions, dropoff from total(3) = 0
      expect(funnel[0].count).toBe(3);
      expect(funnel[0].dropoffRate).toBe(0);

      // CHECKPOINT_REACHED: 2/3, dropoff from prev(3) = 1/3
      expect(funnel[1].count).toBe(2);
      expect(funnel[1].dropoffRate).toBeCloseTo(0.3333, 3);

      // LEVEL_COMPLETE: 1/3, dropoff from prev(2) = 1/2
      expect(funnel[2].count).toBe(1);
      expect(funnel[2].dropoffRate).toBe(0.5);
    });
  });

  describe('getAverageSessionDuration', () => {
    it('returns 0 for no sessions', () => {
      expect(aggregator.getAverageSessionDuration()).toBe(0);
    });

    it('computes correct average', () => {
      aggregator.addSession(makeSession('s1', 0, 1000, []));
      aggregator.addSession(makeSession('s2', 0, 3000, []));
      expect(aggregator.getAverageSessionDuration()).toBe(2000);
    });

    it('handles single session', () => {
      aggregator.addSession(makeSession('s1', 0, 5000, []));
      expect(aggregator.getAverageSessionDuration()).toBe(5000);
    });
  });

  describe('getPopularPaths', () => {
    it('returns empty for no sessions', () => {
      expect(aggregator.getPopularPaths()).toEqual([]);
    });

    it('groups identical paths', () => {
      const events = [
        makeEvent('PLAYER_SPAWN', 100, { x: 0, y: 0, z: 0 }),
        makeEvent('CHECKPOINT_REACHED', 500, { x: 10, y: 0, z: 0 }),
      ];
      aggregator.addSession(makeSession('s1', 0, 1000, [...events]));
      aggregator.addSession(makeSession('s2', 0, 1000, [...events]));

      const paths = aggregator.getPopularPaths();
      expect(paths).toHaveLength(1);
      expect(paths[0].count).toBe(2);
    });

    it('skips sessions with fewer than 2 position events', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [
          makeEvent('PLAYER_SPAWN', 100, { x: 0, y: 0, z: 0 }),
        ])
      );
      expect(aggregator.getPopularPaths()).toEqual([]);
    });

    it('limits to top 10 paths', () => {
      for (let i = 0; i < 15; i++) {
        aggregator.addSession(
          makeSession(`s${i}`, 0, 1000, [
            makeEvent('PLAYER_SPAWN', 100, { x: i, y: 0, z: 0 }),
            makeEvent('LEVEL_COMPLETE', 500, { x: i + 100, y: 0, z: 0 }),
          ])
        );
      }
      expect(aggregator.getPopularPaths().length).toBeLessThanOrEqual(10);
    });
  });

  describe('getDashboard', () => {
    it('returns correct dashboard for empty data', () => {
      const dashboard = aggregator.getDashboard();
      expect(dashboard.totalSessions).toBe(0);
      expect(dashboard.avgSessionDuration).toBe(0);
      expect(dashboard.completionRate).toBe(0);
      expect(dashboard.deathHeatmap).toEqual([]);
      expect(dashboard.popularPaths).toEqual([]);
      expect(dashboard.funnelStages).toHaveLength(3);
    });

    it('computes correct dashboard with real data', () => {
      aggregator.addSession(
        makeSession('s1', 0, 5000, [
          makeEvent('PLAYER_SPAWN', 100, { x: 0, y: 0, z: 0 }),
          makeEvent('PLAYER_DEATH', 2000, { x: 5, y: 5, z: 0 }),
          makeEvent('CHECKPOINT_REACHED', 3000),
          makeEvent('LEVEL_COMPLETE', 4500),
        ])
      );
      aggregator.addSession(
        makeSession('s2', 0, 3000, [
          makeEvent('PLAYER_SPAWN', 100, { x: 0, y: 0, z: 0 }),
          makeEvent('PLAYER_DEATH', 1500, { x: 5, y: 5, z: 0 }),
        ])
      );

      const dashboard = aggregator.getDashboard();
      expect(dashboard.totalSessions).toBe(2);
      expect(dashboard.avgSessionDuration).toBe(4000);
      expect(dashboard.completionRate).toBe(0.5);
      expect(dashboard.deathHeatmap.length).toBeGreaterThan(0);
      expect(dashboard.funnelStages).toHaveLength(3);
    });

    it('completion rate is 0 when no sessions complete', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [makeEvent('PLAYER_SPAWN', 100)])
      );
      const dashboard = aggregator.getDashboard();
      expect(dashboard.completionRate).toBe(0);
    });

    it('completion rate is 1 when all sessions complete', () => {
      aggregator.addSession(
        makeSession('s1', 0, 1000, [makeEvent('LEVEL_COMPLETE', 900)])
      );
      aggregator.addSession(
        makeSession('s2', 0, 1000, [makeEvent('LEVEL_COMPLETE', 800)])
      );
      const dashboard = aggregator.getDashboard();
      expect(dashboard.completionRate).toBe(1);
    });
  });

  describe('addSessions', () => {
    it('adds multiple sessions at once', () => {
      aggregator.addSessions([
        makeSession('s1', 0, 1000, []),
        makeSession('s2', 0, 2000, []),
      ]);
      expect(aggregator.getDashboard().totalSessions).toBe(2);
    });
  });

  describe('clear', () => {
    it('resets all aggregated data', () => {
      aggregator.addSession(makeSession('s1', 0, 1000, []));
      aggregator.clear();
      expect(aggregator.getDashboard().totalSessions).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// sessionsToCSV
// ---------------------------------------------------------------------------

describe('sessionsToCSV', () => {
  it('returns header only for empty array', () => {
    const csv = sessionsToCSV([]);
    expect(csv).toBe(
      'sessionId,startTime,endTime,duration,eventType,eventTimestamp,posX,posY,posZ'
    );
  });

  it('produces a row per event', () => {
    const csv = sessionsToCSV([
      makeSession('s1', 1000, 2000, [
        makeEvent('PLAYER_SPAWN', 1001, { x: 1, y: 2, z: 3 }),
        makeEvent('PLAYER_DEATH', 2000, { x: 4, y: 5, z: 6 }),
      ]),
    ]);

    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 events
    expect(lines[1]).toContain('PLAYER_SPAWN');
    expect(lines[2]).toContain('PLAYER_DEATH');
  });

  it('handles sessions with no events', () => {
    const csv = sessionsToCSV([makeSession('s1', 1000, 0, [])]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 empty row
    expect(lines[1]).toContain('s1');
  });

  it('zero-event rows have the same column count as the header (regression #7100)', () => {
    const csv = sessionsToCSV([makeSession('s1', 1000, 0, [])]);
    const lines = csv.split('\n');
    const headerCols = lines[0].split(',').length;
    const dataRowCols = lines[1].split(',').length;
    expect(dataRowCols).toBe(headerCols);
    expect(headerCols).toBe(9);
  });

  it('all row types produce the same column count (regression #7100)', () => {
    const sessions = [
      makeSession('s1', 1000, 0, []),
      makeSession('s2', 2000, 3000, [
        makeEvent('PLAYER_SPAWN', 2001, { x: 1, y: 2, z: 3 }),
        makeEvent('PLAYER_DEATH', 2500),
      ]),
    ];
    const csv = sessionsToCSV(sessions);
    const lines = csv.split('\n');
    const headerCols = lines[0].split(',').length;
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].split(',').length, `row ${i} column count`).toBe(headerCols);
    }
  });

  it('handles events without positions', () => {
    const csv = sessionsToCSV([
      makeSession('s1', 1000, 2000, [makeEvent('LEVEL_START', 1001)]),
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('LEVEL_START');
    // Position fields should be empty
    expect(lines[1]).toMatch(/,,,$/);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('GAME_EVENT_TYPES', () => {
  it('contains all expected event types', () => {
    expect(GAME_EVENT_TYPES).toContain('PLAYER_SPAWN');
    expect(GAME_EVENT_TYPES).toContain('PLAYER_DEATH');
    expect(GAME_EVENT_TYPES).toContain('LEVEL_START');
    expect(GAME_EVENT_TYPES).toContain('LEVEL_COMPLETE');
    expect(GAME_EVENT_TYPES).toContain('ITEM_COLLECTED');
    expect(GAME_EVENT_TYPES).toContain('ENEMY_KILLED');
    expect(GAME_EVENT_TYPES).toContain('CHECKPOINT_REACHED');
    expect(GAME_EVENT_TYPES).toContain('SESSION_END');
    expect(GAME_EVENT_TYPES).toContain('CUSTOM');
  });

  it('has exactly 9 event types', () => {
    expect(GAME_EVENT_TYPES).toHaveLength(9);
  });
});
