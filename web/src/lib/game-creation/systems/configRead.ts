/**
 * Reading an LLM-authored `system.config` bag.
 *
 * Every system definition faces the same problem: the model returns the same
 * field under a handful of plausible names, in either of two spellings (a real
 * array or one comma-separated string), and occasionally with a member that is
 * not a string at all. Each definition used to solve that for itself, and by
 * the third copy the three had already drifted apart on which spellings they
 * accepted.
 *
 * Two properties here are load-bearing and easy to lose in a rewrite:
 *
 *  1. **`Object.hasOwn`, never a bare index.** `config['constructor']` resolves
 *     on the prototype chain and hands back a function, which would then be
 *     read as a design decision.
 *  2. **Indexed loops, never `.filter`/`.map`/`.some`.** A callback form skips
 *     array holes, so a sparse list reports itself fully processed while
 *     silently losing an entry — and `JSON.parse` readily produces the `null`
 *     that a hole degrades into on the first round trip.
 */

import type { PlannedEntity } from './registry';

/** LLM-authored names arrive in every casing and punctuation. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A list of entity names from the first of `keys` that carries one.
 *
 * Non-string members are ignored rather than coerced: `String({})` is
 * `"[object Object]"`, which resolves to nothing and would produce a warning
 * about a name nobody wrote.
 */
export function readNameList(config: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];

    if (typeof value === 'string') {
      const names: string[] = [];
      const parts = value.split(',');
      for (let i = 0; i < parts.length; i += 1) {
        const trimmed = parts[i]?.trim() ?? '';
        if (trimmed.length > 0) names.push(trimmed);
      }
      if (names.length > 0) return names;
      continue;
    }

    if (Array.isArray(value)) {
      const names: string[] = [];
      for (let i = 0; i < value.length; i += 1) {
        const member = value[i];
        if (typeof member !== 'string') continue;
        const trimmed = member.trim();
        if (trimmed.length > 0) names.push(trimmed);
      }
      if (names.length > 0) return names;
    }
  }
  return [];
}

/** A positive finite number from the first of `keys` that carries one. */
export function readPositiveNumber(
  config: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * A real boolean from the first of `keys` that carries one, or null.
 *
 * Distinguishing "absent" from "explicitly false" is what makes an opt-OUT
 * possible: a default-on behaviour has to be able to see that the design said
 * `false` rather than said nothing, and a plain `?? false` erases that.
 */
export function readOptionalBoolean(
  config: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    if (!Object.hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

/** Only a real boolean. A truthy string is not a design decision. */
export function readBoolean(config: Record<string, unknown>, keys: string[]): boolean {
  return readOptionalBoolean(config, keys) ?? false;
}

/** First entity wins a duplicated name — a later duplicate is a design error. */
export function indexByName(entities: PlannedEntity[]): Map<string, PlannedEntity> {
  const index = new Map<string, PlannedEntity>();
  for (const entity of entities) {
    const key = normalize(entity.entity.name);
    if (key.length === 0 || index.has(key)) continue;
    index.set(key, entity);
  }
  return index;
}

/**
 * Resolve authored names to planned entities, warning once per name that does
 * not resolve and once per name that resolves to something `exclude` refuses.
 *
 * Every definition that targets by name needs exactly this, and needs it to
 * warn rather than plan a step bound to a name: the engine matches on the
 * `EntityId` component and emits nothing when nothing matches, while
 * `dispatchCommand` returns void — so a step aimed at a name that does not
 * exist fails in complete silence.
 */
export function resolveNames(
  names: string[],
  entities: PlannedEntity[],
  warn: (message: string) => void,
  describe: (name: string) => string,
  exclude?: (entity: PlannedEntity, name: string) => string | null,
): PlannedEntity[] {
  const index = indexByName(entities);
  const resolved: PlannedEntity[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (typeof name !== 'string') continue;

    const match = index.get(normalize(name));
    if (!match) {
      warn(describe(name));
      continue;
    }

    const refusal = exclude?.(match, name) ?? null;
    if (refusal !== null) {
      warn(refusal);
      continue;
    }

    if (seen.has(match.entityId)) continue;
    seen.add(match.entityId);
    resolved.push(match);
  }

  return resolved;
}
