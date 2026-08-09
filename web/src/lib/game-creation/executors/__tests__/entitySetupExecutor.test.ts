import { describe, it, expect, vi } from 'vitest';
import { entitySetupExecutor } from '../entitySetupExecutor';
import type { ExecutorContext } from '../../types';

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
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
});
