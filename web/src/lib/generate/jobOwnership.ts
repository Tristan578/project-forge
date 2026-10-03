/**
 * Provider-job ownership binding (#10262).
 *
 * Every `/api/generate/<type>/status` route that resolves a provider key (all
 * but `music/status`, which resolves none) calls `resolveApiKey` as a
 * zero-cost status check, which returns the PLATFORM provider key by default.
 * Without an ownership check, ANY signed-in caller admitted past the panel
 * tier gate can poll an arbitrary provider job id — one they never created —
 * and read back its result using the platform's credentials.
 *
 * `src/app/api/__tests__/jobOwnershipCoverage.test.ts` is the structural gate:
 * it parses every App Router route file, selects each one that calls
 * `resolveApiKey` (at any path, not only `status/`), and fails one that
 * resolves a key without first refusing a non-`'owner'` result of
 * `verifyProviderJobOwner` for the authenticated caller (`withApiMiddleware`'s
 * `userId`, the same user the key is resolved for) on the polled `jobId`, which
 * must be the only value the handler reads from the request — unless the route
 * is a pinned, reasoned exemption (a token-charged new operation, or the
 * QStash-signed callback). It also fails a POST route behind such a route that
 * binds nothing.
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
import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { PROVIDERS, providerJobOwners, type Provider } from '@/lib/db/schema';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Record which user's request produced a provider job id. First writer wins
 * (`ON CONFLICT DO NOTHING` on the `(provider, providerJobId)` pair): once a
 * job id is bound, it can never be reassigned to a different user, even by a
 * route bug that calls this twice for the same id.
 *
 * MUST be awaited before the generation response reaches the client — a poll
 * can arrive the instant the client has the job id, so the binding has to
 * exist before that id is ever exposed. Never throws: a write failure is
 * reported to Sentry and swallowed, so the submit response itself still
 * succeeds (the same posture as the adjacent QStash durable-callback publish,
 * `maybePublishAsyncCallback` in `createGenerationHandler.ts`).
 *
 * What a failed write costs. It is NOT a security gap: with no binding row,
 * `verifyProviderJobOwner` answers `'not_owner'` to EVERY caller, so nobody —
 * attacker or owner — can poll that id with the platform key. But it DOES cost
 * the owner this job: the POST still answers 200 with the job id, and the
 * owner's first poll then gets a terminal 404 (`JOB_NOT_FOUND_MESSAGE`), which
 * the poller turns into a refund and a "We lost track of this generation"
 * toast. Swallowing the error only keeps the submit response from failing; it
 * does not keep the generation alive.
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
 * The three answers an ownership lookup can give (#10262).
 *
 * - `'owner'`: a binding exists and it is the caller's. The only value that
 *   lets a status route go on to resolve a key.
 * - `'not_owner'`: the lookup SUCCEEDED and found no binding for the caller —
 *   none at all (a legacy job that predates this check, or a bind write that
 *   itself failed) or one belonging to a different user. Definitive: polling
 *   again cannot change it, so the route answers a terminal 404.
 * - `'unverifiable'`: the lookup itself failed (a DB error that outlived
 *   `queryWithResilience`'s retries, or its circuit breaker failing fast
 *   during an outage). Still fail-CLOSED — no key is resolved — but NOT a
 *   verdict about the job, so the route answers a retryable 503 and the
 *   poller keeps polling. Folding this into `'not_owner'` would turn one DB
 *   blip into a permanent failure and refund of every in-flight, correctly
 *   bound, paid generation polled during it.
 */
export type JobOwnership = 'owner' | 'not_owner' | 'unverifiable';

/**
 * Verify the caller polling `providerJobId` is the user who created it.
 *
 * Never throws. A status route must refuse every result other than
 * `'owner'` BEFORE resolving a key, and map the refusal with
 * `jobOwnershipRefusal` (`./jobOwnershipResponse.ts`): `'not_owner'` -> 404,
 * `'unverifiable'` -> 503. Unlike the write side above, this IS the security
 * decision, so a lookup failure never lets an unverifiable poll through — it
 * only stops that failure from being reported as a verdict on the job.
 */
export async function verifyProviderJobOwner(
  userId: string,
  provider: Provider,
  providerJobId: string,
): Promise<JobOwnership> {
  try {
    const rows = await queryWithResilience(() =>
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
    return rows.length > 0 && rows[0].userId === userId ? 'owner' : 'not_owner';
  } catch (err) {
    captureException(err, { action: 'verify_provider_job_owner', provider, providerJobId, userId });
    return 'unverifiable';
  }
}

/**
 * The owner of `providerJobId` when that owner is NOT `userId`, else `null`
 * (unbound, or bound only to `userId`). Used by `POST /api/jobs` (#10262) to
 * refuse a client-reported job row whose `providerJobId` is already bound to a
 * DIFFERENT user — distinct from `verifyProviderJobOwner`, which answers "is
 * this caller the owner" for a status poll.
 *
 * Keyed on `providerJobId` across EVERY provider, never on a caller-reported
 * one: `POST /api/jobs` receives `provider` from the client, and that value is
 * not the binding's namespace (the sprite route binds an SDXL job under
 * `replicate` while its client reports `sdxl`), so a provider-scoped lookup
 * missed the honest case and let any caller skip the check by sending another
 * string. The `IN (PROVIDERS)` predicate covers every value `bindProviderJob`
 * can write (its `provider` is typed `Provider`, derived from that list) and
 * keeps the lookup on the `(provider, provider_job_id)` unique index rather
 * than a sequential scan. Excluding `userId` in SQL means a row bound to the
 * caller can never mask a row bound to someone else.
 *
 * Unlike `verifyProviderJobOwner`, this function does NOT catch a lookup
 * failure itself — there is no try/catch here, and a DB error propagates
 * (rejects) to the caller rather than resolving to `null` or any other
 * value. This IS the security decision, so callers MUST NOT treat a
 * rejection as "unbound": the only safe way to consume this function is to
 * let the rejection propagate (or explicitly re-throw after side effects)
 * so an enclosing handler denies the write, the way `POST /api/jobs`'s
 * outer try/catch turns this rejecting into a fixed 500 that skips the
 * insert. A caller that swallows the error and defaults to "no owner found"
 * would silently reopen the ownership-spoofing hole this function exists to
 * close.
 */
export async function findOtherProviderJobOwnerId(
  providerJobId: string,
  userId: string,
): Promise<string | null> {
  const rows = await queryWithResilience(() =>
    getDb()
      .select({ userId: providerJobOwners.userId })
      .from(providerJobOwners)
      .where(
        and(
          inArray(providerJobOwners.provider, [...PROVIDERS]),
          eq(providerJobOwners.providerJobId, providerJobId),
          ne(providerJobOwners.userId, userId),
        ),
      )
      .limit(1)
  );
  return rows.length > 0 ? rows[0].userId : null;
}
