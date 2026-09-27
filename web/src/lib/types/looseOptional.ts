/**
 * Like `Partial<T>`, but each field explicitly admits `undefined` too.
 *
 * Under `exactOptionalPropertyTypes`, `Partial<T>` turns `k: X` into `k?: X`
 * — present-with-a-value or absent, but never present-with-`undefined`. A
 * caller that builds a patch object field-by-field (e.g. from a zod
 * `.optional()` schema, or a conditional expression that can itself yield
 * `undefined`) produces exactly that third shape at the type level, even when
 * the value never reaches that shape at runtime. Reach for this instead of
 * `Partial<T>` wherever the function already treats "key present with
 * `undefined`" the same as "key absent" (an explicit `!== undefined` guard,
 * `??`, or a `Object.hasOwn` + `!== undefined` pair, as `buildPhysicsPatch`
 * does) — it is never correct for a target that does a bare
 * `{ ...existing, ...patch }` spread, where an explicit `undefined` would
 * overwrite a real value.
 */
export type LoosePartial<T> = { [K in keyof T]?: T[K] | undefined };
