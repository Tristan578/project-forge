/**
 * Remove keys whose value is exactly `undefined` from a shallow copy of `obj`.
 * Keys that were never present are untouched (there is nothing to remove).
 *
 * Why this exists: a zod `.optional()` field types as `T | undefined` in the
 * parser's *output* type, even though zod itself omits the key entirely when
 * the input didn't supply it (verified: `'a' in schema.parse({})` is `false`
 * for `z.object({ a: z.string().optional() })`). Spreading such a parsed
 * object directly over an existing full record (`{ ...existing, ...parsed }`)
 * is therefore safe at runtime, but under `exactOptionalPropertyTypes` the
 * *type* of the spread — which must account for the type-level possibility of
 * an explicit `undefined` — no longer satisfies a target type whose fields
 * don't admit `undefined`. This closes that gap explicitly, so the merge is
 * safe by both the type checker and the same guarantee zod already gives.
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
