/**
 * Tests for the verify_all_scenes executor.
 * 10+ tests covering structural heuristics.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutorContext } from '../types';
import type { EditorState } from '@/stores/editorStore';
import type { SceneNode } from '@/stores/slices/types';
import { EXECUTOR_REGISTRY } from '../executors/index';

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
  return {
    dispatchCommand: vi.fn(),
    store: makeMockStore(nodes, physicsOverrides),
    projectType,
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
  };
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
