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
// Every preset carries a DISTINCT `jumpForce` as well as a distinct `moveSpeed`.
// The stub used to omit `jumpForce` entirely, which made any assertion about a
// rejected `jumpForce` override vacuous — `undefined` equalled `undefined`
// whether the guard fired or not.
// Partial mock: the preset TABLE is stubbed so these tests can pin exact
// numbers, but `jumpForceToApexHeight` is the real one — stubbing it would
// let the module's own unit conversion rot without anything noticing.
vi.mock('@/lib/ai/physicsFeel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/physicsFeel')>()),
  PHYSICS_PRESETS: {
    space_zero_g: { gravity: 0, moveSpeed: 2, jumpForce: 21 },
    platformer_floaty: { gravity: 5, moveSpeed: 6, jumpForce: 26 },
    platformer_snappy: { gravity: 15, moveSpeed: 8, jumpForce: 28 },
    underwater: { gravity: 3, moveSpeed: 3, jumpForce: 23 },
    puzzle_precise: { gravity: 10, moveSpeed: 4, jumpForce: 24 },
    arcade_classic: { gravity: 10, moveSpeed: 7, jumpForce: 27 },
    rpg_weighty: { gravity: 12, moveSpeed: 5, jumpForce: 25 },
  },
  applyPhysicsProfile: (...args: unknown[]) => mockApplyPhysicsProfile(...args),
}));

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

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    // Wired to the REAL store, exactly as the orchestrator wires it. These tests
    // seed that store mid-fixture to stand in for an earlier pipeline step's
    // writes, so pointing this at a frozen stub would make every "reads live"
    // assertion below pass vacuously.
    getStore: () => useEditorStore.getState(),
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
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
    // The exact sentence, not `toBeDefined()`. `OrchestratorPanel` renders this
    // under the failed step, so it is the whole of what a user is told; a
    // presence check would pass just as happily on the bare "Your game will use
    // default physics" that said nothing about what to do next. Every noun is a
    // label that is on screen, and the last sentence exists because re-running
    // the build calls `newScene()` and would throw away the hand fix.
    expect(physicsProfileExecutor.userFacingErrorMessage).toBe(
      'Could not tune how the game moves, so everything will use default physics. '
      + 'To set it by hand: select the player in the Hierarchy, tick Enabled under Physics '
      + 'in the Inspector, then set Friction, Restitution and Gravity there. '
      + 'Starting a new build rebuilds the scene from scratch, so it will not keep those edits.',
    );
    expect(physicsProfileExecutor.userFacingErrorMessage).not.toMatch(/try again/i);
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
    // the ExecutorContext ONCE and pipelineRunner reuses that object for every
    // step; Zustand 5 REPLACES the state object on write, so anything captured
    // at construction time can never observe a later write. `character_setup`
    // runs a step earlier and setStates a NEW allGameComponents, so a snapshot
    // read here always sees `{}` — merging against that rebuilds the controller
    // from Default and wipes canDoubleJump (PF-1118).
    //
    // Context first, exactly as the orchestrator does it...
    const ctx = makeCtx();
    const atConstructionTime = useEditorStore.getState().allGameComponents;

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

    // Guard the premise: the value a snapshot would have frozen is `{}`, and the
    // live store has genuinely moved on. If these ever converge the test has
    // stopped reproducing the bug and would pass vacuously.
    expect(atConstructionTime).toEqual({});
    expect(useEditorStore.getState().allGameComponents).not.toEqual({});

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['e1'],
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][3]).toEqual(components);
  });

  it('falls back to the LIVE scene graph when no entityIds, not the context snapshot', async () => {
    // The entities a pipeline run acts on are the ones `scene_create`/`spawn`
    // put in the store DURING the run — none of them exist yet when the
    // orchestrator builds the context, so the fallback has to resolve them at
    // call time.
    const ctx = makeCtx();

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

  it('warns instead of reporting a clean success when it matches nothing (PF-1213)', async () => {
    const ctx = makeCtx();
    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    // Still a success — this step is not optional, and failing it would set the
    // whole plan to `failed` and discard a game that is merely mistuned. But it
    // applied nothing, and the bare green tick that used to be returned here is
    // what hid the pipeline never enabling physics at all.
    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).not.toHaveBeenCalled();
    const output = result.output as { entityCount: number; warning?: string };
    expect(output.entityCount).toBe(0);
    // The exact sentence, not `toContain('physics')` — that matched the word in
    // its own executor name and would have passed on any wording, including one
    // that told the user nothing to do next.
    expect(output.warning).toBe(
      'No entities had physics turned on, so the movement feel could not be applied. '
      + 'Things may not move or collide the way the design describes. '
      + 'To set it by hand: select the player in the Hierarchy, tick Enabled under Physics '
      + 'in the Inspector, then set Friction, Restitution and Gravity there. '
      + 'Starting a new build rebuilds the scene from scratch, so it will not keep those edits.',
    );
  });

  it('tunes the entities the physics_enable step reported (PF-1213)', async () => {
    // The store's `sceneGraph.nodes[].components` is filled in only by the
    // engine's async SCENE_GRAPH_UPDATE event, so immediately after enablement
    // it is still empty and the scan below finds nothing. The upstream step's
    // own output is the reliable source.
    const ctx = makeCtx({
      resolveStepOutputs: vi.fn((name: string) =>
        name === 'physics_enable' ? [{ entityIds: ['id-player', 'id-crystal'] }] : []),
    });

    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
      expect.anything(),
      ctx.dispatchCommand,
      ['id-player', 'id-crystal'],
      expect.anything(),
    );
    const output = result.output as { entityCount: number; warning?: string };
    expect(output.entityCount).toBe(2);
    expect(output.warning).toBeUndefined();
  });

  it('folds in EVERY physics_enable step, not just the first (PF-1213)', async () => {
    // A plan runs `physics_enable` twice: planBuilder Phase 2.5 for the
    // blueprint cast, and `systems/world.ts` for the ground, platforms and
    // walls. Reading only the first left the geometry the player lands on at
    // default friction and restitution, with nothing to show for it.
    const ctx = makeCtx({
      resolveStepOutputs: vi.fn((name: string) =>
        name === 'physics_enable'
          ? [{ entityIds: ['id-player', 'id-crystal'] }, { entityIds: ['id-ground', 'id-platform'] }]
          : []),
    });

    const result = await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(mockApplyPhysicsProfile.mock.calls[0][2]).toEqual([
      'id-player', 'id-crystal', 'id-ground', 'id-platform',
    ]);
    expect((result.output as { entityCount: number }).entityCount).toBe(4);
  });

  it('skips a physics_enable step whose entityIds is not an array', async () => {
    const ctx = makeCtx({
      resolveStepOutputs: vi.fn(() => [
        { enabled: 0 },
        { entityIds: 'id-ground' },
        { entityIds: ['id-platform'] },
      ]),
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][2]).toEqual(['id-platform']);
  });

  it('dedupes ids reported by more than one physics_enable step', async () => {
    const ctx = makeCtx({
      resolveStepOutputs: vi.fn(() => [
        { entityIds: ['id-ground', 'id-player'] },
        { entityIds: ['id-player', 'id-ground', 'id-wall'] },
      ]),
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][2]).toEqual(['id-ground', 'id-player', 'id-wall']);
  });

  it('prefers explicit entityIds over the physics_enable output', async () => {
    const ctx = makeCtx({
      resolveStepOutputs: vi.fn(() => [{ entityIds: ['id-ground'] }]),
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['id-explicit'],
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][2]).toEqual(['id-explicit']);
  });

  it('trims and dedupes explicit entityIds', async () => {
    const ctx = makeCtx();

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['  id-a  ', 'id-a', 'id-b'],
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][2]).toEqual(['id-a', 'id-b']);
  });

  it('falls through to the physics_enable output when every explicit id is blank', async () => {
    // An all-blank list is not a request to tune nothing — it is a caller that
    // produced no usable ids, and the upstream step still knows which entities
    // were given a body.
    const ctx = makeCtx({
      resolveStepOutputs: vi.fn(() => [{ entityIds: ['id-ground'] }]),
    });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      entityIds: ['   ', ''],
    }, ctx);

    expect(mockApplyPhysicsProfile.mock.calls[0][2]).toEqual(['id-ground']);
  });

  it('allows safe config overrides for moveSpeed and jumpForce', async () => {
    const ctx = makeCtx();
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
    const ctx = makeCtx();
    seedLiveSceneGraph({ e1: makeNode('e1', 'Player', ['PhysicsData']) });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      config: { moveSpeed: 'fast', jumpForce: NaN },
    }, ctx);

    // Exact preset values, not `typeof === 'number'`. A shape assertion passes
    // on any number the guard happens to forward, including the `0` the engine
    // would clamp a bad override to — which is the immovable player this path
    // exists to prevent. `medium`/`medium` resolves to `arcade_classic`.
    const appliedProfile = mockApplyPhysicsProfile.mock.calls[0][0];
    expect(appliedProfile.moveSpeed).toBe(7);
    expect(appliedProfile.jumpForce).toBe(27);
  });

  it('ignores out-of-range and non-positive config overrides', async () => {
    const ctx = makeCtx();
    seedLiveSceneGraph({ e1: makeNode('e1', 'Player', ['PhysicsData']) });

    await physicsProfileExecutor.execute({
      feelDirective: makeFeelDirective(),
      projectType: '3d',
      // -8 is the LLM-authored "reverse controls" case that used to arrive at the
      // engine and be clamped to 0.0; 150 is under the speed ceiling but over the
      // jump ceiling, so it only falls back if each field is checked against its
      // own engine limit.
      config: { moveSpeed: -8, jumpForce: 150 },
    }, ctx);

    const appliedProfile = mockApplyPhysicsProfile.mock.calls[0][0];
    expect(appliedProfile.moveSpeed).toBe(7);
    expect(appliedProfile.jumpForce).toBe(27);
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

  // Every case above runs `projectType: '3d'`, which is how this executor's
  // half of the 2D gap stayed invisible: 2D players had no CharacterController
  // at all, so there was nothing for `applyPhysicsProfile` to tune and no test
  // asked. Now that `character_setup` adds one for 2D, the profile step has to
  // actually find it — the discovery path is `allGameComponents` and the scene
  // graph, neither of which is project-type-aware, and these cases pin that.
  describe('2D projects', () => {
    it('forwards a 2D player CharacterController to applyPhysicsProfile', async () => {
      const ctx = makeCtx({ projectType: '2d' });

      // What `character_setup` writes for a 2D player, mid-pipeline.
      const components = {
        sprite_1: [
          {
            type: 'characterController',
            characterController: { speed: 7, jumpHeight: 10, gravityScale: 1, canDoubleJump: false },
          },
        ],
      } as unknown as Record<string, GameComponentData[]>;
      seedLiveGameComponents(components);

      const result = await physicsProfileExecutor.execute({
        feelDirective: makeFeelDirective(),
        projectType: '2d',
        entityIds: ['sprite_1'],
      }, ctx);

      expect(result.success).toBe(true);
      expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
        expect.any(Object),
        ctx.dispatchCommand,
        ['sprite_1'],
        components,
      );
    });

    it('discovers a 2D player through the live scene graph with no entityIds', async () => {
      const ctx = makeCtx({ projectType: '2d' });

      seedLiveSceneGraph({
        sprite_1: makeNode('sprite_1', 'Sprite', ['PhysicsData']),
        deco: makeNode('deco', 'Background', []),
      });
      seedLiveGameComponents({
        sprite_1: [
          {
            type: 'characterController',
            characterController: { speed: 7, jumpHeight: 10, gravityScale: 1, canDoubleJump: false },
          },
        ],
      } as unknown as Record<string, GameComponentData[]>);

      const result = await physicsProfileExecutor.execute({
        feelDirective: makeFeelDirective(),
        projectType: '2d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(mockApplyPhysicsProfile).toHaveBeenCalledWith(
        expect.any(Object),
        ctx.dispatchCommand,
        ['sprite_1'],
        useEditorStore.getState().allGameComponents,
      );
      const output = result.output as { entityCount: number };
      expect(output.entityCount).toBe(1);
    });

    // The feel directive has to reach a 2D game the same way it reaches a 3D
    // one. If the profile resolved differently per project type, a floaty 2D
    // game and a weighty 2D game would move identically — the exact defect the
    // shared resolver exists to prevent.
    it('resolves the same profile for 2D as for 3D', async () => {
      const feelDirective = makeFeelDirective({ weight: 'floaty', pacing: 'medium' });

      await physicsProfileExecutor.execute(
        { feelDirective, projectType: '3d', entityIds: ['e1'] },
        makeCtx(),
      );
      const threeD = mockApplyPhysicsProfile.mock.calls[0][0];

      mockApplyPhysicsProfile.mockClear();

      await physicsProfileExecutor.execute(
        { feelDirective, projectType: '2d', entityIds: ['e1'] },
        makeCtx({ projectType: '2d' }),
      );
      const twoD = mockApplyPhysicsProfile.mock.calls[0][0];

      expect(twoD).toEqual(threeD);
    });
  });
});
