# Spec: Social Features for Published Games

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-571

## Problem

Published games have no community engagement features. Players finish a game and leave. Leaderboards, screenshots, and social sharing drive retention, discoverability, and creator motivation.

## Solution

Server-side leaderboard and screenshot APIs, plus client-side integration in the game runtime and community pages. Builds on existing publish (`/api/publish`) and community (`/api/community`) infrastructure.

### Phase 1: Leaderboard System (MVP)

**Database Changes:**
- `web/src/lib/db/schema.ts` — New tables: `leaderboards` (id, gameId, name, sortOrder, createdAt), `leaderboardEntries` (id, leaderboardId, playerName, score, metadata, createdAt, ipHash)
- Migration via `drizzle-kit generate`

**API Routes:**
- `web/src/app/api/play/[userId]/[slug]/leaderboard/route.ts` — GET (top 100 scores), POST (submit score). Rate-limited: 10 submissions/min per IP
- Score validation: server-side bounds check (min/max configurable per leaderboard), duplicate detection within 1s window

**Web Changes:**
- `web/src/lib/scripting/forgeLeaderboard.ts` — `forge.leaderboard.submit(name, score)`, `forge.leaderboard.getTop(count)`, `forge.leaderboard.getPlayerRank(name)`
- `web/src/components/play/LeaderboardOverlay.tsx` — In-game leaderboard display (top 10, player rank)
- `web/src/lib/chat/handlers/socialHandlers.ts` — MCP handlers

**MCP Commands (4):**
- `create_leaderboard` — Defines a leaderboard for the current game (name, sort order)
- `list_leaderboards` — Returns all leaderboards for the game
- `configure_leaderboard` — Updates sort order, display count, score bounds
- `delete_leaderboard` — Removes a leaderboard and its entries

### Phase 2: Screenshot Sharing

- `web/src/app/api/play/[userId]/[slug]/screenshot/route.ts` — POST (upload canvas screenshot as WebP to R2 `spawnforge-assets`), GET (list screenshots for a game)
- `forge.screenshot.capture()` — Captures canvas via `toDataURL()`, uploads to API
- Community gallery page: `/community/games/[id]/screenshots`
- Tier limits: Free 10 screenshots/game, Creator 100, Pro unlimited

### Phase 3: Social Sharing + Reactions

- Share URLs with Open Graph meta tags for Discord/Twitter embeds
- Like/reaction counts on community game pages (existing `communityStore` extended)
- Player profiles with achievement badges (stretch)

## Constraints

- Leaderboard entries are anonymous (playerName string, no auth required for players)
- Anti-cheat: server-side score bounds only (no client-side trusted computation)
- Screenshots stored in R2 `spawnforge-assets` bucket with signed URLs
- Rate limiting on all public endpoints via `rateLimitPublicRoute()`
- No real-time updates (polling-based, 30s refresh)

## Acceptance Criteria

- Given a published game with a leaderboard, When a player calls `forge.leaderboard.submit("Alice", 1500)`, Then the score appears in GET /leaderboard sorted correctly
- Given 10 submissions from the same IP in 1 minute, When the 11th is attempted, Then a 429 response is returned
- Given a score outside configured bounds, When submitted, Then a 400 response with "Score out of range" is returned
- Given a published game, When a player calls `forge.screenshot.capture()`, Then a WebP image is uploaded and visible on the community page

## Alternatives Considered

- **WebSocket real-time leaderboards:** Rejected — adds infrastructure complexity. Polling is adequate for game leaderboards where updates are infrequent.
- **Third-party leaderboard service:** Rejected — adds vendor dependency and cost. Our DB handles the scale (hundreds of games, thousands of entries).
