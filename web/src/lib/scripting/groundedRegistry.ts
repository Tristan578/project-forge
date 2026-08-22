/**
 * The browser's mirror of each kinematic character's ground contact (PF-1214).
 *
 * The engine decides `grounded` inside Rapier's character sweep, which nothing
 * on this side can see: the play-tick wire carries transforms, not contact
 * state. So the bridge emits `CHARACTER_GROUNDED_CHANGED` — changes only, never
 * a per-frame flood — and this module holds the running result so
 * `forge.physics.isGrounded()` can answer synchronously inside a script tick.
 *
 * Deliberately a plain module singleton rather than a store slice: this is
 * per-frame runtime state consumed only by the script sandbox, and routing it
 * through Zustand would re-render the whole editor on every landing.
 */

/**
 * A `Map`, not an object, because the key arrives straight off the engine wire.
 * `states['constructor']` on a plain object is an inherited function — truthy —
 * so a script could stand on a prototype.
 */
const groundedByEntity = new Map<string, boolean>();

/** Record one character's ground contact, as reported by the engine. */
export function setCharacterGrounded(entityId: string, grounded: boolean): void {
  groundedByEntity.set(entityId, grounded);
}

/**
 * Whether the engine last reported this character as standing on something.
 *
 * An entity with no entry answers `false`. The engine only emits changes, so
 * "never heard of" is the normal state for everything that is not a kinematic
 * character — and defaulting to `true` would let a script jump off thin air.
 */
export function isCharacterGrounded(entityId: string): boolean {
  return groundedByEntity.get(entityId) === true;
}

/**
 * A snapshot for the worker wire.
 *
 * `Object.fromEntries` creates own data properties, so an entity literally
 * named `__proto__` survives as data instead of silently mutating a prototype
 * the way `obj[key] = value` would.
 */
export function getGroundedStates(): Record<string, boolean> {
  return Object.fromEntries(groundedByEntity);
}

/**
 * Drop everything. Called when play stops: a restarted game must not inherit a
 * stale `true` from the previous session's last frame.
 */
export function clearGroundedStates(): void {
  groundedByEntity.clear();
}
