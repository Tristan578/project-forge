/**
 * POST /api/community/games/[id]/report — viewer-initiated game report (#8354).
 *
 * Records one report per (game, reporter) and, once the number of DISTINCT
 * reporters since the last moderator review reaches REPORT_AUTOHIDE_THRESHOLD,
 * flips a `published` game to `flagged` — which the play page and the community
 * gallery already exclude via their `status = 'published'` filters, so the game
 * stops being publicly playable with no read-path change.
 *
 * Operator runbook: `docs/guides/moderation-queue.md`.
 *
 * ABUSE CONTROLS (all four are load-bearing; the threshold alone is not enough)
 * ---------------------------------------------------------------------------
 * 1. Vercel BotID, the same gate /api/generate/* and /api/billing/checkout use.
 *    Runs BEFORE the rate limiter so a blocked bot never spends a bucket.
 * 2. Self-report rejection — a creator cannot report their own game, which
 *    otherwise contributes a free reporter towards the threshold.
 * 3. A PER-GAME rate limit on top of the per-reporter one. The per-reporter
 *    bucket does nothing against a brigade of N accounts each spending one
 *    request; this one bounds a coordinated takedown in wall-clock time.
 * 4. REPORT_AUTOHIDE_THRESHOLD distinct reporters, counted since the last
 *    moderator review (see the constant's docblock).
 *
 * KNOWN WINDOW — the CDN, not the database, decides what a viewer sees for the
 * first few minutes after an auto-hide. GET /api/play/[userId]/[slug] is
 * `dynamic = 'force-dynamic'` and sets `Cache-Control: public, s-maxage=30,
 * stale-while-revalidate=120` by hand, and the gallery sets `s-maxage=60,
 * stale-while-revalidate=300`. A `force-dynamic` route handler has no Next.js
 * cache entry, so `revalidatePath()` here would purge nothing — it would be a
 * check on an adjacent property, green while the content is still served. The
 * hide is therefore authoritative in the database immediately and at the edge
 * within at most 150s (play) / 360s (gallery). Closing that window means
 * changing those two routes' cache headers, which is a deliberate latency
 * trade-off on the hottest read path and is out of scope here.
 *
 * WHY ONE RAW SQL STATEMENT INSTEAD OF TWO DRIZZLE WRITES
 * -------------------------------------------------------
 * The insert and the counter bump must not be separable. `db.transaction()`
 * throws on the neon-http driver (see the PF-525 comment block in
 * `@/lib/db/client`), so an INSERT ... ON CONFLICT DO NOTHING followed by a
 * separate UPDATE would lose the count bump *permanently* whenever the second
 * write fails: the retry's INSERT no-ops on the unique index, so the UPDATE is
 * never reached again and the report is recorded but never counted. Folding
 * both into a single statement — the UPDATE gated on `EXISTS (SELECT 1 FROM
 * ins)` — makes "row inserted" and "count bumped" the same commit, with no
 * transaction wrapper and no lost-update window between two concurrent
 * reporters (the increment is computed SQL-side from the row's own value).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, getNeonSql, queryWithResilience } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { rateLimitResponse } from '@/lib/rateLimit';
import { checkBotIdGate } from '@/lib/security/botId';
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  GAME_REPORT_REASONS,
  REPORT_AUTOHIDE_THRESHOLD,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_PER_GAME_RATE_LIMIT_MAX,
  REPORT_PER_GAME_RATE_LIMIT_WINDOW_SECONDS,
  REPORT_RATE_LIMIT_MAX,
  REPORT_RATE_LIMIT_WINDOW_SECONDS,
} from '@/lib/config/moderation';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

const reportSchema = z.object({
  reason: z.enum(GAME_REPORT_REASONS),
  details: z.string().trim().max(REPORT_DETAILS_MAX_LENGTH).optional(),
});

// published_games.id is a uuid column. Next.js decodes route params, so an
// arbitrary string reaches us here; passing one straight to Postgres raises
// `invalid input syntax for type uuid`, which is a 500 for what is really a
// "no such game". Reject the shape BEFORE any DB access, exactly as the POST
// body is validated before it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReportResultRow {
  // NULL when `upd` produced no row — the report conflicted with an existing
  // one from the same reporter, so nothing was inserted and nothing counted.
  status: string | null;
  report_count: number | string | null;
  hidden: boolean | null;
}

async function POST_impl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Bot gate first: a blocked bot must not consume either rate-limit bucket.
    const botIdResponse = await checkBotIdGate();
    if (botIdResponse) return botIdResponse;

    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: {
        key: (id) => `report:${id}`,
        max: REPORT_RATE_LIMIT_MAX,
        windowSeconds: REPORT_RATE_LIMIT_WINDOW_SECONDS,
      },
      validate: reportSchema,
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;
    if (!UUID_RE.test(gameId)) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const { reason, details } = mid.body as z.infer<typeof reportSchema>;

    const [game] = await queryWithResilience(() =>
      getDb()
        .select({ id: publishedGames.id, userId: publishedGames.userId })
        .from(publishedGames)
        .where(eq(publishedGames.id, gameId))
        .limit(1)
    );

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // A creator reporting their own game would count as a distinct reporter
    // towards the auto-hide threshold — one free vote per takedown, and a way
    // to self-hide that bypasses DELETE /api/publish/[id]'s bookkeeping.
    if (game.userId === mid.userId) {
      return NextResponse.json(
        { error: 'You cannot report your own game', code: 'SELF_REPORT' },
        { status: 403 }
      );
    }

    // Per-GAME bucket, checked after the game is known to exist so a 404 probe
    // cannot exhaust a real game's budget. Distinct key namespace from the
    // per-reporter `report:` bucket above.
    const perGame = await distributedRateLimit(
      `report-game:${gameId}`,
      REPORT_PER_GAME_RATE_LIMIT_MAX,
      REPORT_PER_GAME_RATE_LIMIT_WINDOW_SECONDS
    );
    if (!perGame.allowed) {
      return rateLimitResponse(perGame.remaining, perGame.resetAt);
    }

    const sql = getNeonSql();

    // `pre` captures the status as it stood BEFORE this statement (a
    // data-modifying CTE's effects are invisible to the rest of the same
    // statement), which is the only way to answer "did THIS call hide the
    // game" without a racy read-then-write. MATERIALIZED pins that so the
    // planner cannot inline it into the post-update branch.
    //
    // Selecting the INSERT's values FROM pre also means a game that vanished
    // between the 404 check above and this statement inserts nothing rather
    // than raising a foreign-key violation.
    //
    // report_count is bumped ONLY while the game is 'published'. Counting
    // reports against an 'unpublished'/'processing'/'flagged' row let a group
    // bank the counter against a game nobody could see and hide it on the first
    // report after it went live, which defeats any threshold above 1. The
    // report ROW is still recorded in either case — the moderator history is
    // complete, only the auto-hide arithmetic is scoped.
    const rows = (await queryWithResilience(
      () => sql`
        WITH pre AS MATERIALIZED (
          SELECT id, status AS prev_status
          FROM published_games
          WHERE id = ${gameId}::uuid
        ),
        ins AS (
          INSERT INTO game_reports (game_id, reporter_id, reason, details)
          SELECT pre.id, ${mid.userId!}::uuid, ${reason}::game_report_reason, ${details ?? null}::text
          FROM pre
          ON CONFLICT (game_id, reporter_id) DO NOTHING
          RETURNING 1
        ),
        upd AS (
          UPDATE published_games pg
          SET report_count = CASE
                WHEN pg.status = 'published' THEN pg.report_count + 1
                ELSE pg.report_count
              END,
              status = CASE
                WHEN pg.status = 'published'
                 AND pg.report_count + 1 >= ${REPORT_AUTOHIDE_THRESHOLD}::int
                THEN 'flagged'::publish_status
                ELSE pg.status
              END,
              flagged_at = CASE
                WHEN pg.status = 'published'
                 AND pg.report_count + 1 >= ${REPORT_AUTOHIDE_THRESHOLD}::int
                THEN now()
                ELSE pg.flagged_at
              END,
              updated_at = now()
          WHERE pg.id = ${gameId}::uuid
            AND EXISTS (SELECT 1 FROM ins)
          RETURNING pg.status AS new_status, pg.report_count AS new_report_count
        )
        SELECT upd.new_status AS status,
               upd.new_report_count AS report_count,
               (pre.prev_status = 'published' AND upd.new_status = 'flagged') AS hidden
        FROM pre LEFT JOIN upd ON true
      `
    )) as unknown as ReportResultRow[];

    // The final SELECT is driven by `pre`, not by `upd`, so the two ways this
    // statement can decline to write are distinguishable. A CROSS JOIN made
    // both collapse to zero rows and reported either as a duplicate — telling
    // someone "you have already reported this game" about a game that had just
    // been deleted, and swallowing the fact that no report was filed.
    //
    // No row at all: `pre` matched nothing, i.e. the game was deleted between
    // the existence check above and this statement. Same answer as that check.
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // A row with no `upd` half: the ON CONFLICT fired, so this reporter had
    // already reported this game and nothing was inserted or counted.
    if (row.status === null || row.status === undefined) {
      return NextResponse.json({ reported: true, hidden: false, duplicate: true });
    }

    // `reportCount` is deliberately NOT returned. It is moderation metadata
    // about someone else's game, and one report per game per account is enough
    // to enumerate the gallery for targets sitting one report below the
    // threshold. The dialog only ever reads `hidden` and `duplicate`.
    return NextResponse.json({
      reported: true,
      hidden: row.hidden === true,
    });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/report' });
    return redactedJson({ error: 'Failed to report game' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
