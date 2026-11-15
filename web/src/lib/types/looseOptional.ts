/**
 * Like `Partial<T>`, but each field explicitly admits `undefined` too.
 *
 * Under `exactOptionalPropertyTypes`, `Partial<T>` turns `k: X` into `k?: X`
 * — present-with-a-value or absent, but never present-with-`undefined`. A
 * caller that builds a patch object field-by-field (e.g. from a zod
 * `.optional()` schema, or a conditional expression that can itself yield
 * `undefined`) produces exactly that third shape at the type level, and can
 * produce it at runtime too (zod keeps an input key that is present with
 * `undefined`). Reach for this instead of `Partial<T>` wherever the function
 * already treats "key present with `undefined`" the same as "key absent" (an
 * explicit `!== undefined` guard, `??`, or a `Object.hasOwn` + `!== undefined`
 * pair, as `buildPhysicsPatch` does), or spreads the patch into a FRESH
 * command payload with no stored state under it (`spawnTerrain` →
 * `spawn_terrain`). It is never correct for a patch that is bare-spread over
 * EXISTING state (`{ ...existing, ...patch }`), where an explicit `undefined`
 * would overwrite a real value. Policy: `.claude/rules/web-quality.md`.
 */
export type LoosePartial<T> = { [K in keyof T]?: T[K] | undefined };
