import { describe, it, expect, vi } from 'vitest';
import { characterSetupExecutor } from '../characterSetupExecutor';
import type { ExecutorContext } from '../../types';

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
  const ctx: ExecutorContext = {
    dispatchCommand: vi.fn(),
    store: { sceneGraph: { nodes: {} } } as never,
    getStore: () => ctx.store,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
  return ctx;
}

describe('characterSetupExecutor', () => {
  it('has correct name and error message', () => {
    expect(characterSetupExecutor.name).toBe('character_setup');
    expect(characterSetupExecutor.userFacingErrorMessage).toContain('character rig');
  });

  it('adds CharacterController game component for 3D', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'knight' },
      projectType: '3d',
      entityId: 'ent_123',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      entityId: 'ent_123',
      entityName: 'Hero',
      projectType: '3d',
      rigApplied: false,
    });
    // `canDoubleJump` has no `#[serde(default)]` on the Rust struct, so a bag
    // missing it fails deserialization and the component is never added.
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', {
      entityId: 'ent_123',
      componentType: 'character_controller',
      properties: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
    });
  });

  // This executor required `appearance` and `behaviors` on the entity and read
  // neither. `behaviors` is gone from the GDD and `appearance` is consumed by
  // `entity_setup` at spawn time, so demanding them here only made the rig step
  // fail on a blueprint that no longer carries them (PF-1111).
  it('runs on a blueprint carrying only name and role', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      projectType: '3d',
      entityId: 'ent_123',
    }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', expect.objectContaining({
      entityId: 'ent_123',
      componentType: 'character_controller',
    }));
  });

  it('dispatches create_skeleton2d for 2D projects', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Sprite', role: 'player', appearance: 'pixel' },
      projectType: '2d',
      entityId: 'ent_456',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.rigApplied).toBe(true);
    // `set_skeleton_2d` is not a command the engine implements — the rig was
    // never created. `skeletonData` is optional and the engine defaults it.
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('create_skeleton2d', {
      entityId: 'ent_456',
    });
  });

  // The entity is no longer defaulted. A default named 'Player' silently bound
  // the rig to whatever happened to carry that name — or to nothing at all,
  // since the GDD names its own characters.
  it('rejects a step that carries no entity', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      projectType: '3d',
      entityId: 'ent_default',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  // The scene-graph lookup raced the engine: `entity_setup` dispatches
  // `spawn_entity` and the graph is only repopulated once the engine emits
  // back, so this ran against a graph that did not yet hold the entity. The
  // plan mints the id up front precisely so no lookup is needed — a step
  // without one is a wiring bug, and must not be papered over by consulting a
  // store that may or may not have caught up.
  it('does not fall back to a scene-graph name lookup', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'resolved_id', name: 'Player' },
          },
        },
      } as never,
    });

    const result = await characterSetupExecutor.execute({
      entity: { name: 'Player', role: 'player', appearance: 'knight' },
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  // An empty string is a present-but-useless id: the engine's match loops emit
  // nothing on a miss, so dispatching it would be a silent no-op.
  it('rejects an empty entityId', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'knight' },
      projectType: '3d',
      entityId: '',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('rejects invalid projectType', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'knight' },
      projectType: 'vr',
      entityId: 'ent_1',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('accepts custom entity with all fields', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Wizard', role: 'mage', appearance: 'robed' },
      projectType: '3d',
      entityId: 'wizard_1',
      movementType: 'flying',
      systemConfig: { gravity: false },
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityName).toBe('Wizard');
  });

  it('does not dispatch duplicate commands when entityId is provided', async () => {
    const ctx = makeCtx();
    await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'knight' },
      projectType: '3d',
      entityId: 'explicit_id',
    }, ctx);

    // Should only dispatch one command (add_game_component), not spawn
    expect(ctx.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', expect.anything());
  });
});
