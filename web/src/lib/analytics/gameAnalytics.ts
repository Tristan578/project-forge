/**
 * Game analytics module for tracking player behavior in published games.
 *
 * Provides session tracking, event collection, death heatmaps, funnel analysis,
 * and dashboard summary statistics for game creators to understand player engagement.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const GAME_EVENT_TYPES = [
  'PLAYER_SPAWN',
  'PLAYER_DEATH',
  'LEVEL_START',
  'LEVEL_COMPLETE',
  'ITEM_COLLECTED',
  'ENEMY_KILLED',
  'CHECKPOINT_REACHED',
  'SESSION_END',
  'CUSTOM',
] as const;

export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

export interface GameAnalyticsEvent {
  type: GameEventType;
  timestamp: number;
  position?: { x: number; y: number; z: number };
  metadata?: Record<string, unknown>;
}

export interface PlayerSession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  duration: number;
  events: GameAnalyticsEvent[];
}

export interface HeatmapPoint {
  x: number;
  y: number;
  count: number;
  label?: string;
}

export interface PathData {
  points: Array<{ x: number; y: number }>;
  count: number;
}

export interface FunnelStage {
  name: string;
  count: number;
  dropoffRate: number;
}

export interface AnalyticsDashboard {
  totalSessions: number;
  avgSessionDuration: number;
  completionRate: number;
  deathHeatmap: HeatmapPoint[];
  popularPaths: PathData[];
  funnelStages: FunnelStage[];
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

function generateSessionId(): string {
  _idCounter += 1;
  return `session-${Date.now()}-${_idCounter}`;
}

/** Reset internal counter (for tests only). */
export function _resetIdCounter(): void {
  _idCounter = 0;
}

// ---------------------------------------------------------------------------
// GameAnalyticsCollector — tracks events within sessions
// ---------------------------------------------------------------------------

export class GameAnalyticsCollector {
  private sessions: Map<string, PlayerSession> = new Map();

  trackEvent(sessionId: string, event: GameAnalyticsEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.events.push(event);

    if (event.type === 'SESSION_END') {
      session.endTime = event.timestamp;
      session.duration = event.timestamp - session.startTime;
    }
  }

  startSession(startTime?: number): string {
    const id = generateSessionId();
    const now = startTime ?? Date.now();
    this.sessions.set(id, {
      sessionId: id,
      startTime: now,
      endTime: undefined,
      duration: 0,
      events: [],
    });
    return id;
  }

  endSession(sessionId: string, endTime?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const now = endTime ?? Date.now();
    session.endTime = now;
    session.duration = now - session.startTime;
    session.events.push({
      type: 'SESSION_END',
      timestamp: now,
    });
  }

  getSessionSummary(sessionId: string): PlayerSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): PlayerSession[] {
    return Array.from(this.sessions.values());
  }

  clear(): void {
    this.sessions.clear();
  }
}

// ---------------------------------------------------------------------------
// GameAnalyticsAggregator — computes dashboards from collected sessions
// ---------------------------------------------------------------------------

/** Grid resolution for heatmap bucketing (world-units per cell). */
const HEATMAP_CELL_SIZE = 1;

function bucketKey(x: number, y: number): string {
  const bx = Math.round(x / HEATMAP_CELL_SIZE);
  const by = Math.round(y / HEATMAP_CELL_SIZE);
  return `${bx},${by}`;
}

export class GameAnalyticsAggregator {
  private sessions: PlayerSession[] = [];

  addSession(session: PlayerSession): void {
    this.sessions.push(session);
  }

  addSessions(sessions: PlayerSession[]): void {
    this.sessions.push(...sessions);
  }

  getDeathHeatmap(): HeatmapPoint[] {
    const buckets = new Map<string, { x: number; y: number; count: number }>();

    for (const session of this.sessions) {
      for (const event of session.events) {
        if (event.type === 'PLAYER_DEATH' && event.position) {
          const key = bucketKey(event.position.x, event.position.y);
          const existing = buckets.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            buckets.set(key, {
              x: Math.round(event.position.x / HEATMAP_CELL_SIZE) * HEATMAP_CELL_SIZE,
              y: Math.round(event.position.y / HEATMAP_CELL_SIZE) * HEATMAP_CELL_SIZE,
              count: 1,
            });
          }
        }
      }
    }

    return Array.from(buckets.values())
      .map((b) => ({ x: b.x, y: b.y, count: b.count }))
      .sort((a, b) => b.count - a.count);
  }

  getCompletionFunnel(): FunnelStage[] {
    const stages: GameEventType[] = [
      'PLAYER_SPAWN',
      'CHECKPOINT_REACHED',
      'LEVEL_COMPLETE',
    ];

    const counts = stages.map((stage) => {
      let count = 0;
      for (const session of this.sessions) {
        if (session.events.some((e) => e.type === stage)) {
          count += 1;
        }
      }
      return count;
    });

    return stages.map((stage, i) => {
      const count = counts[i];
      const prev = i === 0 ? this.sessions.length : counts[i - 1];
      const dropoffRate = prev > 0 ? Math.max(0, Math.min(1, 1 - count / prev)) : 0;
      return {
        name: stage,
        count,
        dropoffRate: Math.round(dropoffRate * 10000) / 10000,
      };
    });
  }

  getAverageSessionDuration(): number {
    if (this.sessions.length === 0) return 0;
    const total = this.sessions.reduce((sum, s) => sum + s.duration, 0);
    return Math.round(total / this.sessions.length);
  }

  getPopularPaths(): PathData[] {
    // Build per-session position traces from PLAYER_SPAWN events
    const pathMap = new Map<string, { points: Array<{ x: number; y: number }>; count: number }>();

    for (const session of this.sessions) {
      const positions = session.events
        .filter((e) => e.position)
        .map((e) => ({
          x: Math.round(e.position!.x),
          y: Math.round(e.position!.y),
        }));

      if (positions.length < 2) continue;

      // Simplify path to key for dedup
      const key = positions.map((p) => `${p.x},${p.y}`).join('->');
      const existing = pathMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        pathMap.set(key, { points: positions, count: 1 });
      }
    }

    return Array.from(pathMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  getDashboard(): AnalyticsDashboard {
    const totalSessions = this.sessions.length;
    const avgSessionDuration = this.getAverageSessionDuration();
    const deathHeatmap = this.getDeathHeatmap();
    const funnelStages = this.getCompletionFunnel();
    const popularPaths = this.getPopularPaths();

    // Completion rate = sessions with LEVEL_COMPLETE / total sessions
    const completedCount = this.sessions.filter((s) =>
      s.events.some((e) => e.type === 'LEVEL_COMPLETE')
    ).length;
    const completionRate =
      totalSessions > 0
        ? Math.round((completedCount / totalSessions) * 10000) / 10000
        : 0;

    return {
      totalSessions,
      avgSessionDuration,
      completionRate,
      deathHeatmap,
      popularPaths,
      funnelStages,
    };
  }

  clear(): void {
    this.sessions = [];
  }
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

export function sessionsToCSV(sessions: PlayerSession[]): string {
  const header = 'sessionId,startTime,endTime,duration,eventType,eventTimestamp,posX,posY,posZ';
  const rows: string[] = [header];

  for (const session of sessions) {
    if (session.events.length === 0) {
      rows.push(
        `${session.sessionId},${session.startTime},${session.endTime ?? ''},${session.duration},,,,`
      );
    } else {
      for (const event of session.events) {
        rows.push(
          [
            session.sessionId,
            session.startTime,
            session.endTime ?? '',
            session.duration,
            event.type,
            event.timestamp,
            event.position?.x ?? '',
            event.position?.y ?? '',
            event.position?.z ?? '',
          ].join(',')
        );
      }
    }
  }

  return rows.join('\n');
}
