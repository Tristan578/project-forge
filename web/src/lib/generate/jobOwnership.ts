/**
 * Provider-job ownership binding (#10262).
 *
 * Every `/api/generate/<type>/status` route calls `resolveApiKey` as a
 * zero-cost status check, which returns the PLATFORM provider key by default.
 * Without an ownership check, ANY signed-in caller admitted past the panel
 * tier gate can poll an arbitrary provider job id — one they never created —
 * and read back its result using the platform's credentials.
 *
 * `generation_jobs` cannot serve as that ownership record on its own: its
 * rows are created by the CLIENT (`generationStore.addJob` -> `POST
 * /api/jobs`), fire-and-forget, with a client-supplied `providerJobId`. A
 * caller can create a row claiming someone else's `providerJobId` (so "a row
 * exists for this user" proves nothing), and the row can be missing or late
 * relative to the first poll (so a naive lookup would break legitimate
 * polling).
 *
 * This module is the trustworthy alternative: `provider_job_owners` is
 * written SERVER-SIDE, by `createGenerationHandler`, right after the
 * provider returns the job id and BEFORE the response reaches the client —
 * so by the time a caller can ever see a job id, it is already bound.
 */
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { providerJobOwners, type Provider } from '@/lib/db/schema';
import { captureException } from '@/lib/monitoring/sentry-server';
import { JobOwnershipUnavailableError } from './jobOwnershipError';

/**
 * Record which user's request produced a provider job id. First writer wins
 * (`ON CONFLICT DO NOTHING` on the `(provider, providerJobId)` pair): once a
 * job id is bound, it can never be reassigned to a different user, even by a
 * route bug that calls this twice for the same id.
 *
 * MUST be awaited before the generation response reaches the client — a poll
 * can arrive the instant the client has the job id, so the binding has to
 * exist before that id is ever exposed. Never throws: a write failure is
 * reported to Sentry and swallowed, matching the fail-open posture of the
 * adjacent QStash durable-callback publish (`maybePublishAsyncCallback` in
 * `createGenerationHandler.ts`) — losing this write means the job is left
 * unprotected, not that the user's own generation should fail because of it.
 */
export async function bindProviderJob(
  userId: string,
  provider: Provider,
  providerJobId: string,
): Promise<void> {
  try {
    await queryWithResilience(() =>
      getDb()
        .insert(providerJobOwners)
        .values({ userId, provider, providerJobId })
        .onConflictDoNothing()
    );
  } catch (err) {
    captureException(err, { action: 'bind_provider_job', provider, providerJobId, userId });
  }
}

/**
 * Verify the caller polling `providerJobId` is the user who created it.
 *
 * Returns `false` — the status route's cue to answer 404, same as "job not
 * found" — both when no binding exists (an unbound legacy job that predates
 * this check, or a bind write that itself failed) and when the binding
 * belongs to a different user.
 *
 * A lookup FAILURE never resolves to `false`. It THROWS
 * `JobOwnershipUnavailableError` (after reporting to Sentry), which the status
 * routes render as 503 `SERVICE_DEGRADED` — still fail-closed (no key is
 * resolved, nothing is read), but distinguishable from "not yours". The
 * distinction matters because the poller treats a status-route 404 as
 * terminal (refund + stop polling): a `false` here on a DB hiccup would fail
 * the owner's running job while the provider kept working. See
 * `jobOwnershipError.ts`.
 */
export async function verifyProviderJobOwner(
  userId: string,
  provider: Provider,
  providerJobId: string,
): Promise<boolean> {
  let rows: Array<{ userId: string }>;
  try {
    rows = await queryWithResilience(() =>
      getDb()
        .select({ userId: providerJobOwners.userId })
        .from(providerJobOwners)
        .where(
          and(
            eq(providerJobOwners.provider, provider),
            eq(providerJobOwners.providerJobId, providerJobId),
          ),
        )
        .limit(1)
    );
  } catch (err) {
    captureException(err, { action: 'verify_provider_job_owner', provider, providerJobId, userId });
    throw new JobOwnershipUnavailableError();
  }
  return rows.length > 0 && rows[0].userId === userId;
}

/**
 * Whether ANY binding exists for a `(provider, providerJobId)` pair,
 * regardless of who owns it. Used by `POST /api/jobs` (#10262) to refuse a
 * client-reported job row whose `providerJobId` is already bound to a
 * DIFFERENT user — distinct from `verifyProviderJobOwner`, which answers
 * "is this caller the owner" for a status poll.
 *
 * A lookup failure never resolves to `null` or any other value: it is
 * reported to Sentry and re-thrown as `JobOwnershipUnavailableError`, the
 * same contract as `verifyProviderJobOwner`. This IS the security decision,
 * so callers MUST NOT treat the rejection as "unbound": `POST /api/jobs`
 * renders it as 503 `SERVICE_DEGRADED` and skips the insert. A caller that
 * swallows the error and defaults to "no owner found" would silently reopen
 * the ownership-spoofing hole this function exists to close.
 */
export async function findProviderJobOwnerId(
  provider: string,
  providerJobId: string,
): Promise<string | null> {
  let rows: Array<{ userId: string }>;
  try {
    rows = await queryWithResilience(() =>
      getDb()
        .select({ userId: providerJobOwners.userId })
        .from(providerJobOwners)
        .where(
          and(
            eq(providerJobOwners.provider, provider),
            eq(providerJobOwners.providerJobId, providerJobId),
          ),
        )
        .limit(1)
    );
  } catch (err) {
    captureException(err, { action: 'find_provider_job_owner', provider, providerJobId });
    throw new JobOwnershipUnavailableError();
  }
  return rows.length > 0 ? rows[0].userId : null;
}
