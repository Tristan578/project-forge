import { showError } from '@/lib/toast';
import type { EntityType } from './AddEntityMenu';

/**
 * Spawn an entity from a toolbar and tell the user when it did not happen.
 *
 * `spawnEntity` returns `undefined` when nothing was dispatched — the engine has
 * not finished loading. Both toolbars used to discard that return value, which
 * made a dead Add Entity menu indistinguishable from a working one: the menu
 * closed, no entity appeared, and nothing said why. The condition is real and
 * routine (the menu renders before the WASM engine resolves), not a
 * can't-happen branch.
 */
export function spawnEntityWithFeedback(
  spawnEntity: (type: EntityType, name?: string) => string | undefined,
  type: EntityType,
): string | undefined {
  const entityId = spawnEntity(type);
  if (!entityId) {
    showError(`Could not add ${type.replace(/_/g, ' ')} — the engine is still loading. Try again in a moment.`);
  }
  return entityId;
}
