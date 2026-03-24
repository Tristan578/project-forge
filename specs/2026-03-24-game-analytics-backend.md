# Spec: Game Analytics Backend

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-642
> **Scope:** Design and implement a time-series analytics backend for published game telemetry — player sessions, events, heatmaps, funnels, and retention curves.

## Problem

SpawnForge creators publish games that players interact with in the browser. Creators need to understand player behavior — where players die, where they drop off, which levels are too hard, how long sessions last — so they can improve their games. The existing `gameAnalytics.ts` module provides client-side aggregation using in-memory `GameAnalyticsCollector` and `GameAnalyticsAggregator` classes, but this data is lost when the page closes. There is no persistent storage, no cross-session aggregation, and no way to analyze behavior across the full player base.

PF-551 (live game analytics) and PF-552 (dynamic difficulty adjustment) are both blocked on having a real analytics backend.

## Technology Evaluation

### Option A: ClickHouse Cloud

| Factor | Assessment |
|--------|-----------|
| **Strengths** | Purpose-built for high-cardinality time-series. Column-oriented storage compresses event data extremely well. Sub-second queries over billions of rows. Native materialized views for pre-aggregation. |
| **Weaknesses** | Expensive at scale ($195/mo minimum for Development tier, $500-1500/mo for production workloads). Separate service to manage. No native Neon/Drizzle integration. |
| **Cost** | Development: ~$195/mo. Production (100M events): ~$600-1000/mo. |
| **Complexity** | New service, new connection management, new query language (SQL-like but different). Requires HTTP client or dedicated Node.js driver. |

### Option B: TimescaleDB on Neon

| Factor | Assessment |
|--------|-----------|
| **Strengths** | Neon already exists in our stack. TimescaleDB is a PostgreSQL extension — uses same Drizzle ORM, same connection pool, same backup strategy. Hypertables provide automatic time partitioning. Continuous aggregates replace materialized views. |
| **Weaknesses** | Neon does not currently support the TimescaleDB extension. Would require a separate managed Timescale Cloud instance ($36/mo base). Less compression than ClickHouse for truly massive event volumes. |
| **Cost** | Timescale Cloud: ~$36/mo (Dynamic compute). Additional storage at scale. |
| **Complexity** | New managed service, but SQL-native. Drizzle can connect to it as a second database. |

### Option C: PostgreSQL on Neon (partitioned tables + BRIN indexes)

| Factor | Assessment |
|--------|-----------|
| **Strengths** | Zero new services. Uses existing Neon database. Native Drizzle support. PostgreSQL 16 partitioning is mature. BRIN indexes on timestamp columns are highly space-efficient. |
| **Weaknesses** | Not optimized for analytical queries. At very high event volumes (>100M rows), query performance degrades compared to columnar stores. No native continuous aggregates — must build our own with cron jobs. |
| **Cost** | $0 incremental (included in existing Neon plan, ~$19/mo). Storage grows with event volume. |
| **Complexity** | Lowest. Same DB, same ORM, same tooling. Partition management via Drizzle migrations. |

### Option D: Hybrid — Neon for hot data + R2 for cold storage

| Factor | Assessment |
|--------|-----------|
| **Strengths** | Neon holds recent data (30-90 days) for fast queries. Older data archived to Cloudflare R2 as compressed JSON/Parquet. R2 storage is $0.015/GB/month. Scales cost-effectively. |
| **Weaknesses** | Two-tier query complexity. Archive queries require separate code path. |
| **Cost** | Neon: existing plan. R2: ~$0.015/GB/month for cold storage. Minimal. |
| **Complexity** | Medium. Requires an archival cron job and separate query path for historical data. |

### Recommendation: Option C (Phase 1) with migration path to Option D (Phase 2)

**Rationale:** SpawnForge is pre-revenue with a ~$130-150/mo infrastructure budget. Adding $195-600/mo for ClickHouse is not justified until the platform has meaningful traffic. PostgreSQL partitioned tables on Neon handle the expected early-stage load (thousands of events/day, not millions) with zero additional cost. When traffic justifies it, Phase 2 adds R2 cold storage archival.

The migration path to ClickHouse (Option A) remains open — the ingestion API is the same, only the storage layer changes.

## Solution

### Architecture Overview

```
Published Game (browser)
  |
  | POST /api/analytics/ingest  (batched events, max 100/request)
  |
  v
Next.js API Route
  |
  | Validate + rate-limit (IP-based, 60 req/min per game)
  | Write to Neon via Drizzle
  |
  v
Neon PostgreSQL
  ├── game_analytics_events (partitioned by month on event_time)
  ├── game_analytics_sessions (partitioned by month on started_at)
  └── game_analytics_aggregates (materialized summaries, refreshed by cron)
  |
  v
Creator Dashboard (editor panel + API routes)
  |
  | GET /api/analytics/dashboard/:gameId
  | GET /api/analytics/heatmap/:gameId
  | GET /api/analytics/funnel/:gameId
  | GET /api/analytics/retention/:gameId
  |
  v
GameAnalyticsPanel.tsx (existing, already renders heatmaps/funnels)
```

### Data Model (Drizzle Schema)

```typescript
// Partitioned by month on event_time
export const gameAnalyticsEvents = pgTable(
  'game_analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    sessionId: text('session_id').notNull(),
    eventType: text('event_type').notNull(), // matches GAME_EVENT_TYPES
    eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
    posX: integer('pos_x'),  // Stored as milliunits (x * 1000) to avoid float columns
    posY: integer('pos_y'),
    posZ: integer('pos_z'),
    metadata: jsonb('metadata'),
  },
  (table) => [
    index('idx_gae_game_time').on(table.gameId, table.eventTime),
    index('idx_gae_game_type').on(table.gameId, table.eventType),
    index('idx_gae_session').on(table.sessionId),
  ]
);

// Session summary (written on SESSION_END or timeout)
export const gameAnalyticsSessions = pgTable(
  'game_analytics_sessions',
  {
    id: text('id').primaryKey(), // client-generated session ID
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationMs: integer('duration_ms').notNull().default(0),
    eventCount: integer('event_count').notNull().default(0),
    completed: integer('completed').notNull().default(0), // reached LEVEL_COMPLETE
    userAgent: text('user_agent'),
    country: text('country'), // from IP geolocation header (Vercel provides)
  },
  (table) => [
    index('idx_gas_game_started').on(table.gameId, table.startedAt),
    index('idx_gas_game_completed').on(table.gameId, table.completed),
  ]
);

// Pre-aggregated daily summaries (refreshed by cron)
export const gameAnalyticsAggregates = pgTable(
  'game_analytics_aggregates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    date: timestamp('date', { withTimezone: true }).notNull(),
    totalSessions: integer('total_sessions').notNull().default(0),
    totalEvents: integer('total_events').notNull().default(0),
    avgDurationMs: integer('avg_duration_ms').notNull().default(0),
    completionRate: integer('completion_rate_bps').notNull().default(0), // basis points (0-10000)
    uniquePlayers: integer('unique_players').notNull().default(0), // estimated from session IDs
  },
  (table) => [
    uniqueIndex('uq_gaa_game_date').on(table.gameId, table.date),
    index('idx_gaa_game').on(table.gameId),
  ]
);
```

### API Design

#### Ingestion Endpoint

```
POST /api/analytics/ingest
Content-Type: application/json

{
  "gameId": "uuid",
  "sessionId": "string",
  "events": [
    {
      "type": "PLAYER_DEATH",
      "timestamp": 1711234567890,
      "position": { "x": 12.5, "y": 0.0, "z": -3.2 },
      "metadata": { "cause": "spike_trap" }
    }
  ]
}

Response: 200 { "accepted": 5 }
Response: 429 { "error": "Rate limit exceeded" }
Response: 400 { "error": "Invalid event type" }
```

**Constraints:**
- Max 100 events per request
- Rate limit: 60 requests/minute per IP per game
- Events older than 24 hours are rejected
- `gameId` must reference an existing published game
- No authentication required (public endpoint — players are anonymous)

#### Dashboard Endpoints (authenticated, creator-only)

```
GET /api/analytics/dashboard/:gameId
  → { totalSessions, avgDuration, completionRate, dailyTrend[], topDeathLocations[] }

GET /api/analytics/heatmap/:gameId?type=PLAYER_DEATH&days=7
  → { points: [{ x, y, count }] }

GET /api/analytics/funnel/:gameId?days=30
  → { stages: [{ name, count, dropoffRate }] }

GET /api/analytics/retention/:gameId?days=30
  → { cohorts: [{ date, day0, day1, day3, day7 }] }
```

All dashboard endpoints require Clerk auth and verify the requesting user owns the game.

### Client-Side SDK (published game runtime)

The existing `GameAnalyticsCollector` class in `gameAnalytics.ts` will be extended with a `flush()` method that POSTs batched events to the ingestion endpoint. The export pipeline (`export/gameTemplate.ts`) will include a lightweight analytics snippet that:

1. Starts a session on game load
2. Buffers events in memory (max 50)
3. Flushes every 10 seconds or on `SESSION_END`
4. Uses `navigator.sendBeacon()` on page unload for reliability

### Cron Job (aggregation)

A Vercel Cron Job runs daily at 02:00 UTC to:
1. Aggregate the previous day's events into `game_analytics_aggregates`
2. Archive events older than 90 days (Phase 2: to R2)
3. Clean up orphaned sessions (no events for 1 hour, mark as ended)

## Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Neon storage | $0 (included) | Existing plan covers ~10GB. Analytics adds ~1-2GB at early scale |
| Neon compute | $0 (included) | Aggregation queries within existing autoscale budget |
| Vercel Cron | $0 (included) | 1 daily cron on Hobby/Pro plan |
| **Total Phase 1** | **$0 incremental** | Stays within existing Neon plan |

At scale (>100M events/month), storage costs would increase to ~$5-10/mo on Neon, at which point the R2 archival (Phase 2) becomes relevant.

## Security Considerations

1. **Ingestion endpoint is public** — must be rate-limited aggressively (IP + gameId)
2. **No PII in events** — position data, event types, and opaque metadata only
3. **gameId validation** — reject events for unpublished/nonexistent games
4. **Dashboard endpoints require auth** — Clerk auth + ownership verification
5. **Event size limit** — max 1KB per event metadata, max 100KB per request body
6. **DoS prevention** — reject oversized payloads before parsing (bodyParser limit in route config)

## Phased Implementation Plan

### Phase 1: Core Ingestion + Dashboard (this ticket)
1. Add Drizzle schema tables (3 tables)
2. Implement ingestion API route with rate limiting
3. Implement dashboard API routes (4 endpoints)
4. Wire `GameAnalyticsPanel.tsx` to real data (replace mock/in-memory data)
5. Add `flush()` to `GameAnalyticsCollector` for published game runtime
6. Add Vercel Cron for daily aggregation
7. Tests: ingestion validation, rate limiting, dashboard queries, aggregation logic

### Phase 2: Cold Storage + Scale (future, when traffic justifies)
8. R2 archival cron for events >90 days old
9. Historical query endpoint that reads from R2
10. Consider ClickHouse migration if query latency becomes an issue

### Phase 3: Advanced Analytics (future)
11. Cohort retention analysis
12. A/B test framework integration
13. Real-time event streaming (WebSocket) for live dashboards
14. Dynamic difficulty adjustment feed (PF-552)

## Acceptance Criteria

- Given a published game, When a player completes a session, Then session events are persisted to the analytics database within 5 seconds of the flush
- Given 1000 events/day for a game, When the creator views the analytics dashboard, Then the dashboard loads within 2 seconds
- Given a game creator, When they view the heatmap, Then death locations are aggregated and displayed correctly
- Given the ingestion endpoint, When an unauthenticated request exceeds 60 req/min, Then it receives a 429 response
- Given events older than 90 days, When the daily cron runs, Then those events are flagged for archival (Phase 2: moved to R2)
- Given a non-owner user, When they request analytics for someone else's game, Then they receive a 403 response

## Alternatives Considered

1. **PostHog for game analytics** — Rejected. PostHog is our product analytics tool (user behavior in the editor). Game analytics has fundamentally different data shapes (spatial positions, game-specific events) and requires per-game isolation. Mixing them would pollute both datasets.

2. **Client-side-only analytics** — Rejected. The current `GameAnalyticsCollector` already works client-side but data is lost on page close. Creators need persistent, cross-session aggregation.

3. **Third-party game analytics (GameAnalytics.com, Unity Analytics)** — Rejected. These services are designed for native game engines, not browser-based games. They also add external dependencies and data residency concerns. Building our own keeps data on our infrastructure and enables tight editor integration.
