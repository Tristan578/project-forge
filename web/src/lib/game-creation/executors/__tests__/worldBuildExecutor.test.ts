/**
 * PF-1138 — the step that turns world-geometry descriptors into real entities.
 *
 * Payloads are asserted with `toEqual`, never `objectContaining`: the payload IS
 * the behaviour here, and `objectContaining` is blind to the invented keys
 * sitting alongside the ones it checks — which is exactly how a spread-built
 * payload ships fields the engine silently drops.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { worldBuildExecutor } from '../worldBuildExecutor';
import type { ExecutorContext, ObservedEntity } from '../../types';

afterEach(() => {
  vi.useRealTimers();
});

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

const GROUND = {
  entityId: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Ground',
  entityType: 'cube',
  position: [0, -0.5, 0],
  scale: [40, 1, 40],
};

const PLATFORM = {
  entityId: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: 'Platform 1',
  entityType: 'cube',
  position: [-10, 2, 0],
  scale: [6, 1, 6],
};

describe('worldBuildExecutor', () => {
  it('has the expected name and a user-facing failure message', () => {
    expect(worldBuildExecutor.name).toBe('world_build');
    expect(worldBuildExecutor.userFacingErrorMessage.length).toBeGreaterThan(0);
  });

  /**
   * The spawn/size split is an ENGINE constraint, not a style choice.
   *
   * `apply_spawn_requests` (engine/src/core/entity_factory.rs) takes `Commands`,
   * so the entity it creates does not exist for any `Query` until the schedule
   * reaches a sync point. `apply_pending_transforms`
   * (engine/src/bridge/core_systems.rs) matches against
   * `Query<(&EntityId, &mut Transform)>` and `drain(..)`s its queue — an update
   * that matches nothing is discarded permanently, never retried.
   *
   * The two systems are registered in separate `add_systems(Update, …)` groups
   * (bridge/mod.rs) with NO ordering edge between them, so Bevy inserts no
   * `ApplyDeferred` between them either. A `spawn_entity` and an
   * `update_transform` dispatched in the SAME frame therefore lose the
   * transform, in either execution order — and because `dispatchCommand`
   * returns void, nothing anywhere reports it. The world would spawn as a row
   * of 1×1×1 cubes: still an unplayable room, just a differently shaped one.
   */
  it('sends every spawn first, then sizes them in a later frame', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await worldBuildExecutor.execute(
      { worldType: 'platformer', entities: [GROUND, PLATFORM] },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(batch).toHaveBeenCalledTimes(2);

    expect(batch.mock.calls[0][0]).toEqual([
      {
        command: 'spawn_entity',
        payload: {
          entityType: 'cube',
          name: 'Ground',
          position: [0, -0.5, 0],
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
        },
      },
      {
        command: 'spawn_entity',
        payload: {
          entityType: 'cube',
          name: 'Platform 1',
          position: [-10, 2, 0],
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
        },
      },
    ]);

    expect(batch.mock.calls[1][0]).toEqual([
      {
        command: 'update_transform',
        payload: {
          entityId: 'aaaaaaaa-0000-4000-8000-000000000001',
          scale: [40, 1, 40],
        },
      },
      {
        command: 'update_transform',
        payload: {
          entityId: 'aaaaaaaa-0000-4000-8000-000000000002',
          scale: [6, 1, 6],
        },
      },
    ]);
    expect(result.output).toEqual({ spawned: 2, worldType: 'platformer' });
  });

  it('never puts a transform in the same batch as the spawn it resizes', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    await worldBuildExecutor.execute({ entities: [GROUND, PLATFORM] }, ctx);

    // Indexed reads, never `.some`/`.every`: those skip array holes, so a
    // sparse batch would report itself clean.
    for (let call = 0; call < batch.mock.calls.length; call += 1) {
      const commands = batch.mock.calls[call][0] as Array<{ command: string }>;
      const names = new Set<string>();
      for (let i = 0; i < commands.length; i += 1) {
        names.add(commands[i].command);
      }
      expect(names.has('spawn_entity') && names.has('update_transform')).toBe(false);
    }
  });

  it('builds the payload key by key — an extra field in the input never reaches the engine', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    await worldBuildExecutor.execute(
      {
        entities: [{ ...GROUND, rotation: [9, 9, 9], material: 'lava' }],
        projectType: '3d',
        feelDirective: { mood: 'tense' },
      },
      ctx,
    );

    expect(batch.mock.calls[0][0]).toEqual([
      {
        command: 'spawn_entity',
        payload: {
          entityType: 'cube',
          name: 'Ground',
          position: [0, -0.5, 0],
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
        },
      },
    ]);
    expect(batch.mock.calls[1][0]).toEqual([
      {
        command: 'update_transform',
        payload: { entityId: 'aaaaaaaa-0000-4000-8000-000000000001', scale: [40, 1, 40] },
      },
    ]);
  });

  it('falls back to single dispatch when the batch path is unavailable', async () => {
    const ctx = makeCtx();

    const result = await worldBuildExecutor.execute({ entities: [GROUND] }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledTimes(2);
    expect((ctx.dispatchCommand as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      [
        'spawn_entity',
        {
          entityType: 'cube',
          name: 'Ground',
          position: [0, -0.5, 0],
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
        },
      ],
      ['update_transform', { entityId: 'aaaaaaaa-0000-4000-8000-000000000001', scale: [40, 1, 40] }],
    ]);
    expect(result.output).toEqual({ spawned: 1, worldType: null });
  });

  it('fails the step when the engine rejects the batch', async () => {
    const batch = vi.fn().mockReturnValue({ success: false, error: 'Unknown command' });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await worldBuildExecutor.execute({ entities: [GROUND] }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('aborts before dispatching anything', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx({ signal: controller.signal });

    const result = await worldBuildExecutor.execute({ entities: [GROUND] }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  /**
   * The abort that matters is not the one before the first dispatch — it is the
   * one that lands during `waitForEngineFrame()`, between the spawn batch and
   * the size batch. Without the re-check the executor would resize geometry
   * belonging to a run the user had already cancelled, and because
   * `dispatchCommand` returns void nothing anywhere would report it.
   */
  it('aborts during the frame gap without sizing anything', async () => {
    const controller = new AbortController();
    const batch = vi.fn().mockImplementation((commands: Array<{ command: string }>) => {
      if (commands[0]?.command === 'spawn_entity') controller.abort();
      return { success: true };
    });
    const ctx = makeCtx({ signal: controller.signal, dispatchCommandBatch: batch });

    const result = await worldBuildExecutor.execute({ entities: [GROUND, PLATFORM] }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
    expect(batch).toHaveBeenCalledTimes(1);
    const dispatched = new Set<string>();
    for (let call = 0; call < batch.mock.calls.length; call += 1) {
      const commands = batch.mock.calls[call][0] as Array<{ command: string }>;
      for (let i = 0; i < commands.length; i += 1) dispatched.add(commands[i].command);
    }
    expect(dispatched.has('update_transform')).toBe(false);
  });

  it('rejects an empty descriptor list rather than reporting an empty world as done', async () => {
    const ctx = makeCtx();
    const result = await worldBuildExecutor.execute({ entities: [] }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('rejects a non-finite number before it reaches the engine', async () => {
    const ctx = makeCtx();
    const result = await worldBuildExecutor.execute(
      { entities: [{ ...GROUND, position: [0, Number.NaN, 0] }] },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('rejects a zero scale component — the engine refuses the whole command for it', async () => {
    const ctx = makeCtx();
    const result = await worldBuildExecutor.execute(
      { entities: [{ ...GROUND, scale: [40, 0, 40] }] },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects an entityId the engine would silently replace', async () => {
    const ctx = makeCtx();

    const tooLong = await worldBuildExecutor.execute(
      { entities: [{ ...GROUND, entityId: 'x'.repeat(65) }] },
      ctx,
    );
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.code).toBe('INVALID_INPUT');

    const controlChar = await worldBuildExecutor.execute(
      { entities: [{ ...GROUND, entityId: 'ground\u0001id' }] },
      ctx,
    );
    expect(controlChar.success).toBe(false);
    expect(controlChar.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects an entity type the engine does not spawn', async () => {
    const ctx = makeCtx();
    const result = await worldBuildExecutor.execute(
      { entities: [{ ...GROUND, entityType: 'terrain' }] },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  /**
   * The transform half of #9899. Every `update_transform` this executor sends
   * sizes a piece of geometry, and an accepted resize is NOT an applied one —
   * `apply_pending_transforms` runs a frame later and drops any update matching
   * no entity, with nothing JS-side to see it. When the context can query the
   * engine, the step must PROVE each entity reached its requested scale before
   * reporting a built world; otherwise a floor left at 1x1x1 gets a half-metre
   * collider the player falls through (PF-1138), reported as success.
   *
   * A context WITHOUT `observeEntity` (every test above) keeps the legacy
   * frame-wait path, which is why none of them had to change.
   */
  describe('confirmed transform observation', () => {
    function observedAt(id: string, scale: [number, number, number]): ObservedEntity {
      return { entityId: id, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale } };
    }

    /**
     * A `dispatchCommandBatch` / `observeEntity` pair that models the per-run
     * observation cache HONESTLY: an entity is `undefined` (not yet spawned)
     * until a `spawn_entity` for its id has been dispatched, and observable at
     * `scaleFor(id)` afterwards — exactly what `ctx.observeEntity` returns in
     * production, where the first attempt's guard read precedes the spawn.
     *
     * This is what makes these tests exercise the real spawn -> confirm path
     * rather than the retry-idempotency short-circuit (the guard skips the spawn
     * for an ALREADY-observed id). An always-returns mock would report every
     * entity as already spawned and silently drop the spawn on the first attempt;
     * the dedicated retry test below is what proves the short-circuit itself.
     */
    function spawnGated(
      scaleFor: (id: string) => [number, number, number],
      onDispatch?: (command: string) => void,
    ) {
      const spawned = new Set<string>();
      const batch = vi.fn((commands: Array<{ command: string; payload?: unknown }>) => {
        for (let i = 0; i < commands.length; i += 1) {
          const c = commands[i];
          if (c.command === 'spawn_entity') spawned.add((c.payload as { id: string }).id);
          onDispatch?.(c.command);
        }
        return { success: true };
      });
      const observeEntity = vi.fn((id: string) =>
        (spawned.has(id) ? observedAt(id, scaleFor(id)) : undefined));
      return { batch, observeEntity, spawned };
    }

    it('confirms every entity reached its requested scale, then reports the world built', async () => {
      const scaleById: Record<string, [number, number, number]> = {
        [GROUND.entityId]: GROUND.scale as [number, number, number],
        [PLATFORM.entityId]: PLATFORM.scale as [number, number, number],
      };
      const { batch, observeEntity } = spawnGated((id) => scaleById[id]);
      const ctx = makeCtx({ dispatchCommandBatch: batch, observeEntity } as never);

      const result = await worldBuildExecutor.execute({ entities: [GROUND, PLATFORM] }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toMatchObject({
        spawned: 2,
        confirmed: 2,
        operationId: 'ai.FR-1.OP-01',
      });
      // Both entities were actually SPAWNED (the guard did not short-circuit on a
      // first attempt) and then confirmed by a real read.
      expect(batch.mock.calls[0][0]).toEqual([
        {
          command: 'spawn_entity',
          payload: { entityType: 'cube', name: 'Ground', position: [0, -0.5, 0], id: GROUND.entityId },
        },
        {
          command: 'spawn_entity',
          payload: { entityType: 'cube', name: 'Platform 1', position: [-10, 2, 0], id: PLATFORM.entityId },
        },
      ]);
      expect(observeEntity).toHaveBeenCalledWith(GROUND.entityId);
      expect(observeEntity).toHaveBeenCalledWith(PLATFORM.entityId);
    });

    it('waits for the real scale to land rather than trusting acceptance', async () => {
      // Not observable until spawned (the guard read); then unsized on the first
      // confirm read and correctly sized after — `applied` must wait for the
      // requested scale, not the frame.
      const spawned = new Set<string>();
      let confirmReads = 0;
      const batch = vi.fn((commands: Array<{ command: string; payload?: unknown }>) => {
        for (let i = 0; i < commands.length; i += 1) {
          const c = commands[i];
          if (c.command === 'spawn_entity') spawned.add((c.payload as { id: string }).id);
        }
        return { success: true };
      });
      const observeEntity = vi.fn((id: string): ObservedEntity | undefined => {
        if (!spawned.has(id)) return undefined; // guard: not spawned yet
        confirmReads += 1;
        return observedAt(id, confirmReads === 1 ? [1, 1, 1] : (GROUND.scale as [number, number, number]));
      });
      const ctx = makeCtx({ dispatchCommandBatch: batch, observeEntity } as never);

      const result = await worldBuildExecutor.execute({ entities: [GROUND] }, ctx);

      expect(result.success).toBe(true);
      // Guard read + at least two confirm polls (unsized, then sized).
      expect(observeEntity.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(confirmReads).toBeGreaterThanOrEqual(2);
    });

    it('fails the step with EFFECT_TIMED_OUT when a resize is dropped', async () => {
      vi.useFakeTimers();
      // Spawned, but the engine keeps reporting the unsized cube — the deferred
      // resize never landed. The step must NOT report a built world.
      const { batch, observeEntity } = spawnGated(() => [1, 1, 1]);
      const ctx = makeCtx({ dispatchCommandBatch: batch, observeEntity } as never);

      const pending = worldBuildExecutor.execute({ entities: [GROUND] }, ctx);
      await vi.advanceTimersByTimeAsync(6_000); // past the 5s observation deadline
      const result = await pending;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EFFECT_TIMED_OUT');
      const effect = (result.error?.details as { effect?: { status?: string; operationId?: string } }).effect;
      expect(effect?.status).toBe('timed-out');
      expect(effect?.operationId).toBe('ai.FR-1.OP-01');
      // A dropped resize must never masquerade as a built world.
      expect(result.output).toBeUndefined();
    });

    it('reports a cancelled observation as an aborted step, never a built world', async () => {
      const controller = new AbortController();
      // Abort the moment the size batch is dispatched, so the observation that
      // follows opens already-cancelled.
      const { batch, observeEntity } = spawnGated(() => [1, 1, 1], (command) => {
        if (command === 'update_transform') controller.abort();
      });
      const ctx = makeCtx({
        signal: controller.signal,
        dispatchCommandBatch: batch,
        observeEntity,
      } as never);

      const result = await worldBuildExecutor.execute({ entities: [GROUND] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ABORTED');
    });

    /**
     * #9899 review: `pipelineRunner` reruns this executor on the retryable
     * `EFFECT_TIMED_OUT` above with the SAME static `step.input` — the same entity
     * ids. Without the idempotency guard, the retry redispatched `spawn_entity`
     * for every entity, and because the engine does not reject a caller-supplied
     * id already in use, each already-spawned entity got a SECOND copy carrying
     * the identical `EntityId`. The per-run observation cache (modelled by the
     * shared `spawned` set below) still holds the prior attempt's confirmation, so
     * the retry must skip the spawn for every already-observed id.
     */
    it('does not respawn an entity a prior attempt already spawned when the step is retried', async () => {
      const scaleById: Record<string, [number, number, number]> = {
        [GROUND.entityId]: GROUND.scale as [number, number, number],
        [PLATFORM.entityId]: PLATFORM.scale as [number, number, number],
      };
      const { batch, observeEntity } = spawnGated((id) => scaleById[id]);
      const ctx = makeCtx({ dispatchCommandBatch: batch, observeEntity } as never);

      const first = await worldBuildExecutor.execute({ entities: [GROUND, PLATFORM] }, ctx);
      expect(first.success).toBe(true);

      // The identical step, rerun by the retry loop against the SAME context (so
      // the observation cache carries over, exactly as it does in a real run).
      const second = await worldBuildExecutor.execute({ entities: [GROUND, PLATFORM] }, ctx);
      expect(second.success).toBe(true);

      // Across BOTH attempts, each id was spawned EXACTLY ONCE. Indexed reads
      // (not `.some`/`.every`), which skip array holes.
      const spawnCounts = new Map<string, number>();
      for (let call = 0; call < batch.mock.calls.length; call += 1) {
        const commands = batch.mock.calls[call][0] as Array<{ command: string; payload: { id?: string } }>;
        for (let i = 0; i < commands.length; i += 1) {
          if (commands[i].command === 'spawn_entity') {
            const id = commands[i].payload.id as string;
            spawnCounts.set(id, (spawnCounts.get(id) ?? 0) + 1);
          }
        }
      }
      expect(spawnCounts.get(GROUND.entityId)).toBe(1);
      expect(spawnCounts.get(PLATFORM.entityId)).toBe(1);
      // The retry still reported the world built, via the resize + confirmation
      // path — a skipped spawn is not a skipped step.
      expect(second.output).toMatchObject({ spawned: 2, confirmed: 2 });
    });
  });
});
