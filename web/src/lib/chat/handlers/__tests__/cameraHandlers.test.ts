/**
 * Tests for cameraHandlers — configure_smart_camera and list_camera_presets.
 */
import { describe, it, expect, vi } from 'vitest';
import { cameraHandlers } from '../cameraHandlers';
import { invokeHandler, createMockStore } from './handlerTestUtils';
import { CAMERA_PRESETS, PRESET_KEYS } from '@/lib/ai/smartCamera';

// ---------------------------------------------------------------------------
// configure_smart_camera
// ---------------------------------------------------------------------------

describe('configure_smart_camera', () => {
  it('fails when entityId is missing', async () => {
    const { result } = await invokeHandler(cameraHandlers, 'configure_smart_camera', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('entityId');
  });

  it('fails when entityId is empty string', async () => {
    const { result } = await invokeHandler(cameraHandlers, 'configure_smart_camera', {
      entityId: '',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('applies the horror preset when genre="horror"', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-1', genre: 'horror' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      resolvedGenre: 'horror',
      usedHeuristic: false,
    });
    // Should dispatch set_game_camera and set_active_game_camera
    expect(dispatchCommand).toHaveBeenCalledTimes(2);
    expect(dispatchCommand).toHaveBeenNthCalledWith(
      1,
      'set_game_camera',
      expect.objectContaining({ entityId: 'cam-1', mode: 'thirdPersonFollow' }),
    );
    expect(dispatchCommand).toHaveBeenNthCalledWith(
      2,
      'set_active_game_camera',
      expect.objectContaining({ entityId: 'cam-1' }),
    );
  });

  it('applies fps_shooter preset for fuzzy alias "fps"', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-2', genre: 'fps' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      resolvedGenre: 'fps_shooter',
      usedHeuristic: false,
    });
    expect(dispatchCommand).toHaveBeenCalledWith(
      'set_game_camera',
      expect.objectContaining({ mode: 'firstPerson' }),
    );
  });

  it('applies platformer_3d for fuzzy alias "platformer"', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-3', genre: 'platformer' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ resolvedGenre: 'platformer_3d' });
  });

  it('uses heuristic detection when genre is omitted', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-4' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    const r = result.result as { usedHeuristic: boolean; resolvedGenre: string };
    expect(r.usedHeuristic).toBe(true);
    expect(PRESET_KEYS).toContain(r.resolvedGenre);
    expect(dispatchCommand).toHaveBeenCalledTimes(2);
  });

  it('uses heuristic detection when genre is unrecognised', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-5', genre: 'something_unknown_xyz' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    const r = result.result as { usedHeuristic: boolean };
    expect(r.usedHeuristic).toBe(true);
  });

  it('detects 2d platformer from projectType=2d when no genre given', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-6', projectType: '2d' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    const r = result.result as { resolvedGenre: string };
    expect(r.resolvedGenre).toBe('platformer_2d');
  });

  it('dispatches correct payload for top_down_strategy genre', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-7', genre: 'top_down_strategy' },
      { store, dispatchCommand },
    );

    const [, payload] = dispatchCommand.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload['mode']).toBe('topDown');
    expect(payload['topDownHeight']).toBe(CAMERA_PRESETS['top_down_strategy'].followHeight);
  });

  it('includes preset metadata in result', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-8', genre: 'racing' },
      { store, dispatchCommand },
    );

    const r = result.result as { preset: typeof CAMERA_PRESETS[string]; commandsDispatched: string[] };
    expect(r.preset.genre).toBe('racing');
    expect(r.commandsDispatched).toContain('set_game_camera');
    expect(r.commandsDispatched).toContain('set_active_game_camera');
  });

  it('returns a descriptive message', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-9', genre: 'horror' },
      { store, dispatchCommand },
    );

    expect(result.message).toContain('Horror');
    expect(result.message).toContain('horror');
  });

  it('reads entity names from sceneGraph for heuristic context', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore({
      sceneGraph: {
        nodes: {
          'e1': { name: 'Zombie NPC', components: [] },
          'e2': { name: 'Dark Room', components: [] },
        },
        rootIds: ['e1', 'e2'],
      },
    });
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-10' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    // zombie + dark → horror heuristic
    const r = result.result as { resolvedGenre: string };
    expect(r.resolvedGenre).toBe('horror');
  });

  it('reads gameCameraModes from allGameCameras for heuristic', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore({
      allGameCameras: {
        'cam-existing': { mode: 'firstPerson', targetEntity: null },
      },
    });
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-11' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    const r = result.result as { resolvedGenre: string };
    expect(r.resolvedGenre).toBe('fps_shooter');
  });

  it('reads gameComponentTypes from allGameComponents for heuristic', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore({
      allGameComponents: {
        'e1': [{ type: 'dialogueTrigger' }, { type: 'characterController' }],
      },
    });
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-12' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    const r = result.result as { resolvedGenre: string };
    expect(r.resolvedGenre).toBe('rpg_exploration');
  });

  it('still succeeds when sceneGraph nodes are empty', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore({
      sceneGraph: { nodes: {}, rootIds: [] },
      allGameCameras: {},
      allGameComponents: {},
    });
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-13' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
  });

  it('accepts exact preset key "rpg_exploration" directly', async () => {
    const dispatchCommand = vi.fn();
    const store = createMockStore();
    const result = await cameraHandlers['configure_smart_camera'](
      { entityId: 'cam-14', genre: 'rpg_exploration' },
      { store, dispatchCommand },
    );

    expect(result.success).toBe(true);
    const r = result.result as { resolvedGenre: string; usedHeuristic: boolean };
    expect(r.resolvedGenre).toBe('rpg_exploration');
    expect(r.usedHeuristic).toBe(false);
    expect(dispatchCommand).toHaveBeenCalledWith(
      'set_game_camera',
      expect.objectContaining({ mode: 'orbital' }),
    );
  });
});

// ---------------------------------------------------------------------------
// list_camera_presets
// ---------------------------------------------------------------------------

describe('list_camera_presets', () => {
  it('returns all 8 presets', async () => {
    const { result } = await invokeHandler(cameraHandlers, 'list_camera_presets', {});
    expect(result.success).toBe(true);
    const r = result.result as { presets: unknown[] };
    expect(r.presets).toHaveLength(8);
  });

  it('each preset entry has key, name, genre, mode, fov, shakeEnabled', async () => {
    const { result } = await invokeHandler(cameraHandlers, 'list_camera_presets', {});
    const r = result.result as { presets: Array<Record<string, unknown>> };
    for (const entry of r.presets) {
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('genre');
      expect(entry).toHaveProperty('mode');
      expect(entry).toHaveProperty('fov');
      expect(entry).toHaveProperty('shakeEnabled');
    }
  });

  it('includes validGenres string', async () => {
    const { result } = await invokeHandler(cameraHandlers, 'list_camera_presets', {});
    const r = result.result as { validGenres: string };
    expect(typeof r.validGenres).toBe('string');
    expect(r.validGenres).toContain('fps_shooter');
    expect(r.validGenres).toContain('horror');
  });

  it('genres in result match PRESET_KEYS', async () => {
    const { result } = await invokeHandler(cameraHandlers, 'list_camera_presets', {});
    const r = result.result as { presets: Array<{ key: string }> };
    const keys = r.presets.map((p) => p.key);
    for (const key of PRESET_KEYS) {
      expect(keys).toContain(key);
    }
  });
});
