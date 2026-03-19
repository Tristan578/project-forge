import { describe, it, expect } from 'vitest';
import {
  CAMERA_PRESETS,
  PRESET_KEYS,
  detectOptimalCamera,
  cameraToCommands,
  interpolatePresets,
  smartModeToEngine,
  type CameraPreset,
  type SmartCameraSceneContext,
} from '../smartCamera';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<SmartCameraSceneContext> = {}): SmartCameraSceneContext {
  return {
    entityNames: [],
    componentTypes: [],
    gameCameraModes: [],
    gameComponentTypes: [],
    projectType: '3d',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Preset registry
// ---------------------------------------------------------------------------

describe('CAMERA_PRESETS', () => {
  it('contains at least 8 presets', () => {
    expect(PRESET_KEYS.length).toBeGreaterThanOrEqual(8);
  });

  it('has all required presets', () => {
    const required = [
      'platformer_2d', 'platformer_3d', 'fps_shooter', 'rpg_exploration',
      'top_down_strategy', 'racing', 'puzzle', 'horror',
    ];
    for (const key of required) {
      expect(CAMERA_PRESETS).toHaveProperty(key);
    }
  });

  it('every preset has required fields', () => {
    for (const key of PRESET_KEYS) {
      const preset = CAMERA_PRESETS[key];
      expect(preset.name).toBeTruthy();
      expect(preset.genre).toBeTruthy();
      expect(preset.mode).toBeTruthy();
      expect(typeof preset.followDistance).toBe('number');
      expect(typeof preset.followHeight).toBe('number');
      expect(typeof preset.followSmoothing).toBe('number');
      expect(typeof preset.fov).toBe('number');
      expect(typeof preset.lookAhead).toBe('number');
      expect(preset.deadZone).toBeDefined();
      expect(typeof preset.deadZone.x).toBe('number');
      expect(typeof preset.deadZone.y).toBe('number');
      expect(preset.shake).toBeDefined();
      expect(typeof preset.shake.enabled).toBe('boolean');
    }
  });

  it('fps_shooter has narrow FOV', () => {
    expect(CAMERA_PRESETS['fps_shooter'].fov).toBe(70);
  });

  it('rpg_exploration has wide FOV', () => {
    expect(CAMERA_PRESETS['rpg_exploration'].fov).toBe(75);
  });

  it('horror has close follow distance', () => {
    expect(CAMERA_PRESETS['horror'].followDistance).toBeLessThan(5);
  });

  it('top_down_strategy has bounds', () => {
    expect(CAMERA_PRESETS['top_down_strategy'].bounds).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// smartModeToEngine
// ---------------------------------------------------------------------------

describe('smartModeToEngine', () => {
  it('maps follow to thirdPersonFollow', () => {
    expect(smartModeToEngine('follow')).toBe('thirdPersonFollow');
  });

  it('maps first_person to firstPerson', () => {
    expect(smartModeToEngine('first_person')).toBe('firstPerson');
  });

  it('maps side_scroll to sideScroller', () => {
    expect(smartModeToEngine('side_scroll')).toBe('sideScroller');
  });

  it('maps top_down to topDown', () => {
    expect(smartModeToEngine('top_down')).toBe('topDown');
  });

  it('maps fixed to fixed', () => {
    expect(smartModeToEngine('fixed')).toBe('fixed');
  });

  it('maps orbit to orbital', () => {
    expect(smartModeToEngine('orbit')).toBe('orbital');
  });
});

// ---------------------------------------------------------------------------
// detectOptimalCamera
// ---------------------------------------------------------------------------

describe('detectOptimalCamera', () => {
  it('returns platformer_2d for 2D projects', () => {
    const ctx = makeContext({ projectType: '2d' });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('platformer_2d');
  });

  it('returns fps_shooter when projectile components present', () => {
    const ctx = makeContext({ gameComponentTypes: ['projectile', 'health'] });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('fps_shooter');
  });

  it('returns fps_shooter when firstPerson camera already exists', () => {
    const ctx = makeContext({ gameCameraModes: ['firstPerson'] });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('fps_shooter');
  });

  it('returns platformer when characterController and movingPlatform present', () => {
    const ctx = makeContext({ gameComponentTypes: ['characterController', 'movingPlatform'] });
    const result = detectOptimalCamera(ctx);
    expect(['platformer_2d', 'platformer_3d']).toContain(result.genre);
  });

  it('returns rpg_exploration when dialogueTrigger present', () => {
    const ctx = makeContext({
      gameComponentTypes: ['dialogueTrigger', 'characterController'],
    });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('rpg_exploration');
  });

  it('returns racing when entity names contain car', () => {
    const ctx = makeContext({ entityNames: ['Player Car', 'Track'] });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('racing');
  });

  it('returns horror when entity names contain zombie or ghost', () => {
    const ctx = makeContext({ entityNames: ['Dark Room', 'Zombie NPC'] });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('horror');
  });

  it('returns top_down_strategy when topDown camera mode exists', () => {
    const ctx = makeContext({ gameCameraModes: ['topDown'] });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('top_down_strategy');
  });

  it('returns puzzle when entity names contain puzzle', () => {
    const ctx = makeContext({
      entityNames: ['Puzzle Block', 'Switch'],
      gameComponentTypes: ['winCondition'],
    });
    const result = detectOptimalCamera(ctx);
    expect(result.genre).toBe('puzzle');
  });

  it('returns a valid preset for empty context', () => {
    const ctx = makeContext();
    const result = detectOptimalCamera(ctx);
    expect(PRESET_KEYS).toContain(result.genre);
  });
});

// ---------------------------------------------------------------------------
// cameraToCommands
// ---------------------------------------------------------------------------

describe('cameraToCommands', () => {
  it('generates set_game_camera and set_active_game_camera commands', () => {
    const preset = CAMERA_PRESETS['platformer_3d'];
    const commands = cameraToCommands(preset, 'entity-1');
    expect(commands).toHaveLength(2);
    expect(commands[0].command).toBe('set_game_camera');
    expect(commands[1].command).toBe('set_active_game_camera');
  });

  it('includes entityId in all payloads', () => {
    const commands = cameraToCommands(CAMERA_PRESETS['fps_shooter'], 'cam-42');
    for (const cmd of commands) {
      expect(cmd.payload['entityId']).toBe('cam-42');
    }
  });

  it('sets thirdPersonFollow params for follow mode', () => {
    const preset = CAMERA_PRESETS['platformer_3d'];
    const commands = cameraToCommands(preset, 'e1');
    const payload = commands[0].payload;
    expect(payload['mode']).toBe('thirdPersonFollow');
    expect(payload['followDistance']).toBe(preset.followDistance);
    expect(payload['followHeight']).toBe(preset.followHeight);
    expect(payload['followSmoothing']).toBe(preset.followSmoothing);
  });

  it('sets firstPerson params for fps_shooter', () => {
    const commands = cameraToCommands(CAMERA_PRESETS['fps_shooter'], 'e1');
    const payload = commands[0].payload;
    expect(payload['mode']).toBe('firstPerson');
    expect(payload['firstPersonHeight']).toBe(1.7);
  });

  it('sets sideScroller params for platformer_2d', () => {
    const commands = cameraToCommands(CAMERA_PRESETS['platformer_2d'], 'e1');
    const payload = commands[0].payload;
    expect(payload['mode']).toBe('sideScroller');
    expect(payload['sideScrollerDistance']).toBe(10);
  });

  it('sets topDown params for top_down_strategy', () => {
    const commands = cameraToCommands(CAMERA_PRESETS['top_down_strategy'], 'e1');
    const payload = commands[0].payload;
    expect(payload['mode']).toBe('topDown');
    expect(payload['topDownHeight']).toBe(20);
  });

  it('sets orbital params for rpg_exploration', () => {
    const commands = cameraToCommands(CAMERA_PRESETS['rpg_exploration'], 'e1');
    const payload = commands[0].payload;
    expect(payload['mode']).toBe('orbital');
    expect(payload['orbitalDistance']).toBe(12);
  });

  it('handles fixed mode with no extra params', () => {
    const commands = cameraToCommands(CAMERA_PRESETS['puzzle'], 'e1');
    const payload = commands[0].payload;
    expect(payload['mode']).toBe('fixed');
  });
});

// ---------------------------------------------------------------------------
// interpolatePresets
// ---------------------------------------------------------------------------

describe('interpolatePresets', () => {
  const presetA = CAMERA_PRESETS['platformer_3d'];
  const presetB = CAMERA_PRESETS['fps_shooter'];

  it('returns preset A values at t=0', () => {
    const result = interpolatePresets(presetA, presetB, 0);
    expect(result.fov).toBe(presetA.fov);
    expect(result.followDistance).toBe(presetA.followDistance);
    expect(result.name).toBe(presetA.name);
    expect(result.mode).toBe(presetA.mode);
  });

  it('returns preset B values at t=1', () => {
    const result = interpolatePresets(presetA, presetB, 1);
    expect(result.fov).toBe(presetB.fov);
    expect(result.followDistance).toBe(presetB.followDistance);
    expect(result.name).toBe(presetB.name);
    expect(result.mode).toBe(presetB.mode);
  });

  it('returns interpolated FOV at t=0.5', () => {
    const result = interpolatePresets(presetA, presetB, 0.5);
    const expected = presetA.fov + (presetB.fov - presetA.fov) * 0.5;
    expect(result.fov).toBeCloseTo(expected, 5);
  });

  it('interpolates dead zone values', () => {
    const result = interpolatePresets(presetA, presetB, 0.5);
    const expectedX = presetA.deadZone.x + (presetB.deadZone.x - presetA.deadZone.x) * 0.5;
    expect(result.deadZone.x).toBeCloseTo(expectedX, 5);
  });

  it('interpolates shake trauma', () => {
    const result = interpolatePresets(presetA, presetB, 0.5);
    const expected = presetA.shake.trauma + (presetB.shake.trauma - presetA.shake.trauma) * 0.5;
    expect(result.shake.trauma).toBeCloseTo(expected, 5);
  });

  it('clamps t below 0', () => {
    const result = interpolatePresets(presetA, presetB, -1);
    expect(result.fov).toBe(presetA.fov);
  });

  it('clamps t above 1', () => {
    const result = interpolatePresets(presetA, presetB, 2);
    expect(result.fov).toBe(presetB.fov);
  });

  it('switches name/mode at t=0.5 threshold', () => {
    const justBelow = interpolatePresets(presetA, presetB, 0.49);
    const atHalf = interpolatePresets(presetA, presetB, 0.5);
    expect(justBelow.mode).toBe(presetA.mode);
    expect(atHalf.mode).toBe(presetB.mode);
  });

  it('handles bounds when both presets have them', () => {
    const withBoundsA: CameraPreset = {
      ...presetA,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    };
    const withBoundsB: CameraPreset = {
      ...presetB,
      bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
    };
    const result = interpolatePresets(withBoundsA, withBoundsB, 0.5);
    expect(result.bounds).toBeDefined();
    expect(result.bounds!.minX).toBeCloseTo(-15, 5);
  });

  it('uses available bounds when only one preset has them', () => {
    const withBounds: CameraPreset = {
      ...presetA,
      bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
    };
    const noBounds: CameraPreset = { ...presetB, bounds: undefined };
    const result = interpolatePresets(withBounds, noBounds, 0.3);
    expect(result.bounds).toBeDefined();
    expect(result.bounds!.minX).toBe(-50);
  });
});
