/**
 * Tests for the shared `dependsOn` cycle detector (#10174).
 *
 * One function, two callers: `buildPlan` throws on the cycle it reports, and
 * `validateBrief` reports it as a `DEPENDENCY_CYCLE` issue. The graph rules
 * here are the ones `topoSortSystems` has always used — the node is the
 * CATEGORY, every system in a category contributes its edges, and an edge to a
 * category no system declares is ignored rather than treated as missing.
 */

import { describe, it, expect } from 'vitest';
import type { GameSystem, SystemCategory } from '../types';
import { findSystemDependencyCycle, formatDependencyCycle } from '../systemDependencies';

function sys(category: SystemCategory, dependsOn: SystemCategory[] = []): GameSystem {
  return { category, type: `${category}-type`, config: {}, priority: 'core', dependsOn };
}

describe('findSystemDependencyCycle', () => {
  it('returns null for an acyclic graph, including a diamond', () => {
    expect(findSystemDependencyCycle([])).toBeNull();
    expect(findSystemDependencyCycle([sys('movement', ['physics']), sys('physics')])).toBeNull();
    expect(
      findSystemDependencyCycle([
        sys('feedback', ['challenge']),
        sys('challenge', ['entities']),
        sys('progression', ['entities']),
        sys('entities'),
      ]),
    ).toBeNull();
  });

  it('ignores an edge to a category no system declares', () => {
    // `topoSortSystems` only follows `dependsOn` entries that resolve to a
    // declared category; the fixtures lean on this (movement -> physics with
    // no physics system). Treating it as a cycle or an error would reject
    // every one of them.
    expect(findSystemDependencyCycle([sys('movement', ['physics'])])).toBeNull();
  });

  it('reports a two-node cycle as a closed path', () => {
    const cycle = findSystemDependencyCycle([sys('movement', ['camera']), sys('camera', ['movement'])]);
    expect(cycle).toEqual(['movement', 'camera', 'movement']);
  });

  it('reports a self-dependency as a one-step closed path', () => {
    expect(findSystemDependencyCycle([sys('world', ['world'])])).toEqual(['world', 'world']);
  });

  it('reports a three-node cycle naming every category in it', () => {
    const cycle = findSystemDependencyCycle([
      sys('movement', ['camera']),
      sys('camera', ['world']),
      sys('world', ['movement']),
    ]);
    expect(cycle).toEqual(['movement', 'camera', 'world', 'movement']);
  });

  it('finds a cycle contributed by the SECOND system in a shared category', () => {
    // Several systems share a category (walk + swim are both `movement`). The
    // category node carries every system's edges, so a cycle introduced by the
    // second one must be seen too; keying the walk by system rather than by
    // category would miss it.
    const cycle = findSystemDependencyCycle([
      sys('movement', ['physics']),
      sys('movement', ['camera']),
      sys('camera', ['movement']),
      sys('physics'),
    ]);
    expect(cycle).toEqual(['movement', 'camera', 'movement']);
  });

  it('does not depend on a cycle being reachable from the first system', () => {
    const cycle = findSystemDependencyCycle([
      sys('world'),
      sys('audio', ['visual']),
      sys('visual', ['audio']),
    ]);
    expect(cycle).toEqual(['audio', 'visual', 'audio']);
  });

  it('handles a million-entry dependsOn on a shared category without throwing', () => {
    // Two systems in one category merge their edges into one bucket. That
    // merge used to be `bucket.push(...dependsOn)`, and a spread into an
    // argument list is bounded by the call stack: a RangeError at ~150k
    // entries on Node's main thread, and at ~800k under vitest's worker
    // threads, which get a bigger stack — hence a million here, so the test
    // is red in both. The provider shape puts no cap on `dependsOn`, so the
    // decomposer's re-validation reached this with whatever the model (or a
    // mocked seam) returned, and `validateBrief`'s try/catch did not cover it.
    const huge = new Array<SystemCategory>(1_000_000).fill('physics');
    const systems = [sys('movement', ['camera']), sys('movement', huge), sys('camera', ['movement'])];

    let cycle: SystemCategory[] | null = null;
    expect(() => {
      cycle = findSystemDependencyCycle(systems);
    }).not.toThrow();
    // And the merge still happened: the second movement system's edges are
    // in the graph, and so is the cycle the first one introduces.
    expect(cycle).toEqual(['movement', 'camera', 'movement']);
  });
});

describe('formatDependencyCycle', () => {
  it('joins the path with arrows, matching the message buildPlan has always thrown', () => {
    expect(formatDependencyCycle(['movement', 'camera', 'movement'])).toBe('movement -> camera -> movement');
  });
});
