/**
 * "Cannot verify" is not "not yours" (#10262, round 4).
 *
 * `verifyProviderJobOwner` used to resolve `false` on a lookup FAILURE, and
 * every status route renders `false` as the same 404 it sends for a job that
 * is genuinely not bound to the caller. Since round 3 the poller treats a
 * status-route 404 as terminal (refund + stop), so a DB error on the ownership
 * SELECT — retries exhausted, a non-transient error, the breaker opening
 * mid-request — would fail the OWNER's running job and refund it while the
 * provider kept working. Before the ownership check existed, the equivalent
 * DB failure inside `resolveApiKey` surfaced as a 500/503 the poller retried.
 *
 * So the lookup failure is its own error class, and the routes render it as
 * the 503 `SERVICE_DEGRADED` contract `authenticateRequest` established
 * (`serviceDegraded` in `@/lib/api/errors`), which the poller keeps polling
 * through. Still fail-closed — no key is resolved, nothing is read — but the
 * job is not declared lost.
 *
 * This lives in its own module, not in `jobOwnership.ts`, because every
 * status-route test mocks that module with a factory; a class exported from
 * the mocked module would be `undefined` under test and `instanceof` would
 * throw. Nothing here touches the database.
 */
export class JobOwnershipUnavailableError extends Error {
  override readonly name = 'JobOwnershipUnavailableError';

  constructor(message = 'Job ownership lookup failed') {
    super(message);
  }
}

/**
 * The sentence in the 503 body. `error` carries the code `SERVICE_DEGRADED`;
 * `useGenerationPolling.statusErrorText` prefers `message` when `error` is a
 * code, so this is what a person would read if the poll never recovered.
 */
export const JOB_OWNERSHIP_UNAVAILABLE_MESSAGE =
  'Could not verify who owns this job right now. Please retry.';
