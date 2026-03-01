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
import { handleTransformEvent } from '../transformEvents';

describe('handleTransformEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
    vi.mocked(useEditorStore.setState).mockClear();
  });

  it('returns false for unknown event types', () => {
    expect(handleTransformEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('SELECTION_CHANGED: calls setSelection with ids and primary', () => {
    const payload = { selectedIds: ['a', 'b'], primaryId: 'a', primaryName: 'EntityA' };
    const result = handleTransformEvent('SELECTION_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSelection).toHaveBeenCalledWith(['a', 'b'], 'a', 'EntityA');
  });

  it('SCENE_GRAPH_UPDATE: calls updateSceneGraph and marks modified', () => {
    const graph = { nodes: {}, rootIds: [] };
    const result = handleTransformEvent('SCENE_GRAPH_UPDATE', graph as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.updateSceneGraph).toHaveBeenCalledWith(graph);
    expect(useEditorStore.setState).toHaveBeenCalledWith({ sceneModified: true });
  });

  it('TRANSFORM_CHANGED: calls setPrimaryTransform', () => {
    const transform = { entityId: 'ent-1', position: [0, 1, 2], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const result = handleTransformEvent('TRANSFORM_CHANGED', transform as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setPrimaryTransform).toHaveBeenCalledWith(transform);
  });

  it('HISTORY_CHANGED: calls setHistoryState', () => {
    const payload = { canUndo: true, canRedo: false, undoDescription: 'Move', redoDescription: null };
    const result = handleTransformEvent('HISTORY_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setHistoryState).toHaveBeenCalledWith(true, false, 'Move', null);
  });

  it('SNAP_SETTINGS_CHANGED: calls setSnapSettings', () => {
    const snap = { gridSize: 0.5, rotationStep: 15, snapEnabled: true };
    const result = handleTransformEvent('SNAP_SETTINGS_CHANGED', snap as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSnapSettings).toHaveBeenCalledWith(snap);
  });

  it('VIEW_PRESET_CHANGED: calls setCurrentCameraPreset', () => {
    const payload = { preset: 'top', displayName: 'Top View' };
    const result = handleTransformEvent('VIEW_PRESET_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setCurrentCameraPreset).toHaveBeenCalledWith('top');
  });

  it('COORDINATE_MODE_CHANGED: sets coordinateMode via setState', () => {
    const payload = { mode: 'local', displayName: 'Local' };
    const result = handleTransformEvent('COORDINATE_MODE_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(useEditorStore.setState).toHaveBeenCalledWith({ coordinateMode: 'local' });
  });

  it('REPARENT_RESULT: logs error on failure', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = { success: false, entityId: 'ent-1', error: 'Circular dependency' };
    const result = handleTransformEvent('REPARENT_RESULT', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Circular dependency'));
    errorSpy.mockRestore();
  });

  it('REPARENT_RESULT: success does not log error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = { success: true, entityId: 'ent-1' };
    handleTransformEvent('REPARENT_RESULT', payload as never, mockSetGet.set, mockSetGet.get);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('ENGINE_MODE_CHANGED: sets engineMode via setState', () => {
    const payload = { mode: 'play' };
    const result = handleTransformEvent('ENGINE_MODE_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(useEditorStore.setState).toHaveBeenCalledWith({ engineMode: 'play' });
  });

  it('SCENE_EXPORTED: dispatches DOM event', () => {
    // Provide a minimal window mock for the dispatchEvent call
    const mockDispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: mockDispatchEvent, CustomEvent });
    vi.stubGlobal('CustomEvent', class MockCustomEvent { type: string; detail: unknown; constructor(type: string, opts?: { detail?: unknown }) { this.type = type; this.detail = opts?.detail; } });

    const payload = { json: '{"scene":true}', name: 'TestScene' };
    const result = handleTransformEvent('SCENE_EXPORTED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockDispatchEvent).toHaveBeenCalled();
    const event = mockDispatchEvent.mock.calls[0][0];
    expect(event.type).toBe('forge:scene-exported');
    expect(event.detail).toEqual({ json: '{"scene":true}', name: 'TestScene' });

    vi.unstubAllGlobals();
  });

  it('SCENE_LOADED: resets state', () => {
    const payload = { name: 'MyScene' };
    const result = handleTransformEvent('SCENE_LOADED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(useEditorStore.setState).toHaveBeenCalledWith(expect.objectContaining({
      sceneName: 'MyScene',
      sceneModified: false,
      primaryMaterial: null,
      primaryLight: null,
    }));
  });
});
