/**
 * Tests for all 8 step executors.
 * [D2] All executors use shared makeStepError helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '../types';
import type { EditorState } from '@/stores/editorStore';
import { EXECUTOR_REGISTRY } from '../executors/index';
import { buildDefaultGroundDescriptor } from '../worldGeometry';
import { jumpForceToApexHeight } from '@/lib/ai/physicsFeel';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(),
}));

// Partial mock: the preset TABLE is stubbed so these tests can pin exact
// numbers, but `jumpForceToApexHeight` is the real one — stubbing it would
// let the module's own unit conversion rot without anything noticing.
vi.mock('@/lib/ai/physicsFeel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/physicsFeel')>()),
  PHYSICS_PRESETS: {
    arcade_classic: {
      name: 'Arcade Classic',
      gravity: 9.81,
      jumpForce: 8,
      moveSpeed: 6,
      friction: 0.5,
      airControl: 0.8,
      terminalVelocity: 20,
      acceleration: 15,
      deceleration: 12,
    },
    platformer_floaty: {
      name: 'Platformer Floaty',
      gravity: 5,
      jumpForce: 10,
      moveSpeed: 5,
      friction: 0.3,
      airControl: 1.0,
      terminalVelocity: 15,
      acceleration: 10,
      deceleration: 8,
    },
    platformer_snappy: {
      name: 'Platformer Snappy',
      gravity: 12,
      jumpForce: 9,
      moveSpeed: 8,
      friction: 0.6,
      airControl: 0.5,
      terminalVelocity: 25,
      acceleration: 20,
      deceleration: 18,
    },
    rpg_weighty: {
      name: 'RPG Weighty',
      gravity: 9.81,
      jumpForce: 6,
      moveSpeed: 4,
      friction: 0.7,
      airControl: 0.3,
      terminalVelocity: 20,
      acceleration: 8,
      deceleration: 10,
    },
    puzzle_precise: {
      name: 'Puzzle Precise',
      gravity: 9.81,
      jumpForce: 7,
      moveSpeed: 5,
      friction: 0.8,
      airControl: 0.4,
      terminalVelocity: 18,
      acceleration: 12,
      deceleration: 14,
    },
    underwater: {
      name: 'Underwater',
      gravity: 3,
      jumpForce: 5,
      moveSpeed: 3,
      friction: 0.9,
      airControl: 1.0,
      terminalVelocity: 8,
      acceleration: 6,
      deceleration: 8,
    },
    space_zero_g: {
      name: 'Space Zero G',
      gravity: 0,
      jumpForce: 0,
      moveSpeed: 5,
      friction: 0,
      airControl: 1.0,
      terminalVelocity: 50,
      acceleration: 5,
      deceleration: 5,
    },
  },
  applyPhysicsProfile: vi.fn(),
}));

vi.mock('@/lib/ai/autoRigging', () => ({
  generateRig: vi.fn().mockResolvedValue({
    type: 'humanoid',
    bones: [],
    ikChains: [],
  }),
  rigToCommands: vi.fn().mockReturnValue([
    { command: 'create_skeleton2d', payload: { skeletonData: { bones: [] } } },
  ]),
}));

vi.mock('@/lib/ai/contentSafety', () => ({
  sanitizePrompt: vi.fn().mockImplementation((text: string, _maxLen?: number) => ({
    safe: true,
    filtered: text,
    reason: undefined,
  })),
}));

vi.mock('@/lib/ai/models', () => ({
  AI_MODEL_PRIMARY: 'claude-sonnet-4-6',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockStore(overrides: Partial<EditorState> = {}): EditorState {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    primaryPhysics: null,
    physicsEnabled: false,
    debugPhysics: false,
    // scene_create mirrors the JS-side scene list into the store (PF-1097) and
    // clears the starter scene through the slice, not a raw dispatch, so the
    // staged scene audio is dropped with it (PF-1155).
    setScenes: vi.fn(),
    newScene: vi.fn(),
    // character_setup routes the controller and the input bindings through the
    // store rather than dispatching them itself, so store and engine cannot
    // drift apart (PF-1124). Both of these actions dispatch.
    addGameComponent: vi.fn(),
    setInputPreset: vi.fn(),
    ...overrides,
  } as unknown as EditorState;
}

/**
 * `store` is a TEST-ONLY override key: it seeds what `ctx.getStore()` returns.
 * `ExecutorContext` itself has no `store` field — executors must read the live
 * store through `getStore()`, never a snapshot (PF-1118).
 */
type CtxOverrides = Partial<ExecutorContext> & { store?: unknown };

function makeMockCtx(overrides: CtxOverrides = {}): ExecutorContext {
  const { store = makeMockStore(), ...rest } = overrides;
  const ctx: ExecutorContext = {
    dispatchCommand: vi.fn(),
    getStore: () => store as ReturnType<ExecutorContext['getStore']>,
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    resolveStepOutputs: vi.fn(() => []),
    ...rest,
  };
  return ctx;
}

beforeEach(() => {
  vi.resetModules();
  // scene_create persists through lib/scenes/sceneManager, which is localStorage-backed.
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// scene_create executor
// ---------------------------------------------------------------------------

describe('scene_create executor', () => {
  const executor = EXECUTOR_REGISTRY.get('scene_create')!;

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('scene_create');
  });

  // `create_scene` is an engine stub that rejects by design — scenes are JS-side
  // (`lib/scenes/sceneManager`) — so dispatching it was a silent no-op (PF-1097).
  it('records the scene JS-side and clears the starter scene on happy path', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ name: 'Level 1', purpose: 'Main game level' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['sceneName']).toBe('Level 1');
    expect(ctx.getStore().setScenes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Level 1' })]),
      expect.any(String),
    );
    expect(ctx.getStore().newScene).toHaveBeenCalled();
    expect(ctx.dispatchCommand).not.toHaveBeenCalledWith('new_scene', {});
    expect(ctx.dispatchCommand).not.toHaveBeenCalledWith('create_scene', expect.anything());
  });

  it('fails with INVALID_INPUT when name is empty', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ name: '', purpose: 'test' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('uses default name when name is missing (system registry overlay)', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ purpose: 'test' }, ctx);

    // When called from system registry (camera/world), name defaults to 'Untitled Scene'
    expect(result.success).toBe(true);
    expect(result.output?.['sceneName']).toBe('Untitled Scene');
    expect(ctx.getStore().setScenes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Untitled Scene' })]),
      expect.any(String),
    );
  });

  it('returns ABORTED when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeMockCtx({ signal: controller.signal });
    const result = await executor.execute({ name: 'Level 1', purpose: 'test' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ABORTED');
  });
});

// ---------------------------------------------------------------------------
// physics_profile executor
// ---------------------------------------------------------------------------

describe('physics_profile executor', () => {
  const executor = EXECUTOR_REGISTRY.get('physics_profile')!;

  const baseInput = {
    feelDirective: {
      mood: 'exciting',
      pacing: 'fast' as const,
      weight: 'light' as const,
      referenceGames: [],
      oneLiner: 'Fast and light',
    },
    projectType: '3d' as const,
  };

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('physics_profile');
  });

  it('returns success with presetUsed and entityCount=0 when no entityIds', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['entityCount']).toBe(0);
    expect(result.output?.['presetUsed']).toBeTruthy();
  });

  it('calls applyPhysicsProfile when entityIds provided', async () => {
    const { applyPhysicsProfile } = await import('@/lib/ai/physicsFeel');
    const ctx = makeMockCtx();
    const input = { ...baseInput, entityIds: ['entity-1', 'entity-2'] };
    const result = await executor.execute(input, ctx);

    expect(result.success).toBe(true);
    expect(applyPhysicsProfile).toHaveBeenCalled();
    expect(result.output?.['entityCount']).toBe(2);
  });

  it('maps floaty+slow to space_zero_g preset', async () => {
    const ctx = makeMockCtx();
    const input = {
      ...baseInput,
      feelDirective: { ...baseInput.feelDirective, weight: 'floaty' as const, pacing: 'slow' as const },
    };
    const result = await executor.execute(input, ctx);

    expect(result.output?.['presetUsed']).toBe('space_zero_g');
  });

  it('maps heavy+fast to rpg_weighty preset', async () => {
    const ctx = makeMockCtx();
    const input = {
      ...baseInput,
      feelDirective: { ...baseInput.feelDirective, weight: 'heavy' as const, pacing: 'fast' as const },
    };
    const result = await executor.execute(input, ctx);

    expect(result.output?.['presetUsed']).toBe('rpg_weighty');
  });

  it('[S1] allows moveSpeed config override but not gravity', async () => {
    const { applyPhysicsProfile } = await import('@/lib/ai/physicsFeel');
    vi.mocked(applyPhysicsProfile).mockClear();
    const ctx = makeMockCtx();
    const input = {
      ...baseInput,
      entityIds: ['entity-1'],
      config: { moveSpeed: 12, gravity: 999 },
    };
    const result = await executor.execute(input, ctx);

    expect(result.success).toBe(true);
    const callArg = vi.mocked(applyPhysicsProfile).mock.calls[0]?.[0];
    expect(callArg?.moveSpeed).toBe(12);
    expect(callArg?.gravity).not.toBe(999);
  });

  it('fails with INVALID_INPUT when feelDirective missing', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ projectType: '3d' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// character_setup executor
// ---------------------------------------------------------------------------

describe('character_setup executor', () => {
  const executor = EXECUTOR_REGISTRY.get('character_setup')!;

  const baseEntity = {
    name: 'Player',
    role: 'player',
    appearance: 'humanoid character',
  };

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('character_setup');
  });

  // `arcade_classic` (`DEFAULT_PRESET_KEY`) as this file MOCKS it above, run
  // through `characterControllerFromProfile` — `gravityScale` is `gravity / 10`,
  // spelled as the division so the value cannot drift on float rounding.
  //
  // Asserted whole rather than as `expect.any(Number)` because the NUMBERS are
  // the behaviour here: the engine merges each recognised key onto
  // `CharacterControllerData::default()`, so a dropped or misspelled field
  // silently keeps an engine default and nothing anywhere reports it (see
  // `rules/gotchas.md` → the `dispatchCommand` class).
  //
  // `jumpHeight` is the preset's `jumpForce` dial converted by
  // `jumpForceToApexHeight` — the engine reads the field as a real height in
  // metres, so the raw dial asked for an 8-metre jump (PF-1214, finding #1).
  // The conversion itself is pinned in `lib/ai/__tests__/physicsFeelJump.test.ts`;
  // spelling it as a call here keeps this expectation about the preset choice.
  const DEFAULT_CONTROLLER = {
    speed: 6,
    jumpHeight: jumpForceToApexHeight(8, 9.81 / 10),
    gravityScale: 9.81 / 10,
    canDoubleJump: false,
  };

  it('adds the CharacterController through the store for 3D', async () => {
    const store = makeMockStore();
    const ctx = makeMockCtx({ projectType: '3d', store });
    const result = await executor.execute(
      { entity: baseEntity, projectType: '3d', entityId: 'entity-1' },
      ctx,
    );

    expect(result.success).toBe(true);
    // `addGameComponent` is what dispatches `add_game_component`; going through
    // it keeps `allGameComponents` in step with the engine, which a raw dispatch
    // did not.
    expect(store.addGameComponent).toHaveBeenCalledWith('entity-1', {
      type: 'characterController',
      characterController: DEFAULT_CONTROLLER,
    });
    expect(result.output?.['rigApplied']).toBe(false);
  });

  // A controller with no bindings is still an immovable player: the engine ships
  // an EMPTY `InputMap` and `capture_input` has no fallback to
  // `default_bindings()`, so nothing drives the controller until
  // `set_input_preset` is dispatched.
  it('binds the input preset for the project type', async () => {
    const store = makeMockStore();
    const ctx = makeMockCtx({ projectType: '3d', store });
    await executor.execute(
      { entity: baseEntity, projectType: '3d', entityId: 'entity-1' },
      ctx,
    );

    expect(store.setInputPreset).toHaveBeenCalledWith('fps');
  });

  it('dispatches create_skeleton2d for 2D', async () => {
    const store = makeMockStore();
    const ctx = makeMockCtx({ projectType: '2d', store });
    const result = await executor.execute(
      { entity: baseEntity, projectType: '2d', entityId: 'entity-1' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('create_skeleton2d', expect.any(Object));
    expect(store.addGameComponent).toHaveBeenCalledWith('entity-1', {
      type: 'characterController',
      characterController: DEFAULT_CONTROLLER,
    });
    expect(store.setInputPreset).toHaveBeenCalledWith('topdown');
    expect(result.output?.['rigApplied']).toBe(true);
  });

  // The store lookup used to be the fallback when a step carried no entityId,
  // and it raced the engine: `entity_setup` dispatches `spawn_entity` and the
  // scene graph is only repopulated when the engine emits back, so the lookup
  // ran against a graph that did not yet hold the entity. The plan mints the id
  // up front so no lookup is needed — even a store that HAS the node must not
  // rescue a step that arrived without one.
  it('never consults the scene graph, even when it holds a matching node', async () => {
    const ctx = makeMockCtx({
      store: makeMockStore({
        sceneGraph: {
          nodes: { n1: { entityId: 'resolved-uuid', name: 'Player' } },
          rootIds: ['n1'],
        },
      } as unknown as Partial<EditorState>),
    });
    const result = await executor.execute(
      { entity: baseEntity, projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('rejects a step that carries no entity', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ projectType: '3d', entityId: 'e1' }, ctx);

    // A default player entity would bind the rig to a name the GDD never used.
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entity_setup executor
// ---------------------------------------------------------------------------

describe('entity_setup executor', () => {
  const executor = EXECUTOR_REGISTRY.get('entity_setup')!;

  const baseEntity = {
    name: 'Enemy',
    role: 'enemy' as const,
    appearance: 'goblin',
  };

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('entity_setup');
  });

  it('dispatches spawn_entity on happy path (3D)', async () => {
    const ctx = makeMockCtx({ projectType: '3d' });
    const result = await executor.execute(
      { entity: baseEntity, scene: 'Level 1', projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(true);
    // The engine rejects `switch_scene` by design; leading with it failed every
    // entity step in the pipeline (PF-1097).
    expect(ctx.dispatchCommand).not.toHaveBeenCalledWith('switch_scene', expect.anything());
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', expect.objectContaining({
      name: 'Enemy',
      entityType: 'cube',
    }));
    expect(result.output?.['entityName']).toBe('Enemy');
    expect(result.output?.['role']).toBe('enemy');
  });

  it('uses plane entity type for 2D', async () => {
    const ctx = makeMockCtx({ projectType: '2d' });
    const result = await executor.execute(
      { entity: baseEntity, scene: 'Level 1', projectType: '2d' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output?.['entityType']).toBe('plane');
  });

  it('uses sphere entity type for projectile role', async () => {
    const projectileEntity = { ...baseEntity, role: 'projectile' as const };
    const ctx = makeMockCtx({ projectType: '3d' });
    const result = await executor.execute(
      { entity: projectileEntity, scene: 'Level 1', projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output?.['entityType']).toBe('sphere');
  });

  it('fails with INVALID_INPUT when scene is missing', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(
      { entity: baseEntity, projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('uses dispatchCommandBatch when available', async () => {
    const batchFn = vi.fn().mockReturnValue({
      success: true,
      results: [{ success: true }, { success: true }],
    });
    const ctx = makeMockCtx({ dispatchCommandBatch: batchFn });
    const result = await executor.execute(
      { entity: baseEntity, scene: 'Level 1', projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(batchFn).toHaveBeenCalledWith([
      { command: 'spawn_entity', payload: { entityType: 'cube', name: 'Enemy' } },
    ]);
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('falls back to sequential dispatch when batch unavailable', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(
      { entity: baseEntity, scene: 'Level 1', projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledTimes(1);
  });

  it('returns failure when batch reports a command error', async () => {
    const batchFn = vi.fn().mockReturnValue({
      success: false,
      results: [{ success: true }, { success: false, error: 'Entity limit reached' }],
    });
    const ctx = makeMockCtx({ dispatchCommandBatch: batchFn });
    const result = await executor.execute(
      { entity: baseEntity, scene: 'Level 1', projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });
});

// ---------------------------------------------------------------------------
// asset_generate executor
// ---------------------------------------------------------------------------

describe('asset_generate executor', () => {
  const executor = EXECUTOR_REGISTRY.get('asset_generate')!;

  const baseInput = {
    type: 'texture' as const,
    description: 'A stone wall texture',
    styleDirective: 'medieval stone',
    priority: 'required' as const,
    fallback: 'primitive:cube',
  };

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('asset_generate');
  });

  it('succeeds with assetId and usedFallback=false on happy path', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(typeof result.output?.['assetId']).toBe('string');
    expect(result.output?.['usedFallback']).toBe(false);
  });

  it('uses fallback when signal is aborted before execution', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeMockCtx({ signal: controller.signal });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['usedFallback']).toBe(true);
    expect(result.output?.['assetId']).toBe('primitive:cube');
  });

  it('fails with INVALID_FALLBACK when fallback does not match schema', async () => {
    const ctx = makeMockCtx();
    const input = { ...baseInput, fallback: 'invalid-fallback' };
    const result = await executor.execute(input, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_FALLBACK');
  });

  it('accepts builtin: prefix fallback', async () => {
    const ctx = makeMockCtx();
    const input = { ...baseInput, fallback: 'builtin:stone-texture' };
    const result = await executor.execute(input, ctx);

    expect(result.success).toBe(true);
  });

  it('fails with INVALID_INPUT when type is unknown', async () => {
    const ctx = makeMockCtx();
    const input = { ...baseInput, type: 'video' };
    const result = await executor.execute(input, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// custom_script_generate executor
// ---------------------------------------------------------------------------

describe('custom_script_generate executor', () => {
  const executor = EXECUTOR_REGISTRY.get('custom_script_generate')!;

  const baseInput = {
    system: {
      category: 'movement' as const,
      type: 'walk',
      config: { speed: 5, jumpHeight: 2 },
    },
    description: 'Move the player with WASD keys',
    targetEntityId: 'player-entity-1',
    projectType: '3d' as const,
  };

  // A minimal valid script that uses 2 namespaces and is under 30 lines
  const validScript = [
    'let speed = 5;',
    'function onUpdate(dt) {',
    '  if (forge.input.isKeyDown("w")) {',
    '    const pos = forge.entity.getPosition("player");',
    '    forge.entity.setPosition("player", pos[0], pos[1], pos[2] - speed * dt);',
    '  }',
    '}',
  ].join('\n');

  // A script that uses 6+ namespaces (low confidence)
  const complexScript = [
    'function onUpdate(dt) {',
    '  forge.entity.setPosition("e1", 0, 0, 0);',
    '  forge.input.isKeyDown("w");',
    '  forge.physics.applyForce("e1", 0, 1, 0);',
    '  forge.audio.play("e1");',
    '  forge.scene.load("next");',
    '  forge.ui.setText("score", "100");',
    '}',
  ].join('\n');

  beforeEach(async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    vi.mocked(fetchAI).mockResolvedValue(validScript);

    const { sanitizePrompt } = await import('@/lib/ai/contentSafety');
    vi.mocked(sanitizePrompt).mockImplementation((text: string) => ({
      safe: true,
      filtered: text,
      reason: undefined,
    }));
  });

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('custom_script_generate');
  });

  it('dispatches set_script (not update_script) on success [NB1]', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_script', expect.objectContaining({
      entityId: 'player-entity-1',
      source: expect.any(String),
      enabled: true,
    }));
    // Must NOT call update_script
    const calls = vi.mocked(ctx.dispatchCommand).mock.calls;
    expect(calls.every(([cmd]) => cmd !== 'update_script')).toBe(true);
  });

  it('returns confidence=high for simple script', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['confidence']).toBe('high');
  });

  it('returns confidence=low for complex script (many namespaces)', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    vi.mocked(fetchAI).mockResolvedValue(complexScript);

    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.output?.['confidence']).toBe('low');
  });

  it('fails with SCRIPT_VALIDATION_FAILED when generated script uses forbidden globals [B6]', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    // Script uses globalThis which is forbidden
    vi.mocked(fetchAI).mockResolvedValue('function onStart() { globalThis.x = 1; }');

    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SCRIPT_VALIDATION_FAILED');
    expect(result.error?.retryable).toBe(true);
  });

  it('fails with SCRIPT_VALIDATION_FAILED when script has no onStart or onUpdate', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    vi.mocked(fetchAI).mockResolvedValue('const x = 5;');

    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SCRIPT_VALIDATION_FAILED');
  });

  it('fails with UNSAFE_INPUT when description is flagged', async () => {
    const { sanitizePrompt } = await import('@/lib/ai/contentSafety');
    vi.mocked(sanitizePrompt).mockReturnValueOnce({
      safe: false,
      reason: 'Contains injection attempt',
      filtered: undefined,
    });

    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNSAFE_INPUT');
  });

  it('fails with AI_CALL_FAILED (retryable) when fetchAI throws', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    vi.mocked(fetchAI).mockRejectedValue(new Error('Network error'));

    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AI_CALL_FAILED');
    expect(result.error?.retryable).toBe(true);
  });

  it('[NS1] sanitizes config values, excludes objects', async () => {
    const { sanitizePrompt } = await import('@/lib/ai/contentSafety');
    const sanitizeSpy = vi.mocked(sanitizePrompt);
    sanitizeSpy.mockClear();
    sanitizeSpy.mockImplementation((text: string) => ({
      safe: true,
      filtered: text,
      reason: undefined,
    }));

    const inputWithNestedConfig = {
      ...baseInput,
      system: {
        ...baseInput.system,
        config: {
          speed: 5,
          label: 'fast movement',
          nested: { dangerous: 'injection' },
          array: ['a', 'b'],
        },
      },
    };

    const ctx = makeMockCtx();
    await executor.execute(inputWithNestedConfig, ctx);

    const configSanitizeCalls = sanitizeSpy.mock.calls.filter(
      ([text]) => text === 'fast movement',
    );
    expect(configSanitizeCalls.length).toBeGreaterThan(0);
  });

  it('strips markdown fences from generated script', async () => {
    const { fetchAI } = await import('@/lib/ai/client');
    vi.mocked(fetchAI).mockResolvedValue(
      '```typescript\nfunction onUpdate(dt) { forge.entity.getPosition("e"); }\n```',
    );

    const ctx = makeMockCtx();
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    const scriptPayload = vi.mocked(ctx.dispatchCommand).mock.calls.find(
      ([cmd]) => cmd === 'set_script',
    )?.[1] as Record<string, unknown> | undefined;
    expect(scriptPayload?.['source']).not.toContain('```');
  });

  it('fails with INVALID_INPUT when description is empty', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ ...baseInput, description: '' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// auto_polish executor
// ---------------------------------------------------------------------------

describe('auto_polish executor', () => {
  const executor = EXECUTOR_REGISTRY.get('auto_polish')!;

  const baseInput = {
    projectType: '3d' as const,
    feelDirective: {
      mood: 'exciting',
      pacing: 'fast' as const,
      weight: 'light' as const,
      referenceGames: [],
      oneLiner: 'Fast and light',
    },
  };

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('auto_polish');
  });

  it('returns success with empty fixesApplied when no issues', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: [], passed: true });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['fixesApplied']).toEqual([]);
    expect(result.output?.['fixCount']).toBe(0);
  });

  it('dispatches update_ambient_light (not set_ambient_light) for no_ambient_light [NB4]', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: ['no_ambient_light'] });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('update_ambient_light', {
      color: [1, 1, 1],
      brightness: 0.3,
    });
    const calls = vi.mocked(ctx.dispatchCommand).mock.calls;
    expect(calls.every(([cmd]) => cmd !== 'set_ambient_light')).toBe(true);
  });

  it('configures camera via set_game_camera for no_camera_on_player', async () => {
    // Provide a Camera node in the store (every scene has one by default)
    const storeWithCamera = makeMockStore({
      sceneGraph: {
        nodes: { cam1: { entityId: 'cam-entity-1', name: 'Camera' } },
        rootIds: ['cam1'],
      } as unknown as EditorState['sceneGraph'],
    });
    const ctx = makeMockCtx({ projectType: '2d', store: storeWithCamera });
    // Answered PER STEP NAME. A blanket mock hands the verify output to every
    // lookup, so `character_setup` comes back without an `entityId` and the
    // camera silently ends up following nothing.
    vi.mocked(ctx.resolveStepOutput).mockImplementation((name: string) =>
      name === 'verify_all_scenes'
        ? { issues: ['no_camera_on_player'] }
        : { entityId: 'player-entity-1' },
    );
    const result = await executor.execute({ ...baseInput, projectType: '2d' }, ctx);

    expect(result.success).toBe(true);
    // Full shape, not `objectContaining`: SideScroller's engine update arm is
    // skipped entirely when `target_entity` is `None`, so a missing target is
    // the difference between a working camera and a motionless one — and a
    // partial matcher is blind to exactly that.
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', {
      entityId: 'cam-entity-1',
      mode: 'sideScroller', // 2D project type
      targetEntity: 'player-entity-1',
    });
    const fixes = result.output?.['fixesApplied'] as string[];
    expect(fixes).toContain('Configured camera as sideScroller');
  });

  it('dispatches a ground plane WITH a collider for no_ground_plane', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: ['no_ground_plane'] });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);

    // A mesh with no Rapier collider is not a floor: `manage_physics_lifecycle`
    // only builds one for an entity carrying `PhysicsEnabled`, and `auto_polish`
    // runs after `physics_enable`, so nothing downstream covers for it.
    const calls = vi.mocked(ctx.dispatchCommand).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      'spawn_entity', 'update_transform', 'toggle_physics', 'update_physics',
    ]);

    // FULL payloads. The id is minted by the executor rather than left to the
    // engine — `spawn_entity` invents a UUID the caller never learns, which
    // would leave the three commands below with no entity to name.
    //
    // Checked against the descriptor `world_build` would have used rather than
    // a second hand-written one: the repair and the builder must not disagree
    // about what "the ground" is, and a literal here is how they drift.
    const expected = buildDefaultGroundDescriptor('3d');
    const spawn = calls[0][1] as Record<string, unknown>;
    expect(spawn).toEqual({
      id: expect.any(String),
      // A `cube`, not a `plane`: the engine has no plane collider, so a
      // zero-thickness quad would be a mesh describing something the physics
      // does not.
      entityType: expected.entityType,
      name: expected.name,
      // Half a thickness below the origin, which is what puts the collider's
      // top face flush with y=0 instead of floating 0.5 above it.
      position: expected.position,
    });
    expect(expected.position).toEqual([0, -0.5, 0]);
    const groundId = spawn['id'];

    // THE ASSERTION THIS TEST EXISTS FOR: the collider matches the mesh.
    // `make_collider` takes its half-extents from `transform.scale` and
    // `spawn_entity` has no scale field, so without this command the "floor" is
    // a 1x1x1 box at the origin — the player is supported within half a metre
    // and falls through everywhere else, while the fix list says "Added ground
    // plane".
    expect(calls[1][1]).toEqual({ entityId: groundId, scale: expected.scale });
    expect(expected.scale).toEqual([40, 1, 40]);

    expect(calls[2][1]).toEqual({ entityId: groundId, enabled: true });
    expect(calls[3][1]).toEqual({
      entityId: groundId,
      bodyType: 'fixed',
      colliderShape: 'cuboid',
      isSensor: false,
    });
  });

  it('handles multiple issues, applies all fixes', async () => {
    const storeWithCamera = makeMockStore({
      sceneGraph: {
        nodes: { cam1: { entityId: 'cam-1', name: 'Camera' } },
        rootIds: ['cam1'],
      } as unknown as EditorState['sceneGraph'],
    });
    const ctx = makeMockCtx({ store: storeWithCamera });
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({
      issues: ['no_ambient_light', 'no_camera_on_player'],
    });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect((result.output?.['fixesApplied'] as string[]).length).toBe(2);
    expect(result.output?.['fixCount']).toBe(2);
  });

  it('[B4] uses resolveStepOutput to get structural issues, not telemetry', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: [] });
    await executor.execute(baseInput, ctx);

    expect(ctx.resolveStepOutput).toHaveBeenCalledWith('verify_all_scenes');
  });

  it('fails with INVALID_INPUT when projectType is missing', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(
      { feelDirective: baseInput.feelDirective },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('uses dispatchCommandBatch when available', async () => {
    const batchFn = vi.fn().mockReturnValue({
      success: true,
      results: [{ success: true }, { success: true }],
    });
    const ctx = makeMockCtx({ dispatchCommandBatch: batchFn });
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({
      issues: ['no_ambient_light', 'no_ground_plane'],
    });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);

    // Three batches, not one: the ground's toggle and patch are separated from
    // the spawn (and from each other) by an engine frame, because Bevy's
    // deferred `Commands` are flushed only at an ordering edge —
    // `apply_physics_toggles` drains a toggle for an entity that does not exist
    // yet and `apply_physics_updates` drops a patch with no `PhysicsData`.
    const batches = batchFn.mock.calls;
    expect(batches.length).toBe(3);

    const expected = buildDefaultGroundDescriptor('3d');
    const first = batches[0][0] as Array<{ command: string; payload: Record<string, unknown> }>;
    expect(first.map(entry => entry.command)).toEqual(['update_ambient_light', 'spawn_entity']);
    expect(first[0].payload).toEqual({ color: [1, 1, 1], brightness: 0.3 });
    expect(first[1].payload).toEqual({
      id: expect.any(String),
      entityType: expected.entityType,
      name: expected.name,
      position: expected.position,
    });

    const groundId = first[1].payload['id'];
    // Sizing rides the toggle's batch: the two are independent of each other
    // and both need only that the spawn has been flushed. The scale must land
    // before Play, because the collider is built from `transform.scale` at the
    // Edit→Play transition and is never resized after.
    expect(batches[1][0]).toEqual([
      { command: 'update_transform', payload: { entityId: groundId, scale: expected.scale } },
      { command: 'toggle_physics', payload: { entityId: groundId, enabled: true } },
    ]);
    expect(batches[2][0]).toEqual([
      {
        command: 'update_physics',
        payload: { entityId: groundId, bodyType: 'fixed', colliderShape: 'cuboid', isSensor: false },
      },
    ]);
    expect(ctx.dispatchCommand).not.toHaveBeenCalled();
  });

  it('returns failure when batch reports a command error', async () => {
    const batchFn = vi.fn().mockReturnValue({
      success: false,
      results: [{ success: false, error: 'Ambient light failed' }],
    });
    const ctx = makeMockCtx({ dispatchCommandBatch: batchFn });
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({
      issues: ['no_ambient_light'],
    });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('falls back to sequential dispatch when batch unavailable', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({
      issues: ['no_ambient_light', 'no_ground_plane'],
    });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);

    // Five, not two: the repaired ground carries its own sizing, toggle and patch.
    const calls = vi.mocked(ctx.dispatchCommand).mock.calls;
    expect(calls.map(([command]) => command)).toEqual([
      'update_ambient_light', 'spawn_entity', 'update_transform', 'toggle_physics', 'update_physics',
    ]);
  });
});
