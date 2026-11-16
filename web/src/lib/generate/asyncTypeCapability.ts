/**
 * The async generation types and the `DB_PROVIDER` capability each one polls.
 *
 * A LEAF module on purpose: `pollProviderStatus.ts` re-exports these and also
 * imports the Meshy and Replicate clients, so anything that only needs the
 * type→capability map (`POST /api/jobs` deriving the ownership provider
 * server-side, #10262) imports from here rather than dragging the provider
 * clients into its bundle.
 *
 * `pixel-art` is intentionally EXCLUDED: it has no member in the
 * `generation_type` DB enum (its route asserts `type: 'pixel-art'` → 400), so
 * there is no `generation_jobs` row for a durable callback to finalize. Adding
 * it here would force an enum migration for zero benefit — pixel-art stays on
 * the client-poll path. Any new value added to this union MUST also (1) have a
 * `generation_type` enum member, (2) map in `ASYNC_TYPE_TO_DB_CAPABILITY`
 * below, and (3) be exercised by the parity test.
 */
export type AsyncGenerationType =
  | 'model'
  | 'texture'
  | 'skybox'
  | 'music'
  | 'sprite'
  | 'sprite_sheet'
  | 'tileset';

/** Provider-capability key (in DB_PROVIDER) used to resolve the poll key. */
export type DbCapabilityForType = 'model3d' | 'texture' | 'music' | 'sprite';

/**
 * Maps each async type to the `DB_PROVIDER` capability whose key the callback
 * must resolve to poll the provider. Skybox reuses the texture provider
 * (Meshy); all sprite variants use the sprite provider (Replicate).
 */
export const ASYNC_TYPE_TO_DB_CAPABILITY: Record<AsyncGenerationType, DbCapabilityForType> = {
  model: 'model3d',
  texture: 'texture',
  skybox: 'texture',
  music: 'music',
  sprite: 'sprite',
  sprite_sheet: 'sprite',
  tileset: 'sprite',
};

/**
 * The capability a `generation_type` value polls, or `null` for a type that
 * never produces a pollable provider job (`sfx`, `voice`: synchronous, no
 * status route resolves a key for them, so no ownership binding is ever
 * written for them either).
 */
export function asyncCapabilityForType(type: string): DbCapabilityForType | null {
  return Object.prototype.hasOwnProperty.call(ASYNC_TYPE_TO_DB_CAPABILITY, type)
    ? ASYNC_TYPE_TO_DB_CAPABILITY[type as AsyncGenerationType]
    : null;
}
