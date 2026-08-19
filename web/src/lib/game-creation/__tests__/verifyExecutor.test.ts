/**
 * Tests for the verify_all_scenes executor, reached through EXECUTOR_REGISTRY.
 * Scope: the STRUCTURAL heuristics (empty scene, camera, light, ground plane).
 *
 * Winnability — the check the step now actually fails on — is covered by the
 * canonical suite at `executors/__tests__/verifyExecutor.test.ts`, which
 * imports the executor directly.
 *
 * CORRECTION (PF-1199): every fixture here used to omit `allGameComponents`
 * entirely, and the suite still asserted `success === true` — i.e. it asserted
 * that a scene with no win condition verifies clean. That is precisely the
 * claim the executor had no evidence for and which `gameSlice.play()` refuses.
 * The shared store fixture now carries a genuinely winnable component set, so
 * these tests isolate the cosmetic heuristic they were written for instead of
 * silently depending on winnability never being checked. No assertion was
 * relaxed: this makes the fixtures honest, it does not lower the bar.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutorContext } from '../types';
import type { EditorState } from '@/stores/editorStore';
import type { GameComponentData, SceneNode } from '@/stores/slices/types';
import { EXECUTOR_REGISTRY } from '../executors/index';

/**
 * The smallest component set `validateWinnability` accepts, and deliberately
 * one that does not depend on any scene node: a "reach score" win is
 * satisfiable on its own, so the empty-scene fixture below still exercises the
 * `empty_scene` heuristic rather than tripping the winnability gate first.
 */
const WINNABLE_COMPONENTS: Record<string, GameComponentData[]> = {
  player: [
    {
      // `CharacterControllerData` is exactly these four fields — an invented
      // wider shape needs an `as` to compile and then proves nothing.
      type: 'characterController',
      characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
    },
    {
      type: 'winCondition',
      winCondition: {
        conditionType: 'score',
        targetScore: 100,
        targetEntityId: null,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<SceneNode> & { entityId: string; name: string }): SceneNode {
  return {
    parentId: null,
    children: [],
    components: [],
    visible: true,
    ...overrides,
  };
}

function makeMockStore(nodes: SceneNode[], physicsOverrides: Record<string, unknown> = {}): EditorState {
  const nodesRecord: Record<string, SceneNode> = {};
  for (const node of nodes) {
    nodesRecord[node.entityId] = node;
  }
  return {
    sceneGraph: {
      nodes: nodesRecord,
      rootIds: nodes.map(n => n.entityId),
    },
    allGameComponents: WINNABLE_COMPONENTS,
    primaryPhysics: null,
    physicsEnabled: false,
    debugPhysics: false,
    ...physicsOverrides,
  } as unknown as EditorState;
}

function makeMockCtx(
  nodes: SceneNode[],
  physicsOverrides: Record<string, unknown> = {},
  projectType: '2d' | '3d' = '3d',
): ExecutorContext {
  // Closed over, not stored on the context: executors read the store through
  // `getStore()` at call time, and `ExecutorContext` no longer carries a
  // snapshot field for them to reach for by mistake (PF-1118).
  const store = makeMockStore(nodes, physicsOverrides);
  const ctx: ExecutorContext = {
    dispatchCommand: vi.fn(),
    getStore: () => store,
    projectType,
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verify_all_scenes executor', () => {
  const executor = EXECUTOR_REGISTRY.get('verify_all_scenes')!;

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('verify_all_scenes');
  });

  it('returns passed=true with no warnings when scene is well-formed (3D)', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Sun Light' }),
      makeNode({ entityId: 'e4', name: 'Ground' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['passed']).toBe(true);
    expect(result.output?.['warnings']).toEqual([]);
  });

  it('returns passed=true with no warnings for 2D scene without ground check', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Ambient Light' }),
    ];
    const ctx = makeMockCtx(nodes, {}, '2d');
    const result = await executor.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['passed']).toBe(true);
  });

  it('flags empty scene', async () => {
    const ctx = makeMockCtx([]);
    const result = await executor.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['warnings']).toEqual(
      expect.arrayContaining([expect.stringContaining('no entities')]),
    );
    expect(result.output?.['issues']).toEqual(
      expect.arrayContaining(['empty_scene']),
    );
    expect(result.output?.['passed']).toBe(false);
  });

  it('flags missing camera entity', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Ground' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['warnings']).toEqual(
      expect.arrayContaining([expect.stringContaining('camera')]),
    );
    expect(result.output?.['issues']).toEqual(
      expect.arrayContaining(['no_camera_on_player']),
    );
  });

  it('recognises entity named "camera" (case-insensitive)', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'camera' }),
      makeNode({ entityId: 'e3', name: 'Ambient Light' }),
      makeNode({ entityId: 'e4', name: 'Ground' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.output?.['issues']).not.toContain('no_camera_on_player');
  });

  it('recognises entity names ending in Camera suffix', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'MainCamera' }),
      makeNode({ entityId: 'e3', name: 'Ambient Light' }),
      makeNode({ entityId: 'e4', name: 'Ground' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.output?.['issues']).not.toContain('no_camera_on_player');
  });

  it('adds no_ambient_light issue when no light-named entities', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Ground' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.output?.['issues']).toContain('no_ambient_light');
  });

  it('does NOT add no_ambient_light when entity named "Sun" exists', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Sun' }),
      makeNode({ entityId: 'e4', name: 'Ground' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.output?.['issues']).not.toContain('no_ambient_light');
  });

  it('adds no_ground_plane issue for 3D scene without ground', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Ambient Light' }),
    ];
    const ctx = makeMockCtx(nodes, {}, '3d');
    const result = await executor.execute({}, ctx);

    expect(result.output?.['issues']).toContain('no_ground_plane');
  });

  it('does NOT add no_ground_plane for 2D project', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Ambient Light' }),
    ];
    const ctx = makeMockCtx(nodes, {}, '2d');
    const result = await executor.execute({}, ctx);

    expect(result.output?.['issues']).not.toContain('no_ground_plane');
  });

  it('returns correct entityCount in output', async () => {
    const nodes = [
      makeNode({ entityId: 'e1', name: 'Player' }),
      makeNode({ entityId: 'e2', name: 'Camera' }),
      makeNode({ entityId: 'e3', name: 'Ambient Light' }),
    ];
    const ctx = makeMockCtx(nodes);
    const result = await executor.execute({}, ctx);

    expect(result.output?.['entityCount']).toBe(3);
  });

  it('returns ABORTED when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeMockCtx([]);
    const ctxWithAbortedSignal = { ...ctx, signal: controller.signal };
    const result = await executor.execute({}, ctxWithAbortedSignal);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
  });

  // Physics-without-collider check deferred to Phase 2D — requires per-entity
  // iteration which the flat store snapshot cannot provide.

  it('returns warnings array (even empty)', async () => {
    const ctx = makeMockCtx([]);
    const result = await executor.execute({}, ctx);

    expect(Array.isArray(result.output?.['warnings'])).toBe(true);
  });
});
