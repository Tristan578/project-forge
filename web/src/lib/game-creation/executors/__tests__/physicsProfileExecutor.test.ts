/**
 * Tests for physicsProfileExecutor — physics feel to preset mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { physicsProfileExecutor } from '../physicsProfileExecutor';
import { useEditorStore, type EditorState } from '@/stores/editorStore';
import type { GameComponentData } from '@/stores/slices/types';
import type { ExecutorContext } from '../../types';

// Mock the physics module
const mockApplyPhysicsProfile = vi.fn();
vi.mock('@/lib/ai/physicsFeel', () => ({
  PHYSICS_PRESETS: {
    space_zero_g: { gravity: 0, moveSpeed: 2 },
    platformer_floaty: { gravity: 5, moveSpeed: 6 },
    platformer_snappy: { gravity: 15, moveSpeed: 8 },
    underwater: { gravity: 3, moveSpeed: 3 },
    puzzle_precise: { gravity: 10, moveSpeed: 4 },
    arcade_classic: { gravity: 10, moveSpeed: 7 },
    rpg_weighty: { gravity: 12, moveSpeed: 5 },
  },
  applyPhysicsProfile: (...args: unknown[]) => mockApplyPhysicsProfile(...args),
}));

/**
 * A snapshot-shaped stub for `ctx.store`.
 *
 * The executor deliberately reads NEITHER `sceneGraph` nor `allGameComponents`
 * from here: `ctx.store` is a `getState()` snapshot the orchestrator captures
 * once, before the pipeline runs, and Zustand replaces the state object on every
 * write — so it can never see an entity a previous step spawned (PF-1118 review
 * cluster A). Every fixture below therefore seeds the LIVE store and leaves this
 * stub holding decoy data, so an assertion fails loudly if the executor ever
 * regresses to reading the snapshot.
 */
function makeStore(
  nodes: Record<string, ReturnType<typeof makeNode>> = {},
  allGameComponents: Record<string, unknown[]> = {},
): ExecutorContext['store'] {
  return {
    sceneGraph: { nodes, rootIds: Object.keys(nodes) },
    allGameComponents,
  } as unknown as ExecutorContext['store'];
}

/** Seed the real store's component map (what `character_setup` does mid-pipeline). */
function seedLiveGameComponents(map: Record<string, GameComponentData[]>): void {
  useEditorStore.setState({ allGameComponents: map } as Partial<EditorState> as EditorState);
}

/** Seed the real store's scene graph (what `scene_create`/`spawn` do mid-pipeline). */
function seedLiveSceneGraph(nodes: Record<string, ReturnType<typeof makeNode>>): void {
  useEditorStore.setState({
    sceneGraph: { nodes, rootIds: Object.keys(nodes) },
  } as unknown as Partial<EditorState> as EditorState);
}

/**
 * A snapshot the executor must ignore. Its entity ids are disjoint from every
 * live fixture, so reading it instead of the live store produces the wrong
 * `entityIds` rather than an incidentally-correct one.
 */
function decoySnapshotStore(): ExecutorContext['store'] {
  return makeStore({ 'stale-1': makeNode('stale-1', 'Stale', ['PhysicsData']) });
}

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: makeStore(),
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
}

function makeNode(entityId: string, name: string, components: string[] = []) {
  return { entityId, name, components, children: [] };
}

function makeFeelDirective(overrides: Record<string, unknown> = {}) {
  return {
    mood: 'energetic',
    pacing: 'medium',
    weight: 'medium',
    referenceGames: ['Super Mario Bros'],
    oneLiner: 'A fast-paced platformer',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Both halves of the live store are reset, not just the component map: these
  // seeds are module-level global state, so a leaked scene graph would let a
  // later test pass on a previous test's entities.
  seedLiveGameComponents({});
  seedLiveSceneGraph({});
});

describe('physicsProfileExecutor', () => {
  it('has correct metadata', () => {
    expect(physicsProfileExecutor.name).toBe('physics_profile');
    expect(physicsProfileExecutor.userFacingErrorMessage).toBeDefined();
  });

  it('maps floaty+slow to space_zero_g', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'floaty', pacing: 'slow' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('space_zero_g');
  });

  it('maps heavy+medium to rpg_weighty', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'heavy', pacing: 'medium' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('rpg_weighty');
  });

  it('maps light+slow to underwater', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'light', pacing: 'slow' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('underwater');
  });

  it('defaults to arcade_classic for medium+medium', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ weight: 'medium', pacing: 'medium' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { presetUsed: string };
    expect(output.presetUsed).toBe('arcade_classic');
  });

  it('applies to specified entityIds', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['e1', 'e2'],
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
      expect.any(Object),
      ctx.dispatchCommand,
      ['e1', 'e2'],
      useEditorStore.getState().allGameComponents,
    );
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(2);
  });

  it('reads the LIVE component map, not the pre-pipeline context snapshot', async () => {
    // Drives the REAL snapshot semantics of the pipeline. The orchestrator builds
    // the ExecutorContext ONCE (`store: useEditorStore.getState()`) and
    // pipelineRunner reuses that object for every step; Zustand 5 REPLACES the
    // state object on write, so `ctx.store` can never observe a later write.
    // `character_setup` runs a step earlier and setStates a NEW allGameComponents,
    // so a snapshot read here always sees `{}` — merging against that rebuilds the
    // controller from Default and wipes canDoubleJump (PF-1118).
    //
    // Context first, exactly as the orchestrator does it...
    const ctx = makeCtx({ store: useEditorStore.getState() });

    // ...then the mid-pipeline write the snapshot cannot see.
    const components = {
      e1: [
        {
          type: 'characterController',
          characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: true },
        },
      ],
    } as unknown as Record<string, GameComponentData[]>;
    seedLiveGameComponents(components);

    // Guard the premise: if this ever stops being `{}`, the test has stopped
    // reproducing the bug and would pass vacuously.
    expect(ctx.store.allGameComponents).toEqual({});

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['e1'],
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][3]).toEqual(components);
  });

  it('falls back to the LIVE scene graph when no entityIds, not the context snapshot', async () => {
    // The entities a pipeline run acts on are the ones `scene_create`/`spawn`
    // put in the store DURING the run — none of them exist in the snapshot the
    // orchestrator captured beforehand. Seeding the snapshot with a disjoint
    // entity makes the two sources distinguishable: reading `ctx.store` would
    // apply the profile to `stale-1` and miss every real entity.
    const ctx = makeCtx({ store: decoySnapshotStore() });

    seedLiveSceneGraph({
      e1: makeNode('e1', 'Player', ['PhysicsData']),
      e2: makeNode('e2', 'Enemy', ['RigidBody']),
      e3: makeNode('e3', 'Ground', []),
    });

    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
      expect.any(Object),
      ctx.dispatchCommand,
      ['e1', 'e2'],
      useEditorStore.getState().allGameComponents,
    );
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(2);
  });

  it('returns entityCount 0 when no physics nodes and no entityIds', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).not.toHaveBeenCalled();
    const output = result.output as { entityCount: number };
    expect(output.entityCount).toBe(0);
  });

  it('allows safe config overrides for moveSpeed and jumpForce', async () => {
    const ctx = makeCtx({ store: decoySnapshotStore() });
    seedLiveSceneGraph({ e1: makeNode('e1', 'Player', ['PhysicsData']) });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      config: { moveSpeed: 15, jumpForce: 20 },
    }, ctx);

    const appliedProfile = mockApplyPhysicsProfile.mock.calls[0][0];
    expect(appliedProfile.moveSpeed).toBe(15);
    expect(appliedProfile.jumpForce).toBe(20);
  });

  it('ignores non-numeric config overrides', async () => {
    const ctx = makeCtx({ store: decoySnapshotStore() });
    seedLiveSceneGraph({ e1: makeNode('e1', 'Player', ['PhysicsData']) });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      config: { moveSpeed: 'fast', jumpForce: NaN },
    }, ctx);

    const appliedProfile = mockApplyPhysicsProfile.mock.calls[0][0];
    // Should use preset value, not the invalid overrides
    expect(typeof appliedProfile.moveSpeed).toBe('number');
    expect(Number.isFinite(appliedProfile.moveSpeed)).toBe(true);
  });

  it('rejects invalid feel directive', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: { mood: 'happy' }, // missing required fields
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects missing projectType', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid pacing enum', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective({ pacing: 'turbo' }),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
