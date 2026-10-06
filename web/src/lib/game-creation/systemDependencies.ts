/**
 * The ONE detector for a cyclic `dependsOn` graph among a brief's systems
 * (#10174).
 *
 * Two callers share it on purpose:
 *
 *   - `planBuilder.ts` `topoSortSystems` throws on the cycle it reports. A
 *     cyclic graph is a build-time error that must fail loudly, never hang and
 *     never silently drop a step to break the cycle.
 *   - `briefSchema.ts` `validateBrief` reports the same cycle as a
 *     `DEPENDENCY_CYCLE` issue on the exact `dependsOn` entry that closes it,
 *     so the manual editor and the AI path agree on what a cycle is.
 *
 * The detector used to live inline in the plan builder's depth-first walk.
 * Copying it into the validator would have produced the second drifting copy
 * this directory's shared modules exist to prevent (see `rules/file-map.md`),
 * so it was factored out instead and both callers import it.
 *
 * Graph rules, unchanged from the inline version:
 *
 *   - The node is the CATEGORY. Several systems routinely share one (walk and
 *     swim are both `movement`), and every system in a category contributes
 *     its edges, so a cycle introduced by the second system in a category is
 *     found too.
 *   - An edge to a category that no system declares is ignored. The fixtures
 *     lean on this (`movement` depending on `physics` with no physics system),
 *     and the plan builder has never treated it as an error.
 *   - Systems are visited in array order, so the reported path is
 *     deterministic for a given brief.
 */

import type { SystemCategory } from './types';

/** The two fields the detector reads; both `GameSystem` and a brief system satisfy it. */
export interface DependencyNode {
  readonly category: SystemCategory;
  readonly dependsOn: readonly SystemCategory[];
}

/**
 * Find the first `dependsOn` cycle among `systems`.
 *
 * @returns The cycle as a closed path — the first category appears again at
 *   the end, so `['a', 'b', 'a']` is a two-node cycle and `['a', 'a']` a
 *   self-dependency — or `null` when the graph is acyclic.
 */
export function findSystemDependencyCycle(
  systems: readonly DependencyNode[],
): SystemCategory[] | null {
  // Adjacency by category. Indexed loop rather than a callback form: an array
  // hole would be skipped by `.forEach`, and a skipped system is a skipped
  // edge, which is a cycle this function would then fail to see.
  const edges = new Map<SystemCategory, SystemCategory[]>();
  for (let i = 0; i < systems.length; i += 1) {
    const system = systems[i];
    if (!system) continue;
    const bucket = edges.get(system.category);
    if (bucket) {
      bucket.push(...system.dependsOn);
    } else {
      edges.set(system.category, [...system.dependsOn]);
    }
  }

  const done = new Set<SystemCategory>();
  const stackPath: SystemCategory[] = [];
  const inStack = new Set<SystemCategory>();

  function visit(category: SystemCategory): SystemCategory[] | null {
    if (done.has(category)) return null;
    if (inStack.has(category)) {
      const start = stackPath.indexOf(category);
      return [...stackPath.slice(start), category];
    }
    const deps = edges.get(category);
    if (!deps) return null;

    stackPath.push(category);
    inStack.add(category);
    for (let i = 0; i < deps.length; i += 1) {
      const dep = deps[i];
      if (dep === undefined || !edges.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stackPath.pop();
    inStack.delete(category);
    done.add(category);
    return null;
  }

  for (let i = 0; i < systems.length; i += 1) {
    const system = systems[i];
    if (!system) continue;
    const cycle = visit(system.category);
    if (cycle) return cycle;
  }
  return null;
}

/** `movement -> camera -> movement`: the wording the plan builder's error has always used. */
export function formatDependencyCycle(cycle: readonly SystemCategory[]): string {
  return cycle.join(' -> ');
}
