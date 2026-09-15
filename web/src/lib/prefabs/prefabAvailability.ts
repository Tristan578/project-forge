/**
 * Availability of linked prefab editing. The data model is persisted, but
 * transactional engine placement and propagation are still tracked in #9811.
 */

/** Compatibility commands withheld from model tool sets until engine integration ships. */
export const UNAVAILABLE_LINKED_PREFAB_COMMANDS: ReadonlySet<string> = new Set([
  'create_prefab_instance',
  'nest_prefab',
  'apply_prefab_to_instances',
]);

/** Explain the unavailable linked workflow and point to the existing flat-copy command. */
export const LINKED_PREFAB_UNAVAILABLE_REASON =
  'Linked prefab placement, nesting, and propagation are not available yet. Use instantiate_prefab for an independent flat copy.';
