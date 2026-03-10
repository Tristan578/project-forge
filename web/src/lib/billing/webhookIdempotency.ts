/**
 * DB-backed webhook idempotency service.
 *
 * Replaces the in-memory Set approach so that events claimed before a
 * Vercel cold start / function restart are not re-processed on the next
 * delivery of the same Stripe/Clerk webhook event.
 *
 * All operations are idempotent and safe for concurrent invocations:
 * - claimEvent uses INSERT … ON CONFLICT DO NOTHING + rowCount check
 * - releaseEvent deletes the row (allows retry on transient failure)
 * - cleanupExpired runs a DELETE WHERE expiresAt < NOW()
 */

import 'server-only';
import { sql, lt } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { webhookEvents } from '@/lib/db/schema';

const DEFAULT_TTL_HOURS = 72;

/**
 * Atomically claim a webhook event for processing.
 *
 * Returns true if this caller successfully claimed the event (first
 * delivery). Returns false if another request already claimed it, meaning
 * the event is a duplicate and should be skipped.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING — the DB atomically guarantees
 * exactly-once claiming across concurrent function invocations and across
 * cold starts (unlike an in-memory Set which is lost on restart).
 */
export async function claimEvent(
  eventId: string,
  source: string,
  ttlHours: number = DEFAULT_TTL_HOURS
): Promise<boolean> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  // ON CONFLICT DO NOTHING means rowCount = 0 when the row already exists.
  const result = await db
    .insert(webhookEvents)
    .values({ eventId, source, expiresAt })
    .onConflictDoNothing({ target: webhookEvents.eventId });

  // Drizzle neon-http returns { rowCount: number } on insert
  const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
  return rowCount > 0;
}

/**
 * Release a previously claimed event so it can be retried.
 *
 * Call this when processing fails and Stripe should be allowed to
 * redeliver. Deletes the row so the next delivery can claim it fresh.
 */
export async function releaseEvent(eventId: string, source: string): Promise<void> {
  const db = getDb();
  await db
    .delete(webhookEvents)
    .where(sql`${webhookEvents.eventId} = ${eventId} AND ${webhookEvents.source} = ${source}`);
}

/**
 * Check whether an event has already been processed and the claim has
 * not expired. Returns true if a valid (non-expired) claim exists.
 */
export async function isProcessed(eventId: string, source: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ eventId: webhookEvents.eventId })
    .from(webhookEvents)
    .where(sql`${webhookEvents.eventId} = ${eventId} AND ${webhookEvents.source} = ${source} AND ${webhookEvents.expiresAt} > NOW()`)
    .limit(1);
  return rows.length > 0;
}

/**
 * Delete all rows where expiresAt < NOW().
 *
 * Returns the number of rows deleted. Safe to call from a cron job or
 * maintenance route — will not affect active claims.
 */
export async function cleanupExpired(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.expiresAt, sql`NOW()`));
  return (result as { rowCount?: number }).rowCount ?? 0;
}
