import { describe, it, expect, vi } from 'vitest';
import { characterSetupExecutor } from '../characterSetupExecutor';
import type { ExecutorContext } from '../../types';

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

/**
 * The two store actions this executor drives. Both dispatch to the engine
 * themselves (`gameSlice.addGameComponent`, `scriptSlice.setInputPreset`), which
 * is exactly why the executor routes through them instead of calling
 * `ctx.dispatchCommand` directly — one call keeps store and engine in step.
 */
function makeStore(extra: Record<string, unknown> = {}) {
  return {
    sceneGraph: { nodes: {} },
    addGameComponent: vi.fn(),
    setInputPreset: vi.fn(),
    ...extra,
  };
}

type TestStore = ReturnType<typeof makeStore>;

function makeCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = makeStore(), ...rest } = overrides;
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

/** The store the ctx was built with, typed for assertion. */
function storeOf(ctx: ExecutorContext): TestStore {
  return ctx.getStore() as unknown as TestStore;
}

/**
 * The controller the executor produces when no usable feel directive reached it.
 *
 * DERIVED from `arcade_classic` (`DEFAULT_PRESET_KEY`), not a fourth hardcoded
 * table. The executor's own fallback used to be `{ speed: 5, jumpHeight: 2,
 * gravityScale: 1 }`, which had drifted from both `PHYSICS_PRESETS` and the
 * engine's `CharacterControllerData::default()` (`jump_height: 8.0`) — so the
 * no-directive player and the unrecognized-feel player moved differently for no
 * designed reason.
 */
const DEFAULT_PROPS = {
  speed: 7,
  jumpHeight: 10,
  gravityScale: 1,
  canDoubleJump: false,
};

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
    // Asserted whole, not with `objectContaining`. The properties bag IS the
    // behaviour here: `build_game_component` merges each key it recognises onto
    // `CharacterControllerData::default()`, so a dropped key is not rejected —
    // the player silently moves with the ENGINE's number instead of the one the
    // GDD asked for, and `dispatchCommand` returns void so nothing reports it.
    // `objectContaining` is blind to exactly that.
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_123', {
      type: 'characterController',
      characterController: DEFAULT_PROPS,
    });
  });

  // Routed through the store, not `ctx.dispatchCommand`. `addGameComponent`
  // normalizes, writes `allGameComponents`, AND dispatches the same
  // `add_game_component` payload — so dispatching directly left the store with
  // no controller for the generated player: the Inspector showed none, and a
  // later store-driven `update_game_component` (`applyPhysicsProfile`) would
  // reason from a store that disagreed with the engine.
  it('routes the controller through the store rather than a raw dispatch', async () => {
    const ctx = makeCtx();
    await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player' },
      projectType: '3d',
      entityId: 'ent_store',
    }, ctx);

    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledTimes(1);
    expect(ctx.dispatchCommand).not.toHaveBeenCalledWith(
      'add_game_component',
      expect.anything(),
    );
  });

  // A CharacterController with no bindings is still an immovable player. The
  // engine ships an EMPTY `InputMap` (`derive(Default)` + `init_resource`) and
  // `capture_input` iterates `input_map.actions` with no fallback to
  // `default_bindings()`, which is reachable ONLY via `set_input_preset`.
  // Nothing on the generation pipeline ever dispatched it, so every generated
  // game ran `system_character_controller` against an empty `InputState`.
  describe('input bindings', () => {
    it('binds a 3D player to the fps preset', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        projectType: '3d',
        entityId: 'ent_3d',
        movementType: 'walk+jump',
      }, ctx);

      // `fps` is the only preset binding `move_forward`, the action the engine's
      // 3D branch maps onto -Z.
      expect(storeOf(ctx).setInputPreset).toHaveBeenCalledWith('fps');
    });

    it('binds a 2D platformer to the platformer preset', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Sprite', role: 'player' },
        projectType: '2d',
        entityId: 'ent_plat',
        movementType: 'walk+jump',
      }, ctx);

      expect(storeOf(ctx).setInputPreset).toHaveBeenCalledWith('platformer');
    });

    it('binds a 2D top-down player to the topdown preset', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Sprite', role: 'player' },
        projectType: '2d',
        entityId: 'ent_top',
        movementType: 'top-down',
      }, ctx);

      // `topdown` is the only preset binding BOTH `move_horizontal` and
      // `move_vertical` — and `move_vertical` is what the new 2D Y-mapping reads.
      expect(storeOf(ctx).setInputPreset).toHaveBeenCalledWith('topdown');
    });

    it('still binds a preset when the movement type is absent', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        projectType: '3d',
        entityId: 'ent_nomove',
      }, ctx);

      expect(storeOf(ctx).setInputPreset).toHaveBeenCalledWith('fps');
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
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_123', {
      type: 'characterController',
      characterController: DEFAULT_PROPS,
    });
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

  // A skeleton is an animation rig, not a movement component. The 2D branch
  // dispatched only `create_skeleton2d`, so every generated 2D game shipped a
  // player that could not move — and nothing surfaced it, because the missing
  // command is a command never sent (PF-1124).
  //
  // `characterController` is the only option the engine offers, not a 3D
  // convenience: `system_character_controller` is its only input-driven
  // movement system, and `core/commands/sprites.rs` exposes no movement verb at
  // all (`set_2d_body_type` / `set_2d_collider_shape` are rapier2d body and
  // collider config, which no input touches). The engine maps that controller
  // onto Y under `ProjectType::TwoD`.
  describe('2D players get a movement component', () => {
    it('adds the CharacterController alongside the skeleton', async () => {
      const ctx = makeCtx();
      const result = await characterSetupExecutor.execute({
        entity: { name: 'Sprite', role: 'player' },
        projectType: '2d',
        entityId: 'ent_2d',
      }, ctx);

      expect(result.success).toBe(true);
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_2d', {
        type: 'characterController',
        characterController: DEFAULT_PROPS,
      });
      // The skeleton is the only raw dispatch left on this path.
      expect(ctx.dispatchCommand).toHaveBeenCalledTimes(1);
    });

    // One resolver, not a second table: the 2D controller comes from the same
    // `resolvePhysicsProfile` the 3D branch uses, so the two cannot drift.
    it('derives the 2D controller from the feel directive', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Sprite', role: 'player' },
        projectType: '2d',
        entityId: 'ent_2d_floaty',
        feelDirective: {
          mood: 'dreamy',
          pacing: 'medium',
          weight: 'floaty',
          referenceGames: [],
          oneLiner: 'drifting through the dark',
        },
      }, ctx);

      // floaty + medium -> platformer_floaty, identical to the 3D case.
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_2d_floaty', {
        type: 'characterController',
        characterController: {
          speed: 6, jumpHeight: 8, gravityScale: 0.5, canDoubleJump: false,
        },
      });
    });

    it('produces different 2D movement for a different feel', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Knight', role: 'player' },
        projectType: '2d',
        entityId: 'ent_2d_heavy',
        feelDirective: {
          mood: 'grim',
          pacing: 'medium',
          weight: 'heavy',
          referenceGames: [],
          oneLiner: 'every step costs you',
        },
      }, ctx);

      // heavy + medium -> rpg_weighty.
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_2d_heavy', {
        type: 'characterController',
        characterController: {
          speed: 4, jumpHeight: 12, gravityScale: 2, canDoubleJump: false,
        },
      });
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
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
    expect(storeOf(ctx).setInputPreset).not.toHaveBeenCalled();
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
      store: makeStore({
        sceneGraph: {
          nodes: {
            n1: { entityId: 'resolved_id', name: 'Player' },
          },
        },
      }),
    });

    const result = await characterSetupExecutor.execute({
      entity: { name: 'Player', role: 'player', appearance: 'knight' },
      projectType: '3d',
    }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
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
    expect(storeOf(ctx).addGameComponent).not.toHaveBeenCalled();
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
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_floaty', {
        type: 'characterController',
        characterController: {
          speed: 6, jumpHeight: 8, gravityScale: 0.5, canDoubleJump: false,
        },
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
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_heavy', {
        type: 'characterController',
        characterController: {
          speed: 4, jumpHeight: 12, gravityScale: 2, canDoubleJump: false,
        },
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

      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_cfg', {
        type: 'characterController',
        // gravityScale still 0.5 from the preset — config cannot touch it.
        characterController: {
          speed: 11, jumpHeight: 3, gravityScale: 0.5, canDoubleJump: false,
        },
      });
    });

    // A negative speed is not a hypothetical: `systemConfig` is LLM-authored
    // GDD config, and a design phrase like "controls are reversed" is enough to
    // produce it. `Number.isFinite` alone let it through, `prop_f32` clamped it
    // to `0.0`, and the result was the immovable player this whole path exists
    // to fix — with no error raised anywhere.
    it('rejects an out-of-range override instead of clamping it to a standstill', async () => {
      const ctx = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'Hero', role: 'player' },
        projectType: '3d',
        entityId: 'ent_neg',
        systemConfig: { moveSpeed: -8, jumpForce: 0 },
        feelDirective: {
          mood: 'dreamy',
          pacing: 'medium',
          weight: 'floaty',
          referenceGames: [],
          oneLiner: 'drifting',
        },
      }, ctx);

      // Both overrides discarded — the preset's own numbers survive.
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_neg', {
        type: 'characterController',
        characterController: {
          speed: 6, jumpHeight: 8, gravityScale: 0.5, canDoubleJump: false,
        },
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
      expect(storeOf(ctx).addGameComponent).toHaveBeenCalledWith('ent_bad', {
        type: 'characterController',
        characterController: DEFAULT_PROPS,
      });
    });

    // The no-directive fallback and the unrecognized-weight fallback must
    // produce the SAME player. They did not: `resolvePresetFromFeel` answers
    // `arcade_classic` for a weight it does not recognise, while this file's
    // hardcoded default was a third, drifted table. Deriving the default from
    // `DEFAULT_PRESET_KEY` is what makes them agree by construction.
    it('agrees with the unrecognized-feel fallback', async () => {
      const noDirective = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'A', role: 'player' },
        projectType: '3d',
        entityId: 'ent_a',
      }, noDirective);

      const oddWeight = makeCtx();
      await characterSetupExecutor.execute({
        entity: { name: 'B', role: 'player' },
        projectType: '3d',
        entityId: 'ent_b',
        feelDirective: {
          mood: 'odd',
          pacing: 'medium',
          weight: 'gaseous',
          referenceGames: [],
          oneLiner: 'unclassifiable',
        },
      }, oddWeight);

      const props = (store: TestStore) =>
        (store.addGameComponent.mock.calls[0]?.[1] as { characterController: unknown })
          .characterController;

      expect(props(storeOf(noDirective))).toEqual(props(storeOf(oddWeight)));
    });
  });

  it('does not dispatch duplicate commands when entityId is provided', async () => {
    const ctx = makeCtx();
    await characterSetupExecutor.execute({
      entity: { name: 'Hero', role: 'player', appearance: 'knight' },
      projectType: '3d',
      entityId: 'explicit_id',
    }, ctx);

    // The 3D path now dispatches nothing raw — the controller and the bindings
    // both go through store actions that dispatch once each.
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
    expect(storeOf(ctx).addGameComponent).toHaveBeenCalledTimes(1);
    expect(storeOf(ctx).setInputPreset).toHaveBeenCalledTimes(1);
  });
});
