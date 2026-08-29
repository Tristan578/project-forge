/**
 * Limits imposed by the database itself, and the write caps we layer on top of
 * them.
 *
 * These are not tuning knobs. `PG_INT4_MIN` / `PG_INT4_MAX` are the fixed range
 * of Postgres `integer` (int4), so any column declared `integer('...')` in
 * `schema.ts` rejects a value outside them. Passing one through anyway does not
 * produce a validation error at the API boundary — it produces a driver-level
 * error deep inside the insert, which lands in a route's outer catch as a
 * `captureException` plus a generic 500. On an unauthenticated route that turns
 * a malformed request into self-inflicted Sentry volume indistinguishable from
 * a real database incident (PF-9447).
 *
 * So a route that writes a caller-supplied number into an `integer` column must
 * range-check it here, before it reaches the DB.
 *
 * Updated: 2026-08-29
 */

// ---------------------------------------------------------------------------
// Postgres column ranges
// ---------------------------------------------------------------------------

/**
 * Minimum value of a Postgres `integer` (int4) column: -2^31.
 *
 * https://www.postgresql.org/docs/current/datatype-numeric.html
 */
export const PG_INT4_MIN = -2147483648;

/** Maximum value of a Postgres `integer` (int4) column: 2^31 - 1. */
export const PG_INT4_MAX = 2147483647;

// ---------------------------------------------------------------------------
// Free-form JSON write caps
// ---------------------------------------------------------------------------

/**
 * Maximum serialized size, in UTF-8 bytes, of the `metadata` object a player
 * may attach to a leaderboard entry.
 *
 * The leaderboard POST is unauthenticated and the column is `jsonb`, so without
 * a cap the only bound on a stored blob is the request body limit — and every
 * subsequent GET of that board reads the blob back and ships it to every
 * viewer. 4 KiB is generous for what the field is for (a level number, an
 * elapsed time, a seed, a short combo string) and keeps the worst case for a
 * full 100-entry board response near 400 KiB rather than unbounded.
 *
 * Depth and container count are NOT bounded here — those come from
 * `checkCommandPayload` in `@/lib/engine/commandPayloadGuard`, which already
 * owns that job for untrusted JSON and is reused rather than re-derived.
 */
export const LEADERBOARD_METADATA_MAX_BYTES = 4096;
