/**
 * Tests for all 8 step executors.
 * [D2] All executors use shared makeStepError helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '../types';
import type { EditorState } from '@/stores/editorStore';
import { EXECUTOR_REGISTRY } from '../executors/index';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(),
}));

vi.mock('@/lib/ai/physicsFeel', () => ({
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
    { command: 'set_skeleton_2d', payload: { bones: [] } },
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
  AI_MODEL_PRIMARY: 'claude-3-5-sonnet-20241022',
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
    ...overrides,
  } as unknown as EditorState;
}

function makeMockCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    store: makeMockStore(),
    projectType: '3d',
    userTier: 'creator',
    signal: new AbortController().signal,
    resolveStepOutput: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scene_create executor
// ---------------------------------------------------------------------------

describe('scene_create executor', () => {
  const executor = EXECUTOR_REGISTRY.get('scene_create')!;

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('scene_create');
  });

  it('dispatches new_scene and rename_scene on happy path', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ name: 'Level 1', purpose: 'Main game level' }, ctx);

    expect(result.success).toBe(true);
    expect(result.output?.['sceneName']).toBe('Level 1');
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('new_scene', expect.any(Object));
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('rename_scene', { name: 'Level 1' });
  });

  it('fails with INVALID_INPUT when name is empty', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ name: '', purpose: 'test' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('fails with INVALID_INPUT when name is missing', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ purpose: 'test' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
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
    behaviors: ['jump', 'run'],
  };

  it('is registered', () => {
    expect(executor).toBeDefined();
    expect(executor.name).toBe('character_setup');
  });

  it('dispatches add_game_component for 3D', async () => {
    const ctx = makeMockCtx({ projectType: '3d' });
    const result = await executor.execute(
      { entity: baseEntity, projectType: '3d', entityId: 'entity-1' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('add_game_component', expect.objectContaining({
      entityId: 'entity-1',
      componentType: 'character_controller',
    }));
    expect(result.output?.['rigApplied']).toBe(false);
  });

  it('dispatches set_skeleton_2d for 2D', async () => {
    const ctx = makeMockCtx({ projectType: '2d' });
    const result = await executor.execute(
      { entity: baseEntity, projectType: '2d', entityId: 'entity-1' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_skeleton_2d', expect.any(Object));
    expect(result.output?.['rigApplied']).toBe(true);
  });

  it('fails with MISSING_ENTITY when entityId not provided', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute(
      { entity: baseEntity, projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_ENTITY');
  });

  it('fails with INVALID_INPUT when entity missing', async () => {
    const ctx = makeMockCtx();
    const result = await executor.execute({ projectType: '3d', entityId: 'e1' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
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
    behaviors: ['patrol'],
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
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', expect.objectContaining({
      name: 'Enemy',
      scene: 'Level 1',
    }));
    expect(result.output?.['entityName']).toBe('Enemy');
    expect(result.output?.['role']).toBe('enemy');
  });

  it('uses Sprite entity type for 2D', async () => {
    const ctx = makeMockCtx({ projectType: '2d' });
    const result = await executor.execute(
      { entity: baseEntity, scene: 'Level 1', projectType: '2d' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output?.['entityType']).toBe('Sprite');
  });

  it('uses Sphere entity type for projectile role', async () => {
    const projectileEntity = { ...baseEntity, role: 'projectile' as const };
    const ctx = makeMockCtx({ projectType: '3d' });
    const result = await executor.execute(
      { entity: projectileEntity, scene: 'Level 1', projectType: '3d' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.output?.['entityType']).toBe('Sphere');
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

  it('dispatches set_game_camera with SideScroller for 2D', async () => {
    const ctx = makeMockCtx({ projectType: '2d' });
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: ['no_camera_on_player'] });
    const result = await executor.execute({ ...baseInput, projectType: '2d' }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', expect.objectContaining({
      mode: 'SideScroller',
    }));
  });

  it('dispatches set_game_camera with ThirdPerson for 3D', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: ['no_camera_on_player'] });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('set_game_camera', expect.objectContaining({
      mode: 'ThirdPerson',
    }));
  });

  it('dispatches spawn_entity ground plane for no_ground_plane', async () => {
    const ctx = makeMockCtx();
    vi.mocked(ctx.resolveStepOutput).mockReturnValue({ issues: ['no_ground_plane'] });
    const result = await executor.execute(baseInput, ctx);

    expect(result.success).toBe(true);
    expect(ctx.dispatchCommand).toHaveBeenCalledWith('spawn_entity', expect.objectContaining({
      name: 'Ground',
    }));
  });

  it('handles multiple issues, applies all fixes', async () => {
    const ctx = makeMockCtx();
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
});
