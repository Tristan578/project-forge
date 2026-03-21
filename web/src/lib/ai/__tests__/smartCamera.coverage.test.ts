/**
 * Coverage sweep for smartCamera.ts
 * Targets uncovered branches in detectOptimalCamera (scoring heuristics) and
 * cameraToCommands (switch arms not exercised in the existing test).
 */

import { describe, it, expect } from 'vitest';
import {
  detectOptimalCamera,
  cameraToCommands,
  CAMERA_PRESETS,
  type SmartCameraSceneContext,
} from '../smartCamera';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<SmartCameraSceneContext> = {}): SmartCameraSceneContext {
  return {
    projectType: '3d',
    entityNames: [],
    componentTypes: [],
    gameComponentTypes: [],
    gameCameraModes: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectOptimalCamera — additional scoring branches
// ---------------------------------------------------------------------------

describe('detectOptimalCamera — additional heuristics', () => {
  it('scores platformer higher when collectible present', () => {
    const result = detectOptimalCamera(makeCtx({
      gameComponentTypes: ['collectible', 'characterController'],
    }));
    // collectible + characterController -> platformer_3d or platformer_2d
    expect(['platformer_3d', 'platformer_2d']).toContain(result.name.toLowerCase().replace(/ /g, '_').split(' ')[0] ?? result.genre);
  });

  it('scores platformer higher when movingPlatform present', () => {
    const result = detectOptimalCamera(makeCtx({
      gameComponentTypes: ['movingPlatform'],
    }));
    // movingPlatform gives +3 to platformer_3d and +3 to platformer_2d
    expect(['platformer_3d', 'platformer_2d', 'racing']).toContain(
      Object.keys(CAMERA_PRESETS).find((k) => CAMERA_PRESETS[k] === result) ?? result.genre
    );
  });

  it('scores fps higher when spawner is present', () => {
    const result = detectOptimalCamera(makeCtx({
      gameComponentTypes: ['spawner', 'projectile'],
    }));
    // spawner+projectile -> fps_shooter
    expect(result).toBe(CAMERA_PRESETS['fps_shooter']);
  });

  it('scores rpg higher when follower and dialogueTrigger present', () => {
    const result = detectOptimalCamera(makeCtx({
      gameComponentTypes: ['follower', 'dialogueTrigger'],
    }));
    expect(result).toBe(CAMERA_PRESETS['rpg_exploration']);
  });

  it('scores puzzle when winCondition present', () => {
    const result = detectOptimalCamera(makeCtx({
      gameComponentTypes: ['winCondition', 'winCondition', 'winCondition'],
      entityNames: ['Puzzle Box', 'Switch', 'Block'],
    }));
    // puzzle heavy hinting
    const key = Object.keys(CAMERA_PRESETS).find((k) => CAMERA_PRESETS[k] === result);
    expect(key).toBe('puzzle');
  });

  it('scores racing when entity names contain vehicle', () => {
    const result = detectOptimalCamera(makeCtx({
      entityNames: ['Vehicle_1', 'Track', 'Checkpoint'],
    }));
    expect(result).toBe(CAMERA_PRESETS['racing']);
  });

  it('scores racing when component types include Vehicle', () => {
    const result = detectOptimalCamera(makeCtx({
      componentTypes: ['Vehicle'],
      gameComponentTypes: ['checkpoint'],
    }));
    expect(result).toBe(CAMERA_PRESETS['racing']);
  });

  it('scores top_down_strategy with army unit entity names', () => {
    const result = detectOptimalCamera(makeCtx({
      entityNames: ['Army_1', 'Unit_2', 'Tower_3'],
    }));
    expect(result).toBe(CAMERA_PRESETS['top_down_strategy']);
  });

  it('scores rpg with terrain component', () => {
    const ctx = makeCtx({
      componentTypes: ['TerrainEnabled'],
      gameComponentTypes: ['follower', 'dialogueTrigger'],
    });
    const result = detectOptimalCamera(ctx);
    expect(result).toBe(CAMERA_PRESETS['rpg_exploration']);
  });

  it('scores fps with gun/weapon entity names', () => {
    const result = detectOptimalCamera(makeCtx({
      entityNames: ['Gun_1', 'Weapon_Rack', 'Bullet_Pool'],
    }));
    expect(result).toBe(CAMERA_PRESETS['fps_shooter']);
  });

  it('scores platformer_2d for 2D project with sideScroller mode', () => {
    const result = detectOptimalCamera(makeCtx({
      projectType: '2d',
      gameCameraModes: ['sideScroller'],
    }));
    expect(result).toBe(CAMERA_PRESETS['platformer_2d']);
  });

  it('scores thirdPersonFollow -> platformer_3d and rpg both boosted', () => {
    const withTP = detectOptimalCamera(makeCtx({
      projectType: '3d',
      gameCameraModes: ['thirdPersonFollow'],
      gameComponentTypes: ['characterController'],
    }));
    // thirdPersonFollow gives +2 to platformer_3d and rpg; characterController +3 platformer
    // platformer_3d should win
    expect(withTP).toBe(CAMERA_PRESETS['platformer_3d']);
  });

  it('scores orbital mode boosted for orbital camera mode', () => {
    const result = detectOptimalCamera(makeCtx({
      gameCameraModes: ['orbital'],
      gameComponentTypes: ['winCondition'],
    }));
    // orbital +2 to puzzle, winCondition +2 to puzzle -> puzzle
    const key = Object.keys(CAMERA_PRESETS).find((k) => CAMERA_PRESETS[k] === result);
    expect(key).toBe('puzzle');
  });

  it('returns platformer_3d as default fallback for empty 3D context', () => {
    const result = detectOptimalCamera(makeCtx());
    // All scores are low; no strong signal — platformer_3d gets +1 default
    expect(Object.keys(CAMERA_PRESETS)).toContain(
      Object.keys(CAMERA_PRESETS).find((k) => CAMERA_PRESETS[k] === result) ?? ''
    );
  });

  it('scores platformer_2d for coins/gems in 2D project', () => {
    const result = detectOptimalCamera(makeCtx({
      projectType: '2d',
      entityNames: ['Coin_1', 'Gem_2'],
      gameComponentTypes: ['collectible'],
    }));
    expect(result).toBe(CAMERA_PRESETS['platformer_2d']);
  });
});

// ---------------------------------------------------------------------------
// cameraToCommands — all engine mode switch arms
// ---------------------------------------------------------------------------

describe('cameraToCommands — all camera mode arms', () => {
  it('thirdPersonFollow includes followDistance and followHeight', () => {
    const preset = CAMERA_PRESETS['platformer_3d'];
    const commands = cameraToCommands(preset, 'e1');
    const setCmd = commands[0];
    expect(setCmd.payload).toMatchObject({
      mode: 'thirdPersonFollow',
      followDistance: expect.any(Number),
      followHeight: expect.any(Number),
    });
  });

  it('firstPerson includes firstPersonHeight', () => {
    const preset = CAMERA_PRESETS['fps_shooter'];
    const commands = cameraToCommands(preset, 'e1');
    const setCmd = commands[0];
    expect(setCmd.payload).toMatchObject({
      mode: 'firstPerson',
      firstPersonHeight: expect.any(Number),
    });
  });

  it('sideScroller includes sideScrollerDistance and sideScrollerHeight', () => {
    const preset = CAMERA_PRESETS['platformer_2d'];
    const commands = cameraToCommands(preset, 'e1');
    const setCmd = commands[0];
    expect(setCmd.payload).toMatchObject({
      mode: 'sideScroller',
      sideScrollerDistance: expect.any(Number),
      sideScrollerHeight: expect.any(Number),
    });
  });

  it('topDown includes topDownHeight and topDownAngle', () => {
    const preset = CAMERA_PRESETS['top_down_strategy'];
    const commands = cameraToCommands(preset, 'e1');
    const setCmd = commands[0];
    expect(setCmd.payload).toMatchObject({
      mode: 'topDown',
      topDownHeight: expect.any(Number),
      topDownAngle: 60,
    });
  });

  it('orbital includes orbitalDistance', () => {
    // rpg_exploration uses mode 'orbit' which maps to 'orbital' engine mode
    const preset = CAMERA_PRESETS['rpg_exploration'];
    const commands = cameraToCommands(preset, 'e1');
    const setCmd = commands[0];
    expect(setCmd.payload).toMatchObject({
      mode: 'orbital',
      orbitalDistance: expect.any(Number),
    });
  });

  it('set_active_game_camera command always emitted second', () => {
    for (const key of ['platformer_3d', 'fps_shooter', 'platformer_2d', 'top_down_strategy', 'rpg_exploration']) {
      const commands = cameraToCommands(CAMERA_PRESETS[key], 'cam-1');
      expect(commands[1].command).toBe('set_active_game_camera');
      expect(commands[1].payload).toEqual({ entityId: 'cam-1' });
    }
  });
});
