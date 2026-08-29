/**
 * Deterministic fixtures for the product benchmark suite.
 *
 * Every builder here is a PURE, seeded generator: given the same size argument
 * it produces byte-identical data on every run and every machine. That matters
 * because the benchmark comparator (scripts/run-benchmarks.sh) diffs timings
 * against a committed baseline — if the *input* varied run to run, a timing
 * delta would be indistinguishable from a workload delta.
 *
 * These builders live under __tests__/ so they are excluded from coverage
 * instrumentation (see the `src/**\/__tests__/**` coverage exclude in
 * vitest.config.ts). They are NOT product code and must never be imported by
 * product code.
 */

import type { SceneGraph, SceneNode } from '@/stores/slices/types';
import type { SceneSnapshot } from '@/lib/engine/deltaSerializer';
import type { VisualScriptGraph } from '@/lib/scripting/visualScriptTypes';

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// ---------------------------------------------------------------------------

/**
 * Small, fast, fully deterministic 32-bit PRNG. Used instead of Math.random()
 * so fixtures are reproducible across runs, machines, and CI runners.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Component names sampled into fixture entities — mirrors real editor scenes. */
const COMPONENT_POOL = [
  'Transform',
  'Mesh3d',
  'MeshMaterial3d',
  'Sprite',
  'PointLight',
  'DirectionalLight',
  'SpotLight',
  'TerrainEnabled',
  'Physics3dEnabled',
  'ScriptData',
] as const;

/** Name stems sampled into fixture entities — drives the hierarchy filter. */
const NAME_POOL = [
  'Cube',
  'Sphere',
  'Platform',
  'Enemy',
  'Coin',
  'Torch',
  'Wall',
  'Spawner',
  'Camera',
  'Trigger',
] as const;

// ---------------------------------------------------------------------------
// Scene graph
// ---------------------------------------------------------------------------

/**
 * Build a deterministic SceneGraph of exactly `count` nodes.
 *
 * Roughly 30% of nodes are roots; the rest are parented to an earlier node,
 * producing chains several levels deep. Depth matters: `filterHierarchy` walks
 * the ancestor chain of every match, so a flat graph would under-measure it.
 */
export function makeSceneGraph(count: number, seed = 0x5f0a9e): SceneGraph {
  const rand = mulberry32(seed);
  const nodes: Record<string, SceneNode> = {};
  const rootIds: string[] = [];
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const id = `e${i}`;
    ids.push(id);

    // Parent selection: first node is always a root so the chain has an anchor.
    let parentId: string | null = null;
    if (i > 0 && rand() > 0.3) {
      parentId = ids[Math.floor(rand() * i)];
    }

    // 1-3 components per entity, sampled deterministically.
    const componentCount = 1 + Math.floor(rand() * 3);
    const components: string[] = [];
    for (let c = 0; c < componentCount; c++) {
      const comp = COMPONENT_POOL[Math.floor(rand() * COMPONENT_POOL.length)];
      if (!components.includes(comp)) components.push(comp);
    }

    nodes[id] = {
      entityId: id,
      name: `${NAME_POOL[Math.floor(rand() * NAME_POOL.length)]}_${i}`,
      parentId,
      children: [],
      components,
      visible: true,
    };

    if (parentId === null) {
      rootIds.push(id);
    } else {
      nodes[parentId].children.push(id);
    }
  }

  return { nodes, rootIds };
}

// ---------------------------------------------------------------------------
// Play-tick scene snapshot (delta serializer input)
// ---------------------------------------------------------------------------

/**
 * Build a deterministic play-tick snapshot: entityId -> componentName -> value.
 * Component values are the nested arrays/objects the real engine sends, so the
 * serializer's JSON-based deep clone and structural diff do representative work.
 */
export function makeSceneSnapshot(count: number, seed = 0x2c91b3): SceneSnapshot {
  const rand = mulberry32(seed);
  const snapshot: SceneSnapshot = {};

  for (let i = 0; i < count; i++) {
    snapshot[`e${i}`] = {
      Transform: {
        position: [rand() * 100, rand() * 100, rand() * 100],
        rotation: [rand(), rand(), rand(), rand()],
        scale: [1, 1, 1],
      },
      Velocity: { linear: [rand(), rand(), rand()], angular: [0, 0, 0] },
      Health: { current: Math.floor(rand() * 100), max: 100 },
      Visible: rand() > 0.1,
    };
  }

  return snapshot;
}

/**
 * Return a copy of `snapshot` with `changedFraction` of its entities mutated.
 * Models one play frame: most entities are static, a minority moved.
 */
export function mutateSnapshot(
  snapshot: SceneSnapshot,
  changedFraction: number,
  seed = 0x7ab4d1,
): SceneSnapshot {
  const rand = mulberry32(seed);
  const next: SceneSnapshot = {};

  for (const [id, components] of Object.entries(snapshot)) {
    if (rand() < changedFraction) {
      next[id] = {
        ...components,
        Transform: {
          position: [rand() * 100, rand() * 100, rand() * 100],
          rotation: [rand(), rand(), rand(), rand()],
          scale: [1, 1, 1],
        },
      };
    } else {
      next[id] = components;
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Visual script graph (compiler input)
// ---------------------------------------------------------------------------

/**
 * Build a deterministic visual-script graph with `handlers` event entry points,
 * each driving a linear chain of `chainLength` action nodes.
 *
 * Node types are real `nodeDefinitions` types the compiler recognises, so the
 * measured work is genuine code generation, not error-path bailouts.
 */
export function makeVisualScriptGraph(
  handlers: number,
  chainLength: number,
): VisualScriptGraph {
  const eventTypes = ['OnStart', 'OnUpdate', 'OnCollisionEnter', 'OnKeyPress'];
  const actionTypes = ['Translate', 'SetPosition', 'ApplyImpulse', 'SetVariable'];

  const nodes: VisualScriptGraph['nodes'] = [];
  const edges: VisualScriptGraph['edges'] = [];

  for (let h = 0; h < handlers; h++) {
    const eventId = `evt${h}`;
    nodes.push({
      id: eventId,
      type: eventTypes[h % eventTypes.length],
      position: { x: 0, y: h * 300 },
      data: { key: 'Space' },
    });

    let prevId = eventId;
    for (let c = 0; c < chainLength; c++) {
      const nodeId = `n${h}_${c}`;
      const type = actionTypes[c % actionTypes.length];
      nodes.push({
        id: nodeId,
        type,
        position: { x: 200 * (c + 1), y: h * 300 },
        data: {
          entity: 'entityId',
          position: '[0, 5, 0]',
          dx: 0,
          dy: 0,
          dz: 1,
          fx: 0,
          fy: 10,
          fz: 0,
          key: `flag_${h}_${c}`,
          value: c,
        },
      });
      edges.push({
        id: `e${h}_${c}`,
        source: prevId,
        sourceHandle: 'exec_out',
        target: nodeId,
        targetHandle: 'exec_in',
      });
      prevId = nodeId;
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// .forge scene file (deserialize / migrate input)
// ---------------------------------------------------------------------------

/**
 * Build a deterministic v1 `.forge` scene document containing `count` entities.
 *
 * Returned as a JSON *string* because the product path being measured starts at
 * `JSON.parse` (see `sceneFile.ts` — readSceneFile → JSON.parse → migrateScene),
 * and parse cost dominates the migration for realistic scene sizes.
 */
export function makeForgeSceneV1Json(count: number, seed = 0x91d3f7): string {
  const rand = mulberry32(seed);
  const entities = [];

  for (let i = 0; i < count; i++) {
    entities.push({
      id: `e${i}`,
      name: `${NAME_POOL[i % NAME_POOL.length]}_${i}`,
      transform: {
        position: [rand() * 50, rand() * 50, rand() * 50],
        rotation: [0, rand() * Math.PI, 0],
        scale: [1, 1, 1],
      },
      components: {
        Mesh3d: { handle: `mesh_${i % 12}` },
        MeshMaterial3d: {
          baseColor: [rand(), rand(), rand(), 1],
          metallic: rand(),
          roughness: rand(),
        },
      },
      children: [],
    });
  }

  return JSON.stringify({
    formatVersion: 1,
    name: 'benchmark-scene',
    entities,
  });
}
