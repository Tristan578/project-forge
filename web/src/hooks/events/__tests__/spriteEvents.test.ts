import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleSpriteEvent } from '../spriteEvents';

describe('handleSpriteEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
  });

  it('returns false for unknown event types', () => {
    expect(handleSpriteEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('SPRITE_UPDATED: calls setSpriteData', () => {
    const sprite = { atlas: 'player', frame: 0 };
    const payload = { entityId: 'ent-1', sprite };
    const result = handleSpriteEvent('SPRITE_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSpriteData).toHaveBeenCalledWith('ent-1', sprite);
  });

  it('SPRITE_SHEET_UPDATED: calls setSpriteSheet', () => {
    const spriteSheet = { columns: 4, rows: 4, frameCount: 16 };
    const payload = { entityId: 'ent-1', spriteSheet };
    const result = handleSpriteEvent('SPRITE_SHEET_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSpriteSheet).toHaveBeenCalledWith('ent-1', spriteSheet);
  });

  it('SPRITE_ANIMATOR_UPDATED: calls setSpriteAnimator', () => {
    const animator = { clips: ['walk', 'run'], currentClip: 'walk' };
    const payload = { entityId: 'ent-1', animator };
    const result = handleSpriteEvent('SPRITE_ANIMATOR_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSpriteAnimator).toHaveBeenCalledWith('ent-1', animator);
  });

  it('ANIMATION_STATE_MACHINE_UPDATED: calls setAnimationStateMachine', () => {
    const stateMachine = { states: ['idle', 'walk'], transitions: [] };
    const payload = { entityId: 'ent-1', stateMachine };
    const result = handleSpriteEvent('ANIMATION_STATE_MACHINE_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setAnimationStateMachine).toHaveBeenCalledWith('ent-1', stateMachine);
  });

  it('PROJECT_TYPE_CHANGED: calls setProjectType', () => {
    const payload = { projectType: '2d' };
    const result = handleSpriteEvent('PROJECT_TYPE_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setProjectType).toHaveBeenCalledWith('2d');
  });

  it('CAMERA2D_UPDATED: calls setCamera2dData', () => {
    const payload = { zoom: 2.0, position: [100, 200] };
    const result = handleSpriteEvent('CAMERA2D_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setCamera2dData).toHaveBeenCalledWith(payload);
  });

  it('TILEMAP_UPDATED: strips entityId and calls setTilemapData', () => {
    const payload = { entityId: 'tm-1', width: 100, height: 50, layers: [] };
    const result = handleSpriteEvent('TILEMAP_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setTilemapData).toHaveBeenCalledWith('tm-1', { width: 100, height: 50, layers: [] });
  });

  it('TILEMAP_REMOVED: calls removeTilemapData', () => {
    const payload = { entityId: 'tm-1' };
    const result = handleSpriteEvent('TILEMAP_REMOVED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.removeTilemapData).toHaveBeenCalledWith('tm-1');
  });

  it('TILESET_LOADED: strips assetId and calls setTileset', () => {
    const payload = { assetId: 'asset-1', tileSize: 16, columns: 10 };
    const result = handleSpriteEvent('TILESET_LOADED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setTileset).toHaveBeenCalledWith('asset-1', { assetId: 'asset-1', tileSize: 16, columns: 10 });
  });
});
