/**
 * Look up a key in a plain-object map, ignoring anything inherited.
 *
 * `map[id]` walks the prototype chain, so an `id` of `__proto__`, `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty` or `isPrototypeOf` resolves to
 * something off `Object.prototype` — and every one of those is TRUTHY. That is
 * what makes this dangerous rather than merely wrong: the universal guard in
 * this codebase is
 *
 *     const thing = map[id];
 *     if (!thing) return notFound;
 *
 * and a prototype-named id walks straight through it. The code then reads a
 * field the prototype does not have (`thing.nodes`, `thing.tracks`) and throws —
 * or, worse, does not throw and reports success while handing a caller
 * `Object.prototype` dressed up as a domain object.
 *
 * The ids reaching these maps are not developer-authored. They arrive from AI
 * tool arguments (validated as `z.string().min(1)`, which accepts `__proto__`
 * happily), from `forge.dialogue.*` calls in user scripts running in the Web
 * Worker sandbox, and from cutscenes loaded out of a saved project. So "no
 * caller would ever pass that" is not a property this code has.
 *
 * Returning `undefined` — never `Object.prototype` — is what makes the existing
 * `if (!thing)` guards correct as written, so call sites keep their shape.
 *
 * A key that is genuinely present as an OWN property is returned normally, so a
 * user who really does name a dialogue tree `__proto__` still finds it. This
 * rejects inherited lookups, not unusual names.
 */
export function lookupOwn<T>(
  map: Record<string, T> | undefined | null,
  key: string | null | undefined,
): T | undefined {
  if (map === undefined || map === null) return undefined;
  if (typeof key !== 'string') return undefined;
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/**
 * Whether a map holds this key as its own — the membership half of `lookupOwn`.
 *
 * Separate from `lookupOwn` because a call site testing existence should not
 * have to care that a stored `undefined` and an absent key look the same
 * through the value-returning form.
 */
export function hasOwnKey(
  map: Record<string, unknown> | undefined | null,
  key: string | null | undefined,
): boolean {
  if (map === undefined || map === null) return false;
  if (typeof key !== 'string') return false;
  return Object.hasOwn(map, key);
}
