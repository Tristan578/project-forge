/**
 * DB-backed webhook idempotency service.
 *
 * Replaces the in-memory Set approach so that events claimed before a
 * Vercel cold start / function restart are not re-processed on the next
 * delivery of the same Stripe/Clerk webhook event.
 *
 * All operations are idempotent and safe for concurrent invocations:
 * - claimEvent uses INSERT ... ON CONFLICT DO NOTHING + .returning() check
 * - releaseEvent deletes the row (allows retry on transient failure)
 * - cleanupExpired runs a DELETE WHERE expiresAt < NOW()
 */

import 'server-only';
<<<<<<< HEAD
import { sql, lt, eq, and, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
=======
import { sql, lt } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
>>>>>>> origin/main
import { webhookEvents } from '@/lib/db/schema';

const DEFAULT_TTL_HOURS = 72;

/**
 * Short TTL for in-flight claims (5 minutes). If processing crashes without
 * calling releaseEvent(), the claim auto-expires so Stripe can redeliver.
 * On successful processing, the TTL is extended to the full DEFAULT_TTL_HOURS.
 */
const IN_FLIGHT_TTL_MINUTES = 5;

/**
 * Atomically claim a webhook event for processing.
 *
 * Returns true if this caller successfully claimed the event (first
 * delivery). Returns false if another request already claimed it, meaning
 * the event is a duplicate and should be skipped.
 *
<<<<<<< HEAD
 * Uses INSERT ... ON CONFLICT DO NOTHING -- the DB atomically guarantees
=======
 * Uses INSERT ... ON CONFLICT DO NOTHING — the DB atomically guarantees
>>>>>>> origin/main
 * exactly-once claiming across concurrent function invocations and across
 * cold starts (unlike an in-memory Set which is lost on restart).
 */
export async function claimEvent(
  eventId: string,
  source: string
): Promise<boolean> {
  // Use a short in-flight TTL. If processing crashes without releasing,
  // the claim auto-expires in IN_FLIGHT_TTL_MINUTES so Stripe can redeliver.
  const expiresAt = new Date(Date.now() + IN_FLIGHT_TTL_MINUTES * 60 * 1000);

  // ON CONFLICT DO NOTHING + .returning() — if the row already exists,
  // the insert is skipped and the returned array is empty.
  const rows = await queryWithResilience(() =>
    getDb()
      .insert(webhookEvents)
      .values({ eventId, source, expiresAt })
      .onConflictDoNothing({ target: webhookEvents.eventId })
      .returning({ eventId: webhookEvents.eventId })
  );

  return rows.length > 0;
}

/**
 * Extend the TTL of a claimed event after successful processing.
 * Moves the expiry from the short in-flight window to the full TTL
 * so the event is considered "processed" for DEFAULT_TTL_HOURS.
 */
export async function finalizeEvent(
  eventId: string,
  ttlHours: number = DEFAULT_TTL_HOURS
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
<<<<<<< HEAD

  // ON CONFLICT DO NOTHING means zero rows returned when the row already exists.
  const rows = await db
    .insert(webhookEvents)
    .values({ eventId, source, expiresAt })
    .onConflictDoNothing({ target: webhookEvents.eventId })
    .returning({ eventId: webhookEvents.eventId });

  return rows.length > 0;
=======
  await queryWithResilience(() =>
    getDb()
      .update(webhookEvents)
      .set({ expiresAt })
      .where(sql`${webhookEvents.eventId} = ${eventId}`)
  );
>>>>>>> origin/main
}

/**
 * Release a previously claimed event so it can be retried.
 *
 * Call this when processing fails and Stripe should be allowed to
 * redeliver. Deletes the row so the next delivery can claim it fresh.
 */
<<<<<<< HEAD
export async function releaseEvent(eventId: string, source: string): Promise<void> {
  const db = getDb();
  await db
    .delete(webhookEvents)
    .where(and(eq(webhookEvents.eventId, eventId), eq(webhookEvents.source, source)));
=======
export async function releaseEvent(eventId: string): Promise<void> {
  await queryWithResilience(() =>
    getDb()
      .delete(webhookEvents)
      .where(sql`${webhookEvents.eventId} = ${eventId}`)
  );
>>>>>>> origin/main
}

/**
 * Check whether an event has already been processed and the claim has
 * not expired. Returns true if a valid (non-expired) claim exists.
 */
<<<<<<< HEAD
export async function isProcessed(eventId: string, source: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ eventId: webhookEvents.eventId })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.eventId, eventId), eq(webhookEvents.source, source), gt(webhookEvents.expiresAt, sql`NOW()`)))
    .limit(1);
=======
export async function isProcessed(eventId: string): Promise<boolean> {
  const rows = await queryWithResilience(() =>
    getDb()
      .select({ eventId: webhookEvents.eventId })
      .from(webhookEvents)
      .where(sql`${webhookEvents.eventId} = ${eventId} AND ${webhookEvents.expiresAt} > NOW()`)
      .limit(1)
  );
>>>>>>> origin/main
  return rows.length > 0;
}

/**
 * Delete all rows where expiresAt < NOW().
 *
 * Returns the number of rows deleted. Safe to call from a cron job or
 * maintenance route -- will not affect active claims.
 */
export async function cleanupExpired(): Promise<number> {
<<<<<<< HEAD
  const db = getDb();
  const deleted = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.expiresAt, sql`NOW()`))
    .returning({ eventId: webhookEvents.eventId });
  return deleted.length;
=======
  const rows = await queryWithResilience(() =>
    getDb()
      .delete(webhookEvents)
      .where(lt(webhookEvents.expiresAt, sql`NOW()`))
      .returning({ eventId: webhookEvents.eventId })
  );
  return rows.length;
>>>>>>> origin/main
}
