/**
 * Stripe billing-meters usage reporter (PF-978 / #8970).
 *
 * Reports net-confirmed generation token usage to the `generation_tokens`
 * Stripe billing meter so metered-tier revenue can be reconciled against
 * actual consumption. Fully dormant unless `BILLING_METERS_ENABLED` is the
 * exact string 'true' (see `isBillingMetersEnabled`, matching the
 * `NEXT_PUBLIC_USE_DEEP_GENERATION` convention) — every early return below
 * is a documented no-op path, not a silent failure.
 *
 * Never call this from the request path: it does DB writes and a Stripe
 * API call, neither of which should block a generation response. Callers
 * must invoke it fire-and-forget (e.g. via `after()`).
 *
 * See specs/stripe-billing-meters.md for the full design, including the
 * claim-before-emit protocol (section 4) and refund semantics (section 5).
 */

import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { tokenUsage } from '@/lib/db/schema';
import { getStripe } from './stripe-client';
import { captureException } from '@/lib/monitoring/sentry-server';

/** Must match the `event_name` used by the one-time meter provisioning
 * script (`web/scripts/provision-billing-meter.ts`, PF-977 / #8969). */
export const METER_EVENT_NAME = 'generation_tokens';

/** Stripe billing-meter events must timestamp within this many days in the
 * past (Stripe's own limit is 35 days; we clamp to 34 for safety margin). */
const MAX_PAST_DAYS = 34;

/** Stripe allows events timestamped slightly in the future to absorb clock
 * skew between this server and Stripe's ingestion pipeline. */
const MAX_FUTURE_MINUTES = 4;

/**
 * True only when `BILLING_METERS_ENABLED` is the exact string 'true'. Any
 * other value (unset, 'false', '1', etc.) leaves metering fully dormant.
 */
export function isBillingMetersEnabled(): boolean {
  return process.env.BILLING_METERS_ENABLED === 'true';
}

/**
 * Clamp an event timestamp to the window Stripe's billing-meters API will
 * accept, expressed as Unix seconds. Defaults to "now" when no createdAt
 * is supplied.
 */
function toUnixWithinWindow(createdAt?: Date): number {
  const now = Date.now();
  const eventMs = (createdAt ?? new Date()).getTime();
  const minMs = now - MAX_PAST_DAYS * 24 * 60 * 60 * 1000;
  const maxMs = now + MAX_FUTURE_MINUTES * 60 * 1000;
  const clampedMs = Math.min(Math.max(eventMs, minMs), maxMs);
  return Math.floor(clampedMs / 1000);
}

export interface ReportGenerationUsageArgs {
  stripeCustomerId: string | null;
  /** token_usage.id — required; rows without one (or unmetered rows) are
   * never reported. */
  usageId: string | undefined;
  tokenCost: number;
  operation: string;
  /** ResolvedKey.metered — false for BYOK keys, which must never be
   * billed against the platform meter. */
  metered: boolean;
  /** Event timestamp; defaults to now. Pass token_usage.createdAt when
   * reporting after the fact (e.g. a backfill) so Stripe attributes usage
   * to the correct billing period. */
  createdAt?: Date;
}

/**
 * Report confirmed generation usage to the Stripe `generation_tokens`
 * meter. Fire-and-forget: never throws — all failure paths are caught and
 * sent to Sentry so a Stripe outage or a bad row never breaks the caller.
 *
 * Implements the claim-before-emit protocol from
 * specs/stripe-billing-meters.md section 4: a guarded UPDATE claims the
 * row (meter_attempted_at) before the Stripe call, meter_attempted_at is
 * cleared on any failure so a later retry can safely re-attempt (Stripe
 * dedupes retries via `identifier`), and metered_at is set only after
 * Stripe confirms the event.
 */
export async function reportGenerationUsage(args: ReportGenerationUsageArgs): Promise<void> {
  if (!isBillingMetersEnabled()) return;
  if (!args.metered || !args.usageId) return;
  if (!Number.isFinite(args.tokenCost) || args.tokenCost <= 0) return;

  const usageId = args.usageId;

  if (!args.stripeCustomerId) {
    // A metered (paid-tier) usage row with no Stripe customer id is an
    // anomaly worth investigating, not a silent skip.
    captureException(new Error('metered usage without stripe_customer_id'), {
      action: 'meter_event',
      usageId,
    });
    return;
  }

  // Claim: only proceed if this row has never been attempted. Two
  // concurrent callers for the same usageId race here; exactly one wins
  // (non-empty .returning()), the other sees an empty array and skips.
  // This is deliberately inside its own try/catch: a DB error here (e.g. a
  // dropped connection) must never escape this fire-and-forget function
  // and break the caller's generation flow.
  let claimedRows: { id: string }[];
  try {
    claimedRows = await queryWithResilience(() =>
      getDb()
        .update(tokenUsage)
        .set({ meterAttemptedAt: new Date() })
        .where(and(eq(tokenUsage.id, usageId), isNull(tokenUsage.meterAttemptedAt)))
        .returning({ id: tokenUsage.id })
    );
  } catch (err) {
    captureException(err, { action: 'meter_event_claim', usageId });
    return;
  }

  if (claimedRows.length === 0) {
    // Already attempted (possibly concurrently, possibly a stale claim).
    // See spec section 4 repair-state rules for reconciling old claims —
    // this function never blindly re-emits past its own claim window.
    return;
  }

  try {
    await getStripe().billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      identifier: usageId,
      timestamp: toUnixWithinWindow(args.createdAt),
      payload: {
        value: String(args.tokenCost),
        stripe_customer_id: args.stripeCustomerId,
        operation: args.operation,
      },
    });

    await queryWithResilience(() =>
      getDb()
        .update(tokenUsage)
        .set({ meteredAt: new Date() })
        .where(eq(tokenUsage.id, usageId))
    );
  } catch (err) {
    captureException(err, { action: 'meter_event', usageId });

    // Best-effort claim release so a subsequent attempt can retry. Safe
    // even if the Stripe call above actually succeeded and only the
    // metered_at write failed: Stripe dedupes re-emission by `identifier`.
    try {
      await queryWithResilience(() =>
        getDb()
          .update(tokenUsage)
          .set({ meterAttemptedAt: null })
          .where(eq(tokenUsage.id, usageId))
      );
    } catch (clearErr) {
      captureException(clearErr, { action: 'meter_event_clear_claim', usageId });
    }
  }
}
