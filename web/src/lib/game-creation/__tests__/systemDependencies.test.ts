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
});

describe('formatDependencyCycle', () => {
  it('joins the path with arrows, matching the message buildPlan has always thrown', () => {
    expect(formatDependencyCycle(['movement', 'camera', 'movement'])).toBe('movement -> camera -> movement');
  });
});
