import { describe, it, expect, vi } from 'vitest';
import { characterSetupExecutor } from '../characterSetupExecutor';
import type { ExecutorContext } from '../../types';

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: { sceneGraph: { nodes: {} } } as never,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
}

describe('characterSetupExecutor', () => {
  it('has correct name and error message', () => {
    expect(characterSetupExecutor.name).toBe('character_setup');
    expect(characterSetupExecutor.userFacingErrorMessage).toContain('character rig');
  });

  it('adds CharacterController game component for 3D', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'knight', behaviors: ['move', 'jump'] },
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

  it('dispatches create_skeleton2d for 2D projects', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Sprite', role: 'player', appearance: 'pixel', behaviors: ['move'] },
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

  it('uses default entity when none provided', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      projectType: '3d',
      entityId: 'ent_default',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityName).toBe('Player');
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', expect.objectContaining({
      entityId: 'ent_default',
      componentType: 'character_controller',
    }));
  });

  it('looks up entity by name in scene graph when no entityId', async () => {
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
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.entityId).toBe('resolved_id');
  });

  // Previously this fell back to the entity NAME as the id and returned success.
  // The engine matches `add_game_component` on the EntityId component, so a name
  // matches nothing and the engine's match loop emits nothing on a miss — the
  // player silently ended up with no CharacterController and could not move.
  // An unresolvable target is a failure, not a binding to nothing.
  it('fails loudly when the entity resolves to no engine id', async () => {
    const ctx = makeCtx({
      store: {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'other_id', name: 'Enemy' },
          },
        },
      } as never,
    });

    const result = await characterSetupExecutor.execute({
      entity: { name: 'Ghost', role: 'npc', appearance: 'ghost', behaviors: [] },
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENTITY_NOT_FOUND');
    expect(result.error?.message).toContain('Ghost');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('rejects invalid projectType', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      projectType: 'vr',
      entityId: 'ent_1',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('accepts custom entity with all fields', async () => {
    const ctx = makeCtx();
    const result = await characterSetupExecutor.execute({
      entity: { name: 'Wizard', role: 'mage', appearance: 'robed', behaviors: ['cast', 'teleport'] },
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
      projectType: '3d',
      entityId: 'explicit_id',
    }, ctx);

    // Should only dispatch one command (add_game_component), not spawn
    expect(ctx.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', expect.anything());
  });
});
