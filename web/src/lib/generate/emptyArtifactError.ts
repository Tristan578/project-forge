/**
 * Thrown when a generation provider reports success but hands back no usable
 * artifact — an HTTP 200 with a missing prediction id, an empty `b64_json`, an
 * `{}` texture map, a null audio URL.
 *
 * This is its own error type because `createGenerationHandler` funnels every
 * `execute` throw into an opaque `GENERIC_500_MESSAGE`: raw `err.message` can
 * carry env-var names and connection strings (#8597), so the generic message is
 * the correct default. The message here is safe to show because it is
 * CONSTRUCTED, not passed through — the caller supplies two nouns and the class
 * composes the sentence. Provider text can never reach the client through it.
 *
 * `gotchas.md` → API & Security: a provider-success-with-no-artifact must be
 * reported as a failure with a message naming the missing artifact, never as a
 * `completed` job. Mapping it to 503 rather than 500 also puts it in the
 * `provider_unavailable` metrics bucket, which is what it actually is.
 *
 * Both arguments MUST be static literals authored in our code. Never
 * interpolate a provider response into either one.
 */
export class EmptyArtifactError extends Error {
  constructor(
    /** What was being generated, capitalised: `'Pixel art'`, `'Texture'`. */
    readonly generationType: string,
    /** The artifact that never arrived: `'image'`, `'texture maps'`, `'audio'`. */
    readonly artifact: string
  ) {
    super(`${generationType} generation produced no ${artifact}`);
    this.name = 'EmptyArtifactError';
  }
}
