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
 * interpolate a provider response into either one. The two unions below are how
 * that is enforced rather than merely asked for: a `string` parameter accepts a
 * provider field just as happily as a literal, and it also let the message
 * catalogue drift — a test constructed `('Texture', 'texture maps')` and got
 * `"Texture generation produced no texture maps"`, while the texture status
 * route has always said `"…produced no maps"`. Same condition, two sentences,
 * neither one wrong enough to notice.
 */

/**
 * What was being generated, capitalised. One entry per generating surface.
 *
 * A runtime array rather than a bare union so `__tests__/emptyArtifactError.test.ts`
 * can iterate it against the sentences the `*／status` routes and
 * `pollProviderStatus` already ship — the drift this file exists to stop is only
 * visible by comparing the two catalogues, which a compile-time-only type can't do.
 */
export const GENERATION_TYPE_LABELS = [
  'Pixel art',
  'Sprite',
  'Sprite sheet',
  'Tileset',
  'Texture',
  'Skybox',
  'Model',
  'Music',
] as const;

export type GenerationTypeLabel = (typeof GENERATION_TYPE_LABELS)[number];

/**
 * The artifact that never arrived. Deliberately short: these are the exact nouns
 * the `*／status` routes already use, so the two paths to the same failure
 * (submit-time throw, poll-time empty result) read identically to the user.
 */
export const ARTIFACT_LABELS = ['image', 'maps', 'audio', 'file'] as const;

export type ArtifactLabel = (typeof ARTIFACT_LABELS)[number];

export class EmptyArtifactError extends Error {
  constructor(
    readonly generationType: GenerationTypeLabel,
    readonly artifact: ArtifactLabel
  ) {
    super(`${generationType} generation produced no ${artifact}`);
    this.name = 'EmptyArtifactError';
  }
}
