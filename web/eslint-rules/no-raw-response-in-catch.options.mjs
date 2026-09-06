/**
 * The options `spawnforge/no-raw-response-in-catch` runs with, in ONE place.
 *
 * WHY THEY MOVED HERE. They lived in `web/eslint.config.mjs`, and
 * `src/app/api/__tests__/noRawResponseInCatch.test.ts` retyped them — with a
 * comment claiming "Matches the options the flat config passes". It did not:
 * the config passed thirteen `responseHelpers` and the suite passed three, so
 * nothing pinned that the rule accepts a sanctioned constructor for ten of the
 * thirteen names it sanctions, and an edit to the list could not fail any test.
 * That is the citation-a-reviewer-cannot-check defect this same PR corrected
 * twice elsewhere (the `EmptyArtifactError` file reference, and a benchmark
 * script that did not exist).
 *
 * Both the flat config and the RuleTester suite import these, so the suite runs
 * against the SHIPPED options by construction rather than by a promise in a
 * comment.
 */

/**
 * Error classes whose `message` is authored HERE, for the user, and can never
 * carry upstream provider text. Adding a name is asserting exactly that.
 *
 *  - ApiKeyError (lib/keys/resolver.ts) — "You have no Meshy key configured".
 *  - PromptRejectedError (lib/game-creation/decomposer.ts) — our own
 *    safety-filter reason. Typed rather than prefix-matched, so an upstream
 *    error whose text happened to start "Prompt rejected:" cannot claim it.
 *  - EmptyArtifactError (lib/generate/emptyArtifactError.ts — which is the path
 *    createGenerationHandler imports it from; an earlier version of this line
 *    cited lib/api/errors.ts, where the class does not appear at all, so a
 *    reviewer following the citation to check the assertion arrived at the
 *    wrong file) — COMPOSES its message from two static nouns (the generation
 *    type and the artifact), so no provider text can reach a client through it.
 *
 * Only the properties in `clientSafeProperties` (message, code, status,
 * statusCode, reason, name) are exempt, and only inside the narrowed branch.
 * Passing the narrowed error WHOLE is still reported: the justification is that
 * the MESSAGE is ours, and it does not extend to `err.cause.body`.
 */
export const CLIENT_SAFE_ERRORS = ['ApiKeyError', 'PromptRejectedError', 'EmptyArtifactError'];

/**
 * The response constructors that redact (`web/src/lib/api/errors.ts`). Any
 * other way of building a response is banned on the catch path, which is what
 * puts `redactSecrets` genuinely ON that path instead of adjacent to it.
 *
 * MATCHING IS BY NAME ONLY, which the rule cannot avoid without type
 * information — so `notFound`, `unauthorized` and `forbidden` imported from
 * `next/navigation` are allowlisted too. That is deliberate and harmless: those
 * three throw a framework control-flow signal and construct no body, so a
 * caught error cannot travel through them to a client. Stated because an
 * allowlist entry nobody has explained is how the previous glob's gap looked
 * from the outside.
 */
export const REDACTING_RESPONSE_HELPERS = [
  'apiError',
  'createErrorResponse',
  'redactedJson',
  'apiErrorResponse',
  'badRequest',
  'unauthorized',
  'paymentRequired',
  'forbidden',
  'notFound',
  'conflict',
  'validationError',
  'internalError',
  'serviceUnavailable',
];

/**
 * The ALLOWLIST of terminal sinks the caught error may reach. It lives outside
 * the rule so a reviewer can audit what is permitted to consume an error
 * without reading the rule's implementation.
 *
 * The rule's model is that a caught error may go to our telemetry, our logs, or
 * back up the stack — and nowhere else. Everything not on this list is reported
 * wherever the value crosses OUT of the catch scope, which is what makes the
 * gate independent of the (open-ended) set of sinks somebody might invent.
 */
export const CATCH_ERROR_SINKS = [
  'captureException',        // lib/monitoring/sentry.ts
  'captureMessage',
  'sampledCaptureException', // lib/monitoring/sampledCapture.ts
  'captureGenerationError',
  'reportError',
  // lib/security/egressGuard.ts. Its ENTIRE body is a `console.error` plus
  // `captureException`, both already on this list, wrapped in a try/catch so the
  // reporter cannot throw. It constructs no response and returns void, so a
  // caught error reaching it cannot reach a client — which is the property this
  // list encodes. Named here rather than exempted at the call site so the
  // justification is auditable next to the other sinks.
  'reportGuardFailure',
  'Promise.reject',          // a rethrow, not an egress
];

/** Receivers whose every method is a log sink. */
// `reqLog`/`log` are the two names this repo binds `logger.child(...)` to.
export const CATCH_LOGGER_OBJECTS = [
  'console', 'logger', 'log', 'reqLog', 'Sentry', 'sentry', 'sentryLogger',
];

/** The exact options object the flat config wires the rule with. */
export const RULE_OPTIONS = {
  clientSafeErrors: CLIENT_SAFE_ERRORS,
  responseHelpers: REDACTING_RESPONSE_HELPERS,
  errorSinks: CATCH_ERROR_SINKS,
  loggerObjects: CATCH_LOGGER_OBJECTS,
};
