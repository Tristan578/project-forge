/**
 * The bodies a `/api/generate/<type>/status` route answers when it refuses a
 * poll on ownership grounds (#10262). The route picks one with
 * `jobOwnershipRefusal` (`./jobOwnershipResponse.ts`).
 *
 * WHY THEY ARE SENTENCES AND NOT `'Job not found'`. Every status-route string
 * that reaches `useGenerationPolling.failJob` is shown to the person verbatim
 * in a persistent toast, on the documented premise that "a server route wrote
 * it for the user" — each names what happened and what to do about it (see
 * the `failJob` docblock in `src/hooks/useGenerationPolling.ts`).
 *
 * WHY THE 404 SENTENCE DOES NOT USE `withRetryGuidance`. That suffix ("Try
 * again, or adjust your prompt.") is for a generation that ran and produced a
 * bad result, where rewording the prompt can help. Nothing about the prompt
 * caused this refusal. The person who legitimately sees it is a job's OWNER: a
 * job in flight when the ownership table shipped has no binding row, and a job
 * whose `bindProviderJob` write failed has none either. So the sentence says
 * what happened in their terms (the generation was lost track of and stopped)
 * and the one step that works (generate it again — a fresh generation is bound
 * before its id is ever returned). It deliberately does not mention "your
 * account": nothing is wrong with the account, and saying so reads like one.
 *
 * ONE constant per condition, imported by all seven routes (through
 * `jobOwnershipRefusal`), their tests and the poller's fallback, so the wording
 * cannot drift per route the way the `produced no <artifact>` catalogue once
 * did (`emptyArtifactError.test.ts`). The poller keys its behaviour on the
 * STATUS (404 terminal, 503 transient) — it never parses this text. Even so,
 * `__tests__/jobNotFound.test.ts` pins the 404 sentence VERBATIM, because the
 * changeset quotes it to users (a reword must edit both together); only the
 * 503 sentence is pinned by register (what it says and that it gives a next
 * step), not word for word.
 *
 * Client-safe: no server imports, because `useGenerationPolling` uses
 * `JOB_NOT_FOUND_MESSAGE` as its fallback for a 404 whose body is unreadable.
 */

/**
 * 404: the lookup succeeded and the polled job id is not bound to the caller.
 * Terminal — the poller refunds and stops on the first one.
 */
export const JOB_NOT_FOUND_MESSAGE =
  'We lost track of this generation, so it was stopped. Try generating it again.';

/**
 * 503: the ownership lookup itself failed, so the route could neither confirm
 * nor rule out the caller (fail-closed: no key is resolved). Transient — the
 * poller keeps polling, and the person sees this only if the job eventually
 * gives up at the poll cap with this as the last thing the route said.
 */
export const JOB_OWNERSHIP_UNAVAILABLE_MESSAGE =
  'We could not check on this generation because a service was temporarily unavailable. Try generating it again.';
