/**
 * Trust-and-safety tuning constants (PF-681 / #8354).
 */

/**
 * Number of DISTINCT reporters required before a `published` game is
 * auto-hidden (`status = 'flagged'`) pending admin review.
 *
 * PRODUCT DECISION — READ BEFORE CHANGING.
 * ----------------------------------------
 * `1` is what issue #8354's acceptance criteria specify: "a viewer reports it →
 * the game is hidden pending review", with `reportCount = 1` and
 * `hidden: true` on the very first report. It is implemented literally so that
 * criterion passes.
 *
 * The cost of `1` is that any authenticated account is a one-click unpublish
 * button for any published game, at zero cost to the attacker, with no admin UI
 * to notice it (the moderation queue is API-only today). Raising this to 2 or 3
 * removes the single-account takedown at the price of leaving genuinely harmful
 * content live for longer.
 *
 * The knob exists so that decision is a one-line constant change rather than a
 * rewrite of the report route's UPDATE. The auto-hide comparison is
 * `report_count + 1 >= REPORT_AUTOHIDE_THRESHOLD`, evaluated inside the single
 * atomic statement in
 * `web/src/app/api/community/games/[id]/report/route.ts`.
 *
 * Deliberately NOT an env var: an auto-hide threshold that differs between
 * preview and production makes moderation behaviour untestable, and a typo'd
 * env value would silently disable auto-hide entirely.
 */
export const REPORT_AUTOHIDE_THRESHOLD = 1;

/** Rate limit for POST /api/community/games/[id]/report — per user, per window. */
export const REPORT_RATE_LIMIT_MAX = 5;

/** Rate-limit window for the report route, in seconds. */
export const REPORT_RATE_LIMIT_WINDOW_SECONDS = 60;

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
