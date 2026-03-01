import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    applyBusConfig: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleAudioEvent } from '../audioEvents';

describe('handleAudioEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
  });

  it('returns false for unknown event types', () => {
    expect(handleAudioEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('SCRIPT_CHANGED: calls setEntityScript', () => {
    const payload = { entityId: 'ent-1', source: 'console.log(1)', enabled: true, template: null };
    const result = handleAudioEvent('SCRIPT_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityScript).toHaveBeenCalledWith('ent-1', {
      source: 'console.log(1)',
      enabled: true,
      template: null,
    });
  });

  it('AUDIO_CHANGED: sets entity audio with defaults', () => {
    const payload = { entityId: 'ent-1', assetId: 'sound-1' };
    const result = handleAudioEvent('AUDIO_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityAudio).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      assetId: 'sound-1',
      volume: 1.0,
      pitch: 1.0,
      loopAudio: false,
      spatial: false,
    }));
  });

  it('AUDIO_CHANGED: respects provided values', () => {
    const payload = {
      entityId: 'ent-1',
      assetId: 'sound-1',
      volume: 0.5,
      pitch: 1.5,
      loopAudio: true,
      spatial: true,
      maxDistance: 100,
      bus: 'music',
    };
    const result = handleAudioEvent('AUDIO_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityAudio).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      volume: 0.5,
      pitch: 1.5,
      loopAudio: true,
      spatial: true,
      maxDistance: 100,
      bus: 'music',
    }));
  });

  it('AUDIO_CHANGED: clears audio when assetId is undefined', () => {
    const payload = { entityId: 'ent-1' };
    const result = handleAudioEvent('AUDIO_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityAudio).toHaveBeenCalledWith('ent-1', null);
  });

  it('AUDIO_CHANGED: sets audio with null assetId', () => {
    const payload = { entityId: 'ent-1', assetId: null };
    const result = handleAudioEvent('AUDIO_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityAudio).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      assetId: null,
    }));
  });

  it('REVERB_ZONE_CHANGED: handles sphere shape', () => {
    const payload = {
      entityId: 'ent-1',
      enabled: true,
      shape: { type: 'sphere', radius: 10 },
      preset: 'hall',
      wetMix: 0.5,
      decayTime: 2.0,
      preDelay: 0.02,
      blendRadius: 1,
      priority: 0,
    };
    const result = handleAudioEvent('REVERB_ZONE_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setReverbZone).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      shape: { type: 'sphere', radius: 10 },
      preset: 'hall',
    }), true);
  });

  it('REVERB_ZONE_CHANGED: handles box shape', () => {
    const payload = {
      entityId: 'ent-1',
      enabled: false,
      shape: { type: 'box', size: [5, 3, 5] },
      preset: 'room',
      wetMix: 0.3,
      decayTime: 1.0,
      preDelay: 0.01,
      blendRadius: 2,
      priority: 1,
    };
    handleAudioEvent('REVERB_ZONE_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(actions.setReverbZone).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      shape: { type: 'box', size: [5, 3, 5] },
    }), false);
  });

  it('REVERB_ZONE_REMOVED: calls removeReverbZone', () => {
    const payload = { entityId: 'ent-1' };
    const result = handleAudioEvent('REVERB_ZONE_REMOVED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.removeReverbZone).toHaveBeenCalledWith('ent-1');
  });

  it('AUDIO_BUSES_CHANGED: calls setAudioBuses', () => {
    const buses = [{ name: 'master', volume: 1.0 }, { name: 'sfx', volume: 0.8 }];
    const payload = { buses };
    const result = handleAudioEvent('AUDIO_BUSES_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setAudioBuses).toHaveBeenCalledWith(buses);
  });

  it('AUDIO_PLAYBACK: returns true', () => {
    const payload = { entityId: 'ent-1', action: 'play' };
    const result = handleAudioEvent('AUDIO_PLAYBACK', payload as never, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(true);
  });

  it('INPUT_BINDINGS_CHANGED: converts Rust format to InputBinding array', () => {
    const payload = {
      actions: {
        jump: {
          name: 'jump',
          actionType: { type: 'Digital' },
          sources: [{ type: 'key', value: 'Space' }],
          deadZone: 0,
        },
        move_x: {
          name: 'move_x',
          actionType: {
            type: 'Axis',
            positive: [{ type: 'key', value: 'D' }],
            negative: [{ type: 'key', value: 'A' }],
          },
          sources: [],
          deadZone: 0.1,
        },
      },
      preset: 'fps',
    };
    const result = handleAudioEvent('INPUT_BINDINGS_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setInputBindings).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ actionName: 'jump', actionType: 'digital', sources: ['Space'] }),
        expect.objectContaining({ actionName: 'move_x', actionType: 'axis', positiveKeys: ['D'], negativeKeys: ['A'] }),
      ]),
      'fps'
    );
  });

  it('ASSET_IMPORTED: calls addAssetToRegistry', () => {
    const payload = { assetId: 'a1', name: 'model.glb', kind: 'gltf_model', fileSize: 1024 };
    const result = handleAudioEvent('ASSET_IMPORTED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.addAssetToRegistry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'a1',
      name: 'model.glb',
      kind: 'gltf_model',
    }));
  });

  it('ASSET_DELETED: calls removeAssetFromRegistry', () => {
    const payload = { assetId: 'a1' };
    const result = handleAudioEvent('ASSET_DELETED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.removeAssetFromRegistry).toHaveBeenCalledWith('a1');
  });

  it('ASSET_LIST: calls setAssetRegistry', () => {
    const assets = { a1: { id: 'a1', name: 'tex.png', kind: 'texture' } };
    const payload = { assets };
    const result = handleAudioEvent('ASSET_LIST', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setAssetRegistry).toHaveBeenCalledWith(assets);
  });
});
