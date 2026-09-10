/**
 * The next step attached to an asynchronous generation failure.
 *
 * WHY IT IS A SUFFIX AND NOT PART OF THE SENTENCE. There is a deliberately
 * synchronised catalogue of failure sentences — `EmptyArtifactError`, the eight
 * `*／status` routes and `pollProviderStatus` all say
 * `<Type> generation produced no <artifact>`, and
 * `emptyArtifactError.test.ts` scans the whole source tree to keep them
 * identical, because the same failure reached by two paths must read the same
 * way. So the BASE sentence is shared vocabulary and must not be reworded per
 * path; guidance is appended at the point of emission, which is exactly what
 * `createGenerationHandler`'s `emptyArtifactResponse` already does on the
 * submit-time path ("Your tokens have been refunded — please try again").
 *
 * WHY THE ASYNC PATH NEEDED ONE. `useGenerationPolling.failJob` passes a server
 * route's message straight to `showPersistentError`, on the premise that "a
 * message that came from a server route is written for the user by definition".
 * That premise was half false: `Texture generation produced no maps` names the
 * condition and gives someone whose five-minute generation just ended in an
 * indefinite red toast nothing to do about it. It is the same register as the
 * strings that change explicitly removed from the toast channel.
 *
 * The wording deliberately does NOT promise a refund. The poll-time path does
 * not know whether one happened — `failJob` at the `status: 'failed'` branch
 * does not refund at all — and promising one that did not occur is a support
 * ticket. `emptyArtifactResponse` passes `refunded` explicitly for the same
 * reason.
 */
export const RETRY_GUIDANCE = 'Try again, or adjust your prompt.';

/**
 * Attach {@link RETRY_GUIDANCE} to a base failure sentence.
 *
 * The base is authored in our code and must stay a static literal — it is the
 * catalogue entry the drift guard scans for. Never pass provider text through
 * here; a suffix does not make upstream words safe to forward (#9736).
 */
export function withRetryGuidance(baseMessage: string): string {
  return `${baseMessage}. ${RETRY_GUIDANCE}`;
}
