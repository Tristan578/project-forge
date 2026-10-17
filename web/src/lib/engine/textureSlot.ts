/**
 * Which texture slot an image applied to an entity goes to when the caller
 * named none (#10399).
 *
 * A 2D sprite renders from its SpriteData, not from a material, and the
 * engine's texture drain (`apply_texture_load`) applies the `sprite` slot to
 * it. `base_color` aimed at a sprite entity found no material, changed
 * nothing, and was reported as applied. Anything else keeps the material's
 * base colour.
 *
 * The one owner of that rule: the Asset panel's import and drop and the
 * generation poller all ask it, so they cannot disagree about which entities
 * are sprites. The pixel art editor and the Sprite inspector send `sprite`
 * directly, because they only ever open for a sprite.
 */

/** The slots a caller with no slot of its own sends. */
export type DefaultTextureSlot = 'sprite' | 'base_color';

/**
 * @param entityId The entity the image is applied to, if any.
 * @param sprites The store's per-entity sprite data (`sprites`); an entry
 *   means the entity is a 2D sprite.
 * @returns `sprite` for a 2D sprite, `base_color` otherwise.
 */
export function defaultTextureSlot(
  entityId: string | null | undefined,
  sprites: Readonly<Record<string, unknown>>,
): DefaultTextureSlot {
  return entityId && sprites[entityId] !== undefined ? 'sprite' : 'base_color';
}
