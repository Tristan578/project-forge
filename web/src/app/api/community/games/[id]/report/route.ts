/**
 * POST /api/community/games/[id]/report — viewer-initiated game report (#8354).
 *
 * Records one report per (game, reporter) and, once the number of DISTINCT
 * reporters reaches REPORT_AUTOHIDE_THRESHOLD, flips a `published` game to
 * `flagged` — which the play page and the community gallery already exclude via
 * their `status = 'published'` filters, so the game stops being publicly
 * playable with no read-path change.
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
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  GAME_REPORT_REASONS,
  REPORT_AUTOHIDE_THRESHOLD,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_RATE_LIMIT_MAX,
  REPORT_RATE_LIMIT_WINDOW_SECONDS,
} from '@/lib/config/moderation';

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
  status: string;
  report_count: number | string;
  hidden: boolean | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
        .select({ id: publishedGames.id })
        .from(publishedGames)
        .where(eq(publishedGames.id, gameId))
        .limit(1)
    );

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
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
          SET report_count = pg.report_count + 1,
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
        FROM upd CROSS JOIN pre
      `
    )) as unknown as ReportResultRow[];

    // Zero rows means the ON CONFLICT fired: this reporter had already reported
    // this game, so nothing was inserted and nothing was counted.
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ reported: true, hidden: false, duplicate: true });
    }

    return NextResponse.json({
      reported: true,
      hidden: row.hidden === true,
      reportCount: Number(row.report_count),
    });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/report' });
    return NextResponse.json({ error: 'Failed to report game' }, { status: 500 });
  }
}
