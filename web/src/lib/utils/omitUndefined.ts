/**
 * Remove keys whose value is exactly `undefined` from a shallow copy of `obj`.
 * Keys that were never present are untouched (there is nothing to remove).
 *
 * Why this exists: spreading a patch over an existing record
 * (`{ ...existing, ...patch }`) lets an own key whose value is `undefined`
 * ERASE the stored value. Two sources produce such keys:
 *
 * - zod. A `.optional()` field types as `T | undefined` in the parser's output.
 *   An ABSENT input key stays absent (`'a' in schema.parse({})` is `false`),
 *   but an input key that is present with the value `undefined` SURVIVES the
 *   parse as an own key: with zod 4.6.5,
 *   `Object.hasOwn(z.object({ a: z.number().optional() }).parse({ a: undefined }), 'a')`
 *   is `true`. JSON cannot carry `undefined`, but an in-process caller can.
 * - A type that admits `undefined` (`prop?: T | undefined`), whose patches
 *   can carry the key wherever a caller forwards a maybe-undefined value.
 *
 * This helper strips those keys at RUNTIME, so the merge keeps the stored
 * value, and its result type drops `undefined` from every field, so the
 * merge also satisfies `exactOptionalPropertyTypes` against a target whose
 * fields do not admit it. Use it only where `undefined` is NOT meant to clear
 * the field.
 */
export function omitUndefinedValues<T extends object>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  // Object.fromEntries, not `result[key] = value`: it defines own data
  // properties, so an own `__proto__` key (JSON.parse produces one) stays an
  // ordinary key instead of hitting the prototype setter and grafting its value
  // onto the result's prototype chain, where a later `{ ...existing, ...out }`
  // read of an absent field would find it.
  const result = Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
  return result as { [K in keyof T]: Exclude<T[K], undefined> };
}
