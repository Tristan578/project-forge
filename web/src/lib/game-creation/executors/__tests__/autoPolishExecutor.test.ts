import { describe, it, expect, vi } from 'vitest';
import { autoPolishExecutor } from '../autoPolishExecutor';
import type { ExecutorContext } from '../../types';
import { buildDefaultGroundDescriptor } from '../../worldGeometry';

const FEEL_DIRECTIVE = {
  mood: 'adventurous',
  pacing: 'medium' as const,
  weight: 'medium' as const,
  referenceGames: ['Mario'],
  oneLiner: 'A platformer adventure',
};

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

/**
 * A `resolveStepOutput` that answers PER STEP NAME.
 *
 * A blanket `mockReturnValue({ issues: [...] })` answers every name with the
 * verify output, so `resolveStepOutput('character_setup')` returns an object
 * with no `entityId` and the camera silently ends up targetless — the exact
 * defect these tests are meant to catch, hidden by the mock.
 */
function stepOutputs(map: Record<string, Record<string, unknown>>) {
  return vi.fn((name: string) => map[name]);
}

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = { sceneGraph: { nodes: {} } } as never, ...rest } = overrides;
  return {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn().mockReturnValue(undefined),
    resolveStepOutputs: vi.fn(() => []),
    ...rest,
  };
}

describe('autoPolishExecutor', () => {
  it('has correct name and error message', () => {
    expect(autoPolishExecutor.name).toBe('auto_polish');
    expect(autoPolishExecutor.userFacingErrorMessage).toContain('ready as-is');
  });

  it('applies no fixes when no issues found', async () => {
    const ctx = makeCtx();
    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixCount).toBe(0);
    expect(result.output?.fixesApplied).toEqual([]);
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('adds ambient light when no_ambient_light issue present', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ambient_light'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Added ambient lighting');
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('update_ambient_light', {
      color: [1, 1, 1],
      brightness: 0.3,
    });
  });

  it('adds a ground plane WITH a collider when no_ground_plane issue present', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ground_plane'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Added ground plane');

    // Asserted as an ORDERED call list, not four `toHaveBeenCalledWith`s: the
    // latter is blind to a missing sibling, and a missing sibling IS the bug —
    // a cube with no `toggle_physics` gets no Rapier collider at all
    // (`manage_physics_lifecycle` is `With<PhysicsEnabled>`) and one with no
    // `update_transform` gets a collider the size of the wrong thing, so the
    // player falls straight through the repair either way. `auto_polish` runs
    // AFTER `physics_enable`, so no later step can cover for it.
    const calls = vi.mocked(ctx.dispatchCommand).mock.calls;
    expect(calls.map((c: unknown[]) => c[0])).toEqual([
      'spawn_entity', 'update_transform', 'toggle_physics', 'update_physics',
    ]);

    // Full payloads with `toEqual`, never `objectContaining`: `dispatchCommand`
    // returns void, so an invented or misspelled key is dropped by `serde` with
    // no exception, no event and no log — `objectContaining` asserts what is
    // present and is blind to exactly that.
    const spawn = calls[0][1] as Record<string, unknown>;
    expect(spawn).toEqual({
      // The engine honours a caller-supplied id (`is_valid_override_id`,
      // core/entity_factory.rs). Without one it mints a random UUID this
      // executor never learns, and the follow-up commands would have no entity
      // to name.
      id: expect.any(String),
      // A `cube`, not a `plane`. The engine has no plane collider — a plane
      // gets a cuboid like everything else — so a zero-thickness quad would be
      // a mesh describing something the physics does not.
      entityType: 'cube',
      name: 'Ground',
      // Half a thickness BELOW the origin, which is what puts the collider's
      // top face flush with y=0 instead of floating 0.5 above it.
      position: [0, -0.5, 0],
    });

    const groundId = spawn['id'] as string;
    expect(groundId.length).toBeGreaterThan(0);

    // THE ASSERTION THIS TEST EXISTS FOR: the collider matches the mesh.
    //
    // `make_collider` (engine/src/core/physics.rs) takes its half-extents from
    // `transform.scale`, and `spawn_entity` carries no scale field — so without
    // this command the repaired floor is a 1x1x1 box at the origin whose top
    // face sits ABOVE the visible mesh. The player stands on an invisible
    // pedestal and drops into the void one step later, while the fix list says
    // "Added ground plane". Asserting only the three wire payloads passes on
    // that; asserting the SIZE does not.
    expect(calls[1][1]).toEqual({ entityId: groundId, scale: [40, 1, 40] });

    expect(calls[2][1]).toEqual({ entityId: groundId, enabled: true });
    // The `geometry` profile, shared with `physics_enable` rather than restated:
    // solid, immovable, and the cuboid `make_collider` produces for a cube.
    expect(calls[3][1]).toEqual({
      entityId: groundId,
      bodyType: 'fixed',
      colliderShape: 'cuboid',
      isSensor: false,
    });
  });

  it('sizes the repaired ground from the descriptor world_build would have used', async () => {
    // The repair and `world_build` must not disagree about what "the ground"
    // is. A second hand-written descriptor here is how the two drift into a
    // floor that is one size in a polished scene and another in a built one —
    // invisible until a player walks off the edge of whichever is smaller.
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ground_plane'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '2d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);

    const expected = buildDefaultGroundDescriptor('2d');
    const calls = vi.mocked(ctx.dispatchCommand).mock.calls;
    const spawn = calls[0][1] as Record<string, unknown>;
    expect(spawn).toEqual({
      id: expect.any(String),
      entityType: expected.entityType,
      name: expected.name,
      position: expected.position,
    });
    expect(calls[1][1]).toEqual({ entityId: spawn['id'], scale: expected.scale });

    // Pinned literally as well as against the descriptor: a change that moves
    // BOTH sides at once is precisely what a self-referential assertion cannot
    // see. A 2D world is seen from the side, so its ground is wide and only as
    // deep as it is thick.
    expect(expected.position).toEqual([0, -0.5, 0]);
    expect(expected.scale).toEqual([60, 1, 1]);
  });

  it('waits a frame between the ground spawn, its toggle and its patch', async () => {
    // Two engine invariants stack here and neither reports a violation:
    // `apply_physics_toggles` drains its queue whether or not the entity exists
    // (so a toggle in the spawn's own frame is consumed and lost), and
    // `apply_physics_updates` merges onto an EXISTING `PhysicsData`, dropping
    // the patch when there is none. Recording the frame boundaries is the only
    // way to assert the gaps — the payloads look identical either way.
    const order: string[] = [];
    // Stubbed rather than spied: these suites run under the node config too,
    // where `requestAnimationFrame` does not exist and `vi.spyOn` would throw.
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      order.push('frame');
      queueMicrotask(() => { cb(0); });
      return 0;
    }));

    try {
      const ctx = makeCtx({
        resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ground_plane'] }),
        dispatchCommand: vi.fn((command: string) => { order.push(command); }),
      });

      const result = await autoPolishExecutor.execute({
        projectType: '3d',
        feelDirective: FEEL_DIRECTIVE,
      }, ctx);

      expect(result.success).toBe(true);
      // `waitForEngineFrame` schedules two nested rAF ticks per wait, because a
      // single tick can land inside the engine frame that queued the command.
      expect(order).toEqual([
        'spawn_entity',
        'frame', 'frame',
        // Sizing and the toggle ride the same batch: they are independent of
        // each other and both need only that the spawn has been flushed.
        'update_transform', 'toggle_physics',
        'frame', 'frame',
        'update_physics',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The batch dispatcher is the only path that can report a rejection at all
  // (a single `dispatchCommand` returns void), so swallowing one here ships a
  // ground plane the player falls through while the step reports "Added ground
  // plane". Each batch after the spawn gets its own case: a rejection reported
  // against the wrong sentence is as unhelpful as none at all, and both
  // branches were reachable-but-unreached before.
  it.each([
    {
      rejected: 'update_transform',
      message: 'Engine rejected the size or toggle_physics command for the repaired ground plane',
    },
    {
      rejected: 'toggle_physics',
      message: 'Engine rejected the size or toggle_physics command for the repaired ground plane',
    },
    {
      rejected: 'update_physics',
      message: 'Engine rejected update_physics for the repaired ground plane',
    },
  ])('reports COMMAND_FAILED when the engine rejects $rejected on the repaired ground', async ({ rejected, message }) => {
    const batch = vi.fn((commands: Array<{ command: string }>) => ({
      success: !commands.some((c) => c.command === rejected),
    }));
    const ctx = makeCtx({
      dispatchCommandBatch: batch as never,
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ground_plane'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
    expect(result.error?.message).toBe(message);
  });

  it('stops before touching the engine again when aborted mid-repair', async () => {
    // The frame waits are the first points at which this executor yields, so
    // they are also the first points at which a cancelled run can be noticed.
    const controller = new AbortController();
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ground_plane'] }),
      dispatchCommand: vi.fn((command: string) => {
        if (command === 'spawn_entity') controller.abort();
      }),
      signal: controller.signal,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(
      vi.mocked(ctx.dispatchCommand).mock.calls.map((c: unknown[]) => c[0]),
    ).toEqual(['spawn_entity']);
  });

  it('configures camera as thirdPersonFollow in 3D when no_camera_on_player', async () => {
    const ctx = makeCtx({
      resolveStepOutput: stepOutputs({
        verify_all_scenes: { issues: ['no_camera_on_player'] },
        character_setup: { entityId: 'player_id' },
      }),
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'cam_id', name: 'MainCamera' },
          },
        },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Configured camera as thirdPersonFollow');
    // The engine's vocabulary, not the store's: `followSmoothing` is authoring
    // for `damping`, and the engine drops every name it does not recognize
    // without an error (PF-1126).
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam_id',
      mode: 'thirdPersonFollow',
      // The issue being fixed is `no_camera_on_player`, and the engine skips
      // ThirdPersonFollow's whole update arm when `target_entity` is `None`. A
      // `null` here would report the problem solved while shipping a camera
      // that never moves.
      targetEntity: 'player_id',
      // No `damping`. This used to assert 0.8, sent as a 0..1 smoothing factor —
      // but the engine's damping is a rate per second (`t = (damping * delta)
      // .min(1.0)`), so 0.8 ran the follow roughly six times slower than the 5.0
      // default. Omitting the field is how the payload asks for that default, and
      // it keeps no second copy of the number here to drift from the engine's.
    });
    // Configuring a camera the engine does not render through is a repair the
    // player cannot see: `game_camera_system` is `With<ActiveGameCamera>`, and
    // only `set_active_game_camera` inserts that marker on a freshly configured
    // camera. Asserted as an ORDERED call list rather than another
    // `toHaveBeenCalledWith`, because the latter is blind to a missing sibling —
    // which is how this stayed absent through the suite that was written for it.
    expect(
      vi.mocked(ctx.dispatchCommand).mock.calls
        .map((c: unknown[]) => c[0])
        .filter((name: unknown) => String(name).includes('camera')),
    ).toEqual(['set_game_camera', 'set_active_game_camera']);
  });

  it('configures camera as sideScroller in 2D', async () => {
    const ctx = makeCtx({
      resolveStepOutput: stepOutputs({
        verify_all_scenes: { issues: ['no_camera_on_player'] },
        character_setup: { entityId: 'player_id' },
      }),
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'cam2d', name: 'game_cam' },
          },
        },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '2d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Configured camera as sideScroller');
    // `GameCameraData` has no side-scroller damping field, so the 0.8 smoothing
    // the 3D branch gets is simply not expressible here — the camera takes the
    // engine's default of 5. Asserted in full so that gap stays visible rather
    // than reappearing as a silently-dropped key.
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam2d',
      mode: 'sideScroller',
      targetEntity: 'player_id',
    });
  });

  it('says the camera will not move when no player was rigged to follow', async () => {
    const ctx = makeCtx({
      // No `character_setup` output: the movement system drops that step when the
      // GDD names no player, so this is reachable on a real build.
      resolveStepOutput: stepOutputs({
        verify_all_scenes: { issues: ['no_camera_on_player'] },
      }),
      store: {
        sceneGraph: { nodes: { n1: { entityId: 'cam_id', name: 'MainCamera' } } },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    // The fix list is user-visible. Reporting a plain "Configured camera as …"
    // here would tell the user the problem was solved while the camera stands
    // still for the whole game.
    expect(result.output?.fixesApplied).toContain(
      'Configured camera as thirdPersonFollow, but found no player for it to follow — it will not move',
    );
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam_id',
      mode: 'thirdPersonFollow',
      targetEntity: null,
    });
  });

  it('warns when no camera entity exists for no_camera_on_player', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_camera_on_player'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Warning: no camera entity found to configure');
    // No command dispatched since no camera found
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('warns about physics_without_collider without dispatching commands', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['physics_without_collider'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixesApplied).toContain('Warning: entity has physics without collider — manual fix needed');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('applies multiple fixes for multiple issues', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({
        issues: ['no_ambient_light', 'no_ground_plane', 'physics_without_collider'],
      }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.fixCount).toBe(3);
    const fixes = result.output?.fixesApplied as string[];
    expect(fixes).toContain('Added ambient lighting');
    expect(fixes).toContain('Added ground plane');
  });

  it('uses dispatchCommandBatch when available', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({
      dispatchCommandBatch: batch,
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ambient_light', 'no_ground_plane'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(batch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ command: 'update_ambient_light' }),
      expect.objectContaining({ command: 'spawn_entity' }),
    ]));
  });

  it('returns failure when batch command fails', async () => {
    const batch = vi.fn().mockReturnValue({ success: false });
    const ctx = makeCtx({
      dispatchCommandBatch: batch,
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_ambient_light'] }),
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('rejects invalid projectType', async () => {
    const ctx = makeCtx();
    const result = await autoPolishExecutor.execute({
      projectType: 'vr',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid pacing in feelDirective', async () => {
    const ctx = makeCtx();
    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: { ...FEEL_DIRECTIVE, pacing: 'turbo' },
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('finds camera by _cam suffix', async () => {
    const ctx = makeCtx({
      resolveStepOutput: vi.fn().mockReturnValue({ issues: ['no_camera_on_player'] }),
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'follow_cam_id', name: 'follow_cam' },
          },
        },
      } as never,
    });

    const result = await autoPolishExecutor.execute({
      projectType: '3d',
      feelDirective: FEEL_DIRECTIVE,
    }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'follow_cam_id',
      mode: 'thirdPersonFollow',
      targetEntity: null,
      // No `damping` — see the 3D case above.
    });
  });
});
