/**
 * PF-1138 — the step that turns world-geometry descriptors into real entities.
 *
 * Payloads are asserted with `toEqual`, never `objectContaining`: the payload IS
 * the behaviour here, and `objectContaining` is blind to the invented keys
 * sitting alongside the ones it checks — which is exactly how a spread-built
 * payload ships fields the engine silently drops.
 */

import { describe, it, expect, vi } from 'vitest';
import { worldBuildExecutor } from '../worldBuildExecutor';
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
});
