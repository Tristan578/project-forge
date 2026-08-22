/**
 * PF-1213 — the step that turns spawned entities into physical bodies.
 *
 * Payloads are asserted with `toEqual`, never `objectContaining`: the payload IS
 * the behaviour here. `dispatchCommand` returns void, so a field the engine's
 * serde cannot read is dropped in silence, and `objectContaining` is blind to
 * exactly the invented keys that get dropped.
 *
 * Every payload shape below was verified textually against
 * `engine/src/core/physics.rs` (`PhysicsData`, `PhysicsPatch`, `RigidBodyKind`,
 * `ColliderShape`) and `engine/src/core/commands/physics.rs`
 * (`UpdatePhysicsPayload`, `TogglePhysicsPayload`). Field names are camelCase on
 * the wire; enum values are snake_case.
 */

import { describe, it, expect, vi } from 'vitest';
import { physicsEnableExecutor } from '../physicsEnableExecutor';
import type { ExecutorContext } from '../../types';

type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = { sceneGraph: { nodes: {} } } as never, ...rest } = overrides;
  return {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
    ...rest,
  };
}

const PLAYER = {
  entityId: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Player',
  role: 'player',
  shape: 'capsule',
};

const CRYSTAL = {
  entityId: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: 'Crystal',
  role: 'interactable',
  shape: 'sphere',
};

const GROUND = {
  entityId: 'aaaaaaaa-0000-4000-8000-000000000003',
  name: 'Ground',
  role: 'geometry',
  shape: 'cube',
};

/** Every command sent through the batch dispatcher, flattened in order. */
function flatten(batch: ReturnType<typeof vi.fn>): Array<{ command: string; payload: unknown }> {
  const out: Array<{ command: string; payload: unknown }> = [];
  for (let i = 0; i < batch.mock.calls.length; i += 1) {
    const commands = batch.mock.calls[i][0] as Array<{ command: string; payload: unknown }>;
    for (let j = 0; j < commands.length; j += 1) out.push(commands[j]);
  }
  return out;
}

describe('physicsEnableExecutor', () => {
  it('has the expected name and a user-facing failure message', () => {
    expect(physicsEnableExecutor.name).toBe('physics_enable');
    // The exact sentence, not `length > 0` — this is the only thing a user sees
    // when the step fails, and the wording is load-bearing three times over: the
    // engine's `PhysicsData::default()` is DYNAMIC (engine/src/core/physics.rs),
    // so guidance that stops at "turn Physics on" turns the floor into a falling
    // body; every noun has to be a label that is actually on screen; and there is
    // no "please try again", because a new build despawns the scene the user
    // would have just fixed by hand.
    expect(physicsEnableExecutor.userFacingErrorMessage).toBe(
      'Could not switch physics on for the level, so nothing in the game will collide. '
      + 'To set it by hand: select an entity in the Hierarchy, tick Enabled under Physics '
      + 'in the Inspector, then set Body Type to Fixed for ground, platforms and walls '
      + '(the default, Dynamic, makes them fall). '
      + 'Starting a new build rebuilds the scene from scratch, so it will not keep those edits.',
    );
    expect(physicsEnableExecutor.userFacingErrorMessage).not.toMatch(/try again/i);
  });

  /**
   * The toggle/patch split is an ENGINE constraint, not a style choice.
   *
   * `apply_physics_toggles` inserts `PhysicsEnabled` + `PhysicsData::default()`
   * through deferred `Commands`, while `apply_physics_updates` merges its patch
   * onto an EXISTING `PhysicsData` and drops it with a `tracing::warn!` when
   * there is none. The 3D pair is registered updates-first with no `.chain()`
   * edge between them (engine/src/bridge/mod.rs), so Bevy inserts no
   * `ApplyDeferred` between them either: a toggle and its patch in the same
   * frame lose the patch, in either execution order. The entity would end up
   * physical but with default settings — a dynamic cuboid player that tips over
   * and a collectible that gets punted across the level.
   */
  it('toggles every entity on first, then patches them in a later frame', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await physicsEnableExecutor.execute(
      { entities: [PLAYER, CRYSTAL, GROUND] },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(batch).toHaveBeenCalledTimes(2);

    const first = batch.mock.calls[0][0] as Array<{ command: string }>;
    const second = batch.mock.calls[1][0] as Array<{ command: string }>;
    expect(first.map(c => c.command)).toEqual(['toggle_physics', 'toggle_physics', 'toggle_physics']);
    expect(second.map(c => c.command)).toEqual(['update_physics', 'update_physics', 'update_physics']);
  });

  /**
   * The FIRST wait is against the SPAWN, not against the toggle/patch pair.
   *
   * `apply_spawn_requests` (engine/src/core/entity_factory.rs) creates entities
   * through deferred `Commands` and is registered with no ordering edge to
   * `apply_physics_toggles` (engine/src/bridge/mod.rs), which resolves its queue
   * against `Query<(Entity, &EntityId, …)>` and `drain(..)`s it whether or not
   * anything matched. Meanwhile `entitySetupExecutor` returns without yielding
   * and `runPipeline` awaits it on a microtask, so every `spawn_entity` for the
   * blueprint cast and every `toggle_physics` for it land inside ONE JS task,
   * i.e. one engine frame. Without a frame between them the toggles match
   * nothing, are dropped in silence, and this whole step is a no-op: no
   * `PhysicsEnabled`, no collider, no collision, no score, no `game_win`.
   */
  it('waits for the engine to flush the spawns before the first toggle_physics', async () => {
    const events: string[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => {
      events.push('frame');
      queueMicrotask(() => { cb(0); });
      return 0;
    });
    vi.stubGlobal('requestAnimationFrame', raf);

    try {
      const batch = vi.fn().mockImplementation((commands: Array<{ command: string }>) => {
        events.push(`batch:${commands[0].command}`);
        return { success: true };
      });

      const result = await physicsEnableExecutor.execute(
        { entities: [PLAYER] },
        makeCtx({ dispatchCommandBatch: batch }),
      );

      expect(result.success).toBe(true);
      // Two frames per wait — `waitForEngineFrame` nests two rAF ticks because a
      // single one can land inside the frame that queued the previous command.
      expect(events).toEqual([
        'frame', 'frame',
        'batch:toggle_physics',
        'frame', 'frame',
        'batch:update_physics',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('dispatches nothing when the run is aborted during the spawn-flush wait', async () => {
    const controller = new AbortController();
    const raf = vi.fn((cb: FrameRequestCallback) => {
      controller.abort();
      queueMicrotask(() => { cb(0); });
      return 0;
    });
    vi.stubGlobal('requestAnimationFrame', raf);

    try {
      const batch = vi.fn().mockReturnValue({ success: true });
      const result = await physicsEnableExecutor.execute(
        { entities: [PLAYER] },
        makeCtx({ dispatchCommandBatch: batch, signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ABORTED');
      expect(batch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends the exact toggle payload the engine deserializes', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    await physicsEnableExecutor.execute({ entities: [PLAYER] }, makeCtx({ dispatchCommandBatch: batch }));

    const commands = flatten(batch);
    expect(commands[0]).toEqual({
      command: 'toggle_physics',
      payload: { entityId: PLAYER.entityId, enabled: true },
    });
  });

  /**
   * Dynamic, because Rapier's default `ActiveCollisionTypes` is
   * `DYNAMIC_DYNAMIC | DYNAMIC_KINEMATIC | DYNAMIC_FIXED` and the engine never
   * widens it — a kinematic player against fixed ground and fixed collectibles
   * emits no events at all, and the game looks right while being unwinnable.
   * Rotation-locked, because a free capsule tips over on first contact.
   */
  it('gives the player a rotation-locked dynamic capsule', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    await physicsEnableExecutor.execute({ entities: [PLAYER] }, makeCtx({ dispatchCommandBatch: batch }));

    const commands = flatten(batch);
    expect(commands[1]).toEqual({
      command: 'update_physics',
      payload: {
        entityId: PLAYER.entityId,
        bodyType: 'dynamic',
        colliderShape: 'capsule',
        lockRotationX: true,
        lockRotationY: true,
        lockRotationZ: true,
        isSensor: false,
      },
    });
  });

  it('makes a collectible a static sensor so a pickup does not shove it', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    await physicsEnableExecutor.execute({ entities: [CRYSTAL] }, makeCtx({ dispatchCommandBatch: batch }));

    const commands = flatten(batch);
    expect(commands[1]).toEqual({
      command: 'update_physics',
      payload: {
        entityId: CRYSTAL.entityId,
        bodyType: 'fixed',
        colliderShape: 'ball',
        isSensor: true,
      },
    });
  });

  it('makes world geometry a solid static cuboid', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    await physicsEnableExecutor.execute({ entities: [GROUND] }, makeCtx({ dispatchCommandBatch: batch }));

    const commands = flatten(batch);
    expect(commands[1]).toEqual({
      command: 'update_physics',
      payload: {
        entityId: GROUND.entityId,
        bodyType: 'fixed',
        colliderShape: 'cuboid',
        isSensor: false,
      },
    });
  });

  /**
   * The GDD files the camera rig and the key light as `decoration` entities and
   * they are spawned as real cubes. A collider on those drops an invisible
   * one-metre wall at the origin of every generated game.
   */
  it('skips a role that gets no body, without failing the step', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await physicsEnableExecutor.execute({
      entities: [PLAYER, { entityId: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'Sun', role: 'decoration' }],
    }, ctx);

    expect(result.success).toBe(true);
    const output = result.output as { enabled: number; skipped: number; entityIds: string[] };
    expect(output.enabled).toBe(1);
    expect(output.skipped).toBe(1);
    expect(output.entityIds).toEqual([PLAYER.entityId]);
    for (const command of flatten(batch)) {
      expect((command.payload as { entityId: string }).entityId).toBe(PLAYER.entityId);
    }
  });

  it('warns rather than reporting a clean success when nothing gets a body', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await physicsEnableExecutor.execute({
      entities: [{ entityId: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'Sun', role: 'decoration' }],
    }, ctx);

    expect(result.success).toBe(true);
    expect(batch).not.toHaveBeenCalled();
    const output = result.output as { enabled: number; warning?: string };
    expect(output.enabled).toBe(0);
    // Exact string, not a `toContain`: this sentence is the ONLY signal the user
    // gets that a step reporting success changed nothing, and it has to tell
    // them what to do about it.
    expect(output.warning).toBe(
      'Nothing in this step could be given a physical body, so none of it will collide, '
      + 'land on the ground or be picked up. '
      + 'To set it by hand: select an entity in the Hierarchy, tick Enabled under Physics '
      + 'in the Inspector, then set Body Type to Fixed for ground, platforms and walls '
      + '(the default, Dynamic, makes them fall) and tick Sensor for pickups.',
    );
  });

  it('falls back to per-command dispatch when the caller has no batcher', async () => {
    const dispatchCommand = vi.fn();
    const ctx = makeCtx({ dispatchCommand });

    const result = await physicsEnableExecutor.execute({ entities: [GROUND] }, ctx);

    expect(result.success).toBe(true);
    expect(dispatchCommand.mock.calls.map(c => c[0])).toEqual(['toggle_physics', 'update_physics']);
  });

  it('fails when the engine rejects a batch', async () => {
    const batch = vi.fn().mockReturnValue({ success: false });
    const result = await physicsEnableExecutor.execute(
      { entities: [PLAYER] },
      makeCtx({ dispatchCommandBatch: batch }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  /**
   * The SECOND rejection branch, which no test reached.
   *
   * A run that gets its toggles through and then loses the patch is the worst
   * outcome this executor can produce and the hardest to see: every entity is
   * physical, but with `PhysicsData::default()` — a DYNAMIC cuboid. The player
   * becomes a box that tips over, and every collectible becomes a solid dynamic
   * body that gets punted across the level on contact instead of being picked
   * up. That is a playable-looking game that cannot be won, so the step must
   * FAIL rather than report a partial success.
   */
  it('fails when the patch batch is rejected after the toggles were accepted', async () => {
    const batch = vi.fn()
      .mockReturnValueOnce({ success: true })   // toggle_physics
      .mockReturnValueOnce({ success: false }); // update_physics
    const result = await physicsEnableExecutor.execute(
      { entities: [PLAYER] },
      makeCtx({ dispatchCommandBatch: batch }),
    );

    expect(batch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
    // Exact string: the two rejection branches are told apart only by this
    // message, and a run that failed at the patch is a materially different
    // scene from one that failed at the toggle.
    expect(result.error?.message).toBe('Engine rejected an update_physics command');
  });

  /**
   * The collider fallback chain, `profile.colliderShape ?? COLLIDER_FOR_SHAPE[shape] ?? 'cuboid'`.
   *
   * Both ends of it were unexercised: every fixture supplied a shape, and no
   * fixture used a role whose profile pins its own collider. The chain decides
   * the geometry Rapier simulates, and a wrong collider is invisible — the mesh
   * still draws correctly, so the only symptom is a player catching on nothing
   * or falling through something solid.
   */
  it("gives an entity with no known shape the neutral 'cuboid' collider", async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    // `shape` is optional — a step planned before that field existed still runs,
    // and a cuboid is the one collider that is wrong in a bounded way rather
    // than catastrophically (a `ball` under a crate rolls it off the level).
    const result = await physicsEnableExecutor.execute(
      { entities: [{ entityId: CRYSTAL.entityId, name: 'Relic', role: 'npc' }] },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(flatten(batch)).toEqual([
      { command: 'toggle_physics', payload: { entityId: CRYSTAL.entityId, enabled: true } },
      {
        command: 'update_physics',
        payload: {
          entityId: CRYSTAL.entityId,
          bodyType: 'fixed',
          colliderShape: 'cuboid',
          isSensor: true,
        },
      },
    ]);
  });

  it("lets the role's own collider win over the shape it was spawned as", async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    // A projectile pins `ball` regardless of mesh: the profile's collider is the
    // deliberate override, and reading the shape first would give a projectile
    // authored as a cube a cuboid that catches on every surface it grazes.
    const result = await physicsEnableExecutor.execute(
      { entities: [{ entityId: GROUND.entityId, name: 'Fireball', role: 'projectile', shape: 'cube' }] },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(flatten(batch)).toEqual([
      { command: 'toggle_physics', payload: { entityId: GROUND.entityId, enabled: true } },
      {
        command: 'update_physics',
        payload: {
          entityId: GROUND.entityId,
          bodyType: 'dynamic',
          colliderShape: 'ball',
          isSensor: false,
        },
      },
    ]);
  });

  it('rejects an entityId the engine would silently replace with a random UUID', async () => {
    // `is_valid_override_id` (engine/src/core/entity_factory.rs) drops an
    // oversized or control-character id and spawns under a fresh UUID instead,
    // so the step would report success on an entity nothing can bind to.
    const result = await physicsEnableExecutor.execute(
      { entities: [{ ...PLAYER, entityId: 'x'.repeat(65) }] },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('refuses an unknown role rather than guessing a body for it', async () => {
    const result = await physicsEnableExecutor.execute(
      { entities: [{ ...PLAYER, role: 'boss' }] },
      makeCtx(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('stops before patching when the run is aborted during the frame gap', async () => {
    const controller = new AbortController();
    const batch = vi.fn().mockImplementation(() => {
      controller.abort();
      return { success: true };
    });
    const ctx = makeCtx({ dispatchCommandBatch: batch, signal: controller.signal });

    const result = await physicsEnableExecutor.execute({ entities: [PLAYER] }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(batch).toHaveBeenCalledTimes(1);
  });
});
