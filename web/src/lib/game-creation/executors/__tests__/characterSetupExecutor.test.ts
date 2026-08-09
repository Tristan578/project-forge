import { describe, it, expect, vi } from 'vitest';
import { characterSetupExecutor } from '../characterSetupExecutor';
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

  // The feel directive used to die between the two movement steps. The plan
  // pushes `physics_profile` first and `character_setup` second, and
  // `applyPhysicsProfile` only tunes a CharacterController that ALREADY exists
  // — which the player does not yet, at that point. So the controller half of
  // the profile was always skipped, and this executor then created the
  // controller from hardcoded numbers. Every generated 3D game moved
  // identically no matter what the GDD asked for.
  describe('feel directive drives the controller', () => {
    it('derives the controller from the resolved preset', async () => {
      const ctx = makeCtx();
      const result = await characterSetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        projectType: '3d',
        entityId: 'ent_floaty',
        feelDirective: {
          mood: 'dreamy',
          pacing: 'medium',
          weight: 'floaty',
          referenceGames: [],
          oneLiner: 'drifting through the dark',
        },
      }, ctx);

      expect(result.success).toBe(true);
      // floaty + medium -> platformer_floaty: moveSpeed 6, jumpForce 8,
      // gravity 5. gravityScale is gravity/10 — the same conversion
      // `applyPhysicsProfile` uses, so the two paths cannot disagree.
      expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', {
        entityId: 'ent_floaty',
        componentType: 'character_controller',
        properties: { speed: 6, jumpHeight: 8, gravityScale: 0.5, canDoubleJump: false },
      });
    });

    it('produces different movement for a different feel', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Knight', role: 'player' },
        projectType: '3d',
        entityId: 'ent_heavy',
        feelDirective: {
          mood: 'grim',
          pacing: 'medium',
          weight: 'heavy',
          referenceGames: [],
          oneLiner: 'every step costs you',
        },
      }, ctx);

      // heavy + medium -> rpg_weighty: moveSpeed 4, jumpForce 12, gravity 20.
      expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', {
        entityId: 'ent_heavy',
        componentType: 'character_controller',
        properties: { speed: 4, jumpHeight: 12, gravityScale: 2, canDoubleJump: false },
      });
    });

    // [S1] The same safe-override rule `physics_profile` enforces: a
    // user-controlled system config may move speed and jump, never gravity.
    it('applies only the safe systemConfig overrides', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        projectType: '3d',
        entityId: 'ent_cfg',
        systemConfig: { moveSpeed: 11, jumpForce: 3, gravity: 999 },
        feelDirective: {
          mood: 'dreamy',
          pacing: 'medium',
          weight: 'floaty',
          referenceGames: [],
          oneLiner: 'drifting',
        },
      }, ctx);

      expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', {
        entityId: 'ent_cfg',
        componentType: 'character_controller',
        // gravityScale still 0.5 from the preset — config cannot touch it.
        properties: { speed: 11, jumpHeight: 3, gravityScale: 0.5, canDoubleJump: false },
      });
    });

    // A malformed directive must not take the rig down with it — a player that
    // moves at default speed still beats a player with no controller at all.
    it('falls back to the defaults when the directive is unusable', async () => {
      const ctx = makeCtx();
      const result = await characterSetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        projectType: '3d',
        entityId: 'ent_bad',
        feelDirective: { mood: 'odd', pacing: 'glacial', weight: 'gaseous' },
      }, ctx);

      expect(result.success).toBe(true);
      expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', {
        entityId: 'ent_bad',
        componentType: 'character_controller',
        properties: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
      });
    });
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
