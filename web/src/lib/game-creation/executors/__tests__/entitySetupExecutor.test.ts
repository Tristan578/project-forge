import { afterEach, describe, it, expect, vi } from 'vitest';
import { entitySetupExecutor } from '../entitySetupExecutor';
import type { ExecutorContext } from '../../types';

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('entitySetupExecutor', () => {
  it('has correct name and error message', () => {
    expect(entitySetupExecutor.name).toBe('entity_setup');
    expect(entitySetupExecutor.userFacingErrorMessage).toContain('Could not create an entity');
  });

  it('spawns a capsule for player role in 3D', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      entityName: 'Hero',
      role: 'player',
      entityType: 'capsule',
    });
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', { entityType: 'capsule', name: 'Hero' });
  });

  it('waits for the engine frame before reporting a spawned entity as ready', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    const ctx = makeCtx();
    let settled = false;

    const pending = entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
    }, ctx).then((result) => {
      settled = true;
      return result;
    });

    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', {
      entityType: 'capsule',
      name: 'Hero',
    });
    expect(settled).toBe(false);

    callbacks[0](0);
    await Promise.resolve();
    expect(settled, 'resolved before the engine advanced a full frame').toBe(false);

    callbacks[1](0);
    const result = await pending;
    expect(result.success).toBe(true);
  });

  // The engine assigns every entity a random-UUID `EntityId` unless the spawn
  // command supplies one. Downstream steps (set_script, character setup) match
  // on that id, so the plan's id has to reach the engine or the binding silently
  // resolves to nothing.
  it('forwards the planned entityId to the engine and returns it', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
      entityId: 'e1e1e1e1-0000-4000-8000-000000000001',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ entityId: 'e1e1e1e1-0000-4000-8000-000000000001' });
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', {
      entityType: 'capsule',
      name: 'Hero',
      id: 'e1e1e1e1-0000-4000-8000-000000000001',
    });
  });

  it('omits id when no entityId was planned', async () => {
    const ctx = makeCtx();
    await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
    }, ctx);

    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', { entityType: 'capsule', name: 'Hero' });
  });

  // The engine holds exactly one active scene and rejects `switch_scene` by design
  // (scene management is JS-side). Dispatching it made every entity step fail.
  it('never dispatches switch_scene', async () => {
    const batch = vi.fn().mockReturnValue({ success: true, results: [{ success: true }] });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
    }, ctx);

    const dispatched = [
      ...(ctx.dispatchCommand as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
      ...batch.mock.calls.flatMap(
        (c) => (c[0] as Array<{ command: string }>).map((x) => x.command),
      ),
    ];
    expect(dispatched).not.toContain('switch_scene');
  });

  it('succeeds against a dispatcher that rejects unimplemented scene commands', async () => {
    const UNIMPLEMENTED = new Set(['switch_scene', 'create_scene', 'delete_scene', 'duplicate_scene', 'save_scene']);
    const batch = vi.fn().mockImplementation((commands: Array<{ command: string }>) => {
      const results = commands.map((c) => ({ success: !UNIMPLEMENTED.has(c.command) }));
      return { success: results.every((r) => r.success), results };
    });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      scene: 'MainScene',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
  });

  it('spawns a sphere for projectile role in 3D', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Bullet', role: 'projectile' },
      scene: 'Level1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityType).toBe('sphere');
  });

  it('spawns a cube for enemy role in 3D', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Goblin', role: 'enemy' },
      scene: 'Level1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityType).toBe('cube');
  });

  it('always spawns a plane for 2D projects regardless of role', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Player', role: 'player' },
      scene: 'Scene1',
      projectType: '2d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityType).toBe('plane');
  });

  it('uses dispatchCommandBatch when available', async () => {
    const batch = vi.fn().mockReturnValue({ success: true });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await entitySetupExecutor.execute({
      entity: { name: 'Deco', role: 'decoration' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(batch).toHaveBeenCalledWith([
      { command: 'spawn_entity', payload: { entityType: 'cube', name: 'Deco' } },
    ]);
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('returns failure when batch command fails', async () => {
    const batch = vi.fn().mockReturnValue({ success: false });
    const ctx = makeCtx({ dispatchCommandBatch: batch });

    const result = await entitySetupExecutor.execute({
      entity: { name: 'NPC', role: 'npc' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('rejects missing entity name', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: '', role: 'player' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid role', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Test', role: 'boss' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects missing scene', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Test', role: 'player' },
      scene: '',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects missing projectType', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Test', role: 'player' },
      scene: 'S1',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('handles all role-to-entity-type mappings', async () => {
    const mappings: Record<string, string> = {
      player: 'capsule',
      enemy: 'cube',
      npc: 'cube',
      decoration: 'cube',
      trigger: 'cube',
      interactable: 'cube',
      projectile: 'sphere',
    };

    for (const [role, expectedType] of Object.entries(mappings)) {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: `${role}_entity`, role },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.entityType).toBe(expectedType);
    }
  });

  // The GDD writes appearance as `primitive:<shape>` (the same convention the
  // asset manifest uses for fallbacks). Before PF-1111 the field was parsed and
  // thrown away, so a design that explicitly asked for a sphere got whatever
  // shape the role map happened to pick — every enemy was a cube.
  describe('appearance', () => {
    it('spawns the shape named by primitive:<shape> instead of the role default', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Boulder', role: 'enemy', appearance: 'primitive:sphere' },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.entityType).toBe('sphere');
      expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', {
        entityType: 'sphere',
        name: 'Boulder',
      });
    });

    it('accepts every spawnable mesh shape', async () => {
      for (const shape of ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'capsule']) {
        const ctx = makeCtx();
        const result = await entitySetupExecutor.execute({
          entity: { name: shape, role: 'decoration', appearance: `primitive:${shape}` },
          scene: 'S1',
          projectType: '3d',
        }, ctx);

        expect(result.success).toBe(true);
        expect(result.output?.entityType).toBe(shape);
      }
    });

    it('is case-insensitive and tolerates surrounding whitespace', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Barrel', role: 'decoration', appearance: '  Primitive:Cylinder  ' },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.output?.entityType).toBe('cylinder');
    });

    // The field is free text by contract — the model is asked for the prefixed
    // form but a prose description must never fail the step.
    it('falls back to the role default for prose appearance', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Golem', role: 'enemy', appearance: 'a hulking creature of moss-covered stone' },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.entityType).toBe('cube');
    });

    it('falls back to the role default for a shape the engine cannot spawn', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Odd', role: 'projectile', appearance: 'primitive:dodecahedron' },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.entityType).toBe('sphere');
    });

    // `point_light` is a valid spawn_entity type but not a mesh. Every later step
    // in the plan (physics, character rig, scripts) assumes it bound to a body,
    // so an appearance string must not be able to turn a gameplay entity into a
    // light source.
    it('refuses to spawn a light through appearance', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Lamp', role: 'decoration', appearance: 'primitive:point_light' },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output?.entityType).toBe('cube');
    });

    // 2D entities are textured planes. A capsule in a 2D scene is not a style
    // choice, it is a broken sprite.
    it('never overrides the plane in 2D', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Hero', role: 'player', appearance: 'primitive:capsule' },
        scene: 'S1',
        projectType: '2d',
      }, ctx);

      expect(result.output?.entityType).toBe('plane');
    });

    it('falls back to the role default when appearance is absent', async () => {
      const ctx = makeCtx();
      const result = await entitySetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        scene: 'S1',
        projectType: '3d',
      }, ctx);

      expect(result.output?.entityType).toBe('capsule');
    });
  });

  // `behaviors` was accepted here and consumed by nothing anywhere in the
  // pipeline. It is gone from the GDD, so a step that omits it must still run.
  it('accepts an entity with no behaviors field', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'primitive:capsule' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
  });

  it('clamps entity name to 200 characters', async () => {
    const ctx = makeCtx();
    const result = await entitySetupExecutor.execute({
      entity: { name: 'A'.repeat(201), role: 'player' },
      scene: 'S1',
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  // -------------------------------------------------------------------------
  // Confirmed spawn (#9899, operation family ai.FR-1.OP-01)
  // -------------------------------------------------------------------------
  //
  // When the context can query the engine AND the plan named an addressable id,
  // the spawn is confirmed by READING the engine's real state after the deferred
  // command applies — not by trusting acceptance plus a frame wait. A context
  // without `observeEntity` (every test above) keeps the legacy frame-wait path,
  // which is why none of them had to change.
  describe('confirmed spawn observation', () => {
    const ID = 'e1e1e1e1-0000-4000-8000-000000000042';

    it('queries real engine state and reports applied only once the entity is observed', async () => {
      // Not observable on the first read, then present — proving the executor
      // waits for the engine to actually show the entity, not merely for a frame.
      const observeEntity = vi.fn<(id: string) => unknown>()
        .mockReturnValueOnce(undefined)
        .mockReturnValue({ entityId: ID, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
      const ctx = makeCtx({ observeEntity } as never);

      const result = await entitySetupExecutor.execute({
        entity: { name: 'Crate', role: 'decoration' },
        scene: 'MainScene',
        projectType: '3d',
        entityId: ID,
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toMatchObject({
        entityId: ID,
        effectStatus: 'applied',
        operationId: 'ai.FR-1.OP-01',
      });
      // The engine WAS queried for this id — confirmation is a real read.
      expect(observeEntity).toHaveBeenCalledWith(ID);
      expect(observeEntity.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('reports timed-out with the operation id and NEVER completed when the effect is dropped', async () => {
      // The dropped-effect case: the command is accepted (dispatchCommand does
      // not refuse) but the engine never shows the entity. A short deadline via
      // fake timers keeps the test instant.
      vi.useFakeTimers();
      const observeEntity = vi.fn().mockReturnValue(undefined); // never observed
      const ctx = makeCtx({ observeEntity } as never);

      const pending = entitySetupExecutor.execute({
        entity: { name: 'Ghost', role: 'decoration' },
        scene: 'MainScene',
        projectType: '3d',
        entityId: ID,
      }, ctx);

      await vi.advanceTimersByTimeAsync(6_000); // past the 5s observation deadline
      const result = await pending;
      vi.useRealTimers();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EFFECT_TIMED_OUT');
      const effect = (result.error?.details as { effect?: { status?: string; operationId?: string } }).effect;
      expect(effect?.status).toBe('timed-out');
      expect(effect?.operationId).toBe('ai.FR-1.OP-01');
      // A dropped effect must never masquerade as a completed spawn.
      expect(result.output).toBeUndefined();
    });

    it('reports a cancelled observation as an aborted step, never applied', async () => {
      const controller = new AbortController();
      controller.abort();
      const observeEntity = vi.fn().mockReturnValue(undefined);
      const ctx = makeCtx({ observeEntity, signal: controller.signal } as never);

      const result = await entitySetupExecutor.execute({
        entity: { name: 'Crate', role: 'decoration' },
        scene: 'MainScene',
        projectType: '3d',
        entityId: ID,
      }, ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ABORTED');
      // Aborted before any read — a cancelled observation cannot report applied.
      expect(observeEntity).not.toHaveBeenCalled();
    });

    it('falls back to the frame wait when no id is addressable, even with a query capability', async () => {
      // No `entityId` means the engine minted its own UUID nothing can query, so
      // the confirmed path cannot correlate — the legacy frame wait still runs
      // and the step still succeeds.
      const observeEntity = vi.fn();
      const ctx = makeCtx({ observeEntity } as never);

      const result = await entitySetupExecutor.execute({
        entity: { name: 'Anon', role: 'decoration' },
        scene: 'MainScene',
        projectType: '3d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(observeEntity).not.toHaveBeenCalled();
      expect(result.output).not.toHaveProperty('effectStatus');
    });
  });
});
