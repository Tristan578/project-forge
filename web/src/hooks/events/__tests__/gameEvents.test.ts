import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
  firePlayTick: vi.fn(),
}));

import { useEditorStore, firePlayTick } from '@/stores/editorStore';
import { handleGameEvent } from '../gameEvents';

describe('handleGameEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
    vi.mocked(useEditorStore.setState).mockClear();
    vi.mocked(firePlayTick).mockClear();
  });

  it('returns false for unknown event types', () => {
    expect(handleGameEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('GAME_COMPONENT_CHANGED: updates allGameComponents and primary when selected', () => {
    actions.primaryId = 'ent-1';
    const components = [{ type: 'health', data: { hp: 100 } }];
    const payload = { entityId: 'ent-1', components };
    const result = handleGameEvent('GAME_COMPONENT_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(useEditorStore.setState).toHaveBeenCalledWith(expect.objectContaining({
      allGameComponents: { 'ent-1': components },
      primaryGameComponents: components,
    }));
  });

  it('GAME_COMPONENT_CHANGED: does not update primary for different entity', () => {
    actions.primaryId = 'other-ent';
    const components = [{ type: 'health' }];
    const payload = { entityId: 'ent-1', components };
    handleGameEvent('GAME_COMPONENT_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(useEditorStore.setState).toHaveBeenCalledWith(expect.objectContaining({
      primaryGameComponents: [], // unchanged (empty initial)
    }));
  });

  it('GAME_CAMERA_CHANGED: calls setEntityGameCamera', () => {
    const payload = { entityId: 'cam-1', mode: 'follow', targetEntity: 'player-1' };
    const result = handleGameEvent('GAME_CAMERA_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'follow',
      targetEntity: 'player-1',
    });
  });

  it('GAME_CAMERA_CHANGED: handles null targetEntity', () => {
    const payload = { entityId: 'cam-1', mode: 'free', targetEntity: null };
    handleGameEvent('GAME_CAMERA_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-1', {
      mode: 'free',
      targetEntity: null,
    });
  });

  it('ACTIVE_GAME_CAMERA_CHANGED: calls setActiveGameCameraId', () => {
    const payload = { entityId: 'cam-1' };
    const result = handleGameEvent('ACTIVE_GAME_CAMERA_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setActiveGameCameraId).toHaveBeenCalledWith('cam-1');
  });

  it('ACTIVE_GAME_CAMERA_CHANGED: handles null entityId', () => {
    const payload = { entityId: null };
    handleGameEvent('ACTIVE_GAME_CAMERA_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(actions.setActiveGameCameraId).toHaveBeenCalledWith(null);
  });

  it('PLAY_TICK: calls firePlayTick', () => {
    const payload = {
      entities: { 'ent-1': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      entityInfos: {},
      inputState: { pressed: {}, justPressed: {}, justReleased: {}, axes: {} },
    };
    const result = handleGameEvent('PLAY_TICK', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(firePlayTick).toHaveBeenCalledWith(payload);
  });
});
