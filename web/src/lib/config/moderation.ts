/**
 * Trust-and-safety tuning constants (PF-681 / #8354).
 */

/**
 * Number of DISTINCT reporters required, SINCE THE LAST MODERATOR REVIEW,
 * before a `published` game is auto-hidden (`status = 'flagged'`) pending
 * review.
 *
 * PRODUCT DECISION — READ BEFORE CHANGING.
 * ----------------------------------------
 * Issue #8354's acceptance criteria are written as "a viewer reports it → the
 * game is hidden pending review", i.e. a literal threshold of `1`. That was
 * shipped first and failed the security seat of the review board, for a reason
 * the AC did not consider: at `1`, ONE free account is a platform-wide unpublish
 * button. The report route's own rate limit is per *reporter* (5/60s), so a
 * single scripted account can hide ~300 games an hour, every affected creator is
 * then 403'd from republishing, and no operator is paged. The AC describes the
 * happy path of a single honest report; it does not price the abuse case.
 *
 * `3` distinct reporters is the shipped value. It is not a substitute for the
 * abuse controls that live alongside it in
 * `web/src/app/api/community/games/[id]/report/route.ts` — a self-report
 * rejection, a PER-GAME rate limit (see below), and the Vercel BotID gate — it
 * is one layer of several. Raising it further trades faster takedown of
 * genuinely harmful content for more resistance to brigading.
 *
 * COUNTS ARE PER REVIEW CYCLE, NOT LIFETIME. `published_games.report_count` is
 * reset to 0 by an admin approve and by a won appeal, so this constant means
 * what it says at every point in a game's life. Before that reset existed the
 * counter was monotonic, which made any value above 1 decorative: a game that
 * had ever been reviewed sat permanently at `report_count >= THRESHOLD - 1`, so
 * the next single report re-hid it and the one-account takedown was fully
 * restored. Keep the reset and this constant together.
 *
 * The auto-hide comparison is `report_count + 1 >= REPORT_AUTOHIDE_THRESHOLD`,
 * evaluated inside the single atomic statement in the report route, and the
 * count is only incremented while the game is `published` (banking reports
 * against an `unpublished`/`processing` row to hide it the instant it goes live
 * was the other way to defeat a threshold above 1).
 *
 * Deliberately NOT an env var: an auto-hide threshold that differs between
 * preview and production makes moderation behaviour untestable, and a typo'd
 * env value would silently disable auto-hide entirely.
 */
export const REPORT_AUTOHIDE_THRESHOLD = 3;

/** Rate limit for POST /api/community/games/[id]/report — per user, per window. */
export const REPORT_RATE_LIMIT_MAX = 5;

/** Rate-limit window for the report route, in seconds. */
export const REPORT_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Rate limit for reports against ONE game, across all reporters, per window.
 *
 * The per-reporter limit above does nothing against a brigade: N accounts each
 * spending 1 of their 5 requests take a game down without any of them coming
 * near their own bucket. This bucket is keyed on the game id instead, so the
 * cost of a coordinated takedown is bounded in wall-clock time rather than in
 * accounts. It is set above REPORT_AUTOHIDE_THRESHOLD on purpose — it slows a
 * brigade down, it must never stop honest reporters from reaching the threshold
 * on genuinely harmful content.
 */
export const REPORT_PER_GAME_RATE_LIMIT_MAX = 10;

/** Rate-limit window for the per-game report bucket, in seconds (1 hour). */
export const REPORT_PER_GAME_RATE_LIMIT_WINDOW_SECONDS = 3600;

/** Max length of the optional free-text `details` field on a report. */
export const REPORT_DETAILS_MAX_LENGTH = 2000;

/**
 * Report reasons, in the order they are offered in the UI.
 * Must stay in sync with `gameReportReasonEnum` in `@/lib/db/schema`.
 */
export const GAME_REPORT_REASONS = [
  'sexual_content',
  'violence',
  'hate_speech',
  'copyright',
  'spam',
  'other',
] as const;

export type GameReportReason = (typeof GAME_REPORT_REASONS)[number];

/** Human-readable labels for `GAME_REPORT_REASONS`, used by ReportGameDialog. */
export const GAME_REPORT_REASON_LABELS: Record<GameReportReason, string> = {
  sexual_content: 'Sexual or adult content',
  violence: 'Graphic violence',
  hate_speech: 'Hate speech or harassment',
  copyright: 'Copyright or trademark infringement',
  spam: 'Spam or misleading content',
  other: 'Something else',
};
