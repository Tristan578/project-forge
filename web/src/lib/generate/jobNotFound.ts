/**
 * The 404 body a `/api/generate/<type>/status` route answers when the polled
 * job id is not bound to the caller (#10262).
 *
 * WHY IT IS A SENTENCE AND NOT `'Job not found'`. Every status-route string
 * that reaches `useGenerationPolling.failJob` is shown to the person verbatim
 * in a persistent toast, on the documented premise that "a server route wrote
 * it for the user" — each names what happened and what to do about it (see
 * the `failJob` docblock in `src/hooks/useGenerationPolling.ts`, and
 * `retryGuidance.ts` for why the next step is a shared suffix). A bare
 * `'Job not found'` broke that premise on the one refusal that legitimately
 * reaches a job's OWNER: a job in flight when the ownership table shipped has
 * no binding row, and a job whose `bindProviderJob` write failed has none
 * either, so the person who paid for it polls and gets this 404. "Try again"
 * is the right next step in both cases — a fresh generation is bound before
 * its id is ever returned.
 *
 * ONE constant, imported by all seven routes and their tests, so the wording
 * cannot drift per route the way the `produced no <artifact>` catalogue once
 * did (`emptyArtifactError.test.ts`). The poller treats the 404 status itself
 * as terminal — it does not parse this text — so the sentence is free to
 * change; only its register (user-facing, with a next step) is pinned by
 * `__tests__/jobNotFound.test.ts`.
 */
import { withRetryGuidance } from './retryGuidance';

export const JOB_NOT_FOUND_MESSAGE = withRetryGuidance(
  'This generation job was not found for your account',
);
