// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCommandDispatcher, getCommandBatchDispatcher, setCommandDispatcher,
  setCommandBatchDispatcher, useEditorStore,
} from '@/stores/editorStore';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { onCaptureWorkloadChange } from '../captureStability';

vi.mock('@/hooks/useEngine', () => ({ setEngineSnapshotProvider: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-client', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn(), setTag: vi.fn() }));
vi.mock('@/lib/analytics/events', () => ({ trackCommandDispatched: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));

let unsubscribe: () => void = () => undefined;
const changed = vi.fn();

beforeEach(() => {
  useEditorStore.setState({ engineMode: 'edit', primaryId: null });
  changed.mockClear();
  setCommandDispatcher(() => ({ success: true }));
  unsubscribe = onCaptureWorkloadChange(changed);
});
afterEach(() => { unsubscribe(); setCommandBatchDispatcher(undefined); });

describe('capture workload publishers', () => {
  it.each(['update_transform', 'set_ambient_light', 'delete_entity', 'undo', 'redo', 'load_scene'])(
    'observes accepted authoring command %s', (command) => {
      getCommandDispatcher()!(command, {});
      expect(changed).toHaveBeenCalledTimes(1);
    },
  );

  it('does not invalidate on a rejected authoring command', () => {
    setCommandDispatcher(() => ({ success: false, error: 'rejected' }));
    getCommandDispatcher()!('delete_entity', {});
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['get_performance_stats', 'query_scene_graph', 'export_scene', 'export_scene_json', 'validate_scene', 'list_assets'])(
    'allows side-effect-free %s while measuring', (command) => {
      getCommandDispatcher()!(command, {});
      expect(changed).not.toHaveBeenCalled();
    },
  );

  it('observes accepted mutations in a partially failed batch', () => {
    setCommandBatchDispatcher(() => ({
      success: false,
      results: [{ success: false, error: 'missing entity' }, { success: true }, { success: true }],
    }));
    getCommandBatchDispatcher()!([
      { command: 'delete_entity', payload: {} },
      { command: 'update_transform', payload: {} },
      { command: 'get_performance_stats', payload: {} },
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it.each(['sceneOperationRevision', 'projectRevision'] as const)('observes each %s transition', (field) => {
    const start = useEditorStore.getState()[field];
    useEditorStore.setState({ [field]: start + 1 });
    useEditorStore.setState({ [field]: start }); // restoring values cannot erase the occurrence
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('observes scene and project identity changes', () => {
    useEditorStore.setState({ projectId: 'capture-project', activeSceneId: 'capture-scene' });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('observes repeated native history events with identical labels', () => {
    const payload = { canUndo: true, canRedo: false, undoDescription: 'Move', redoDescription: null };
    for (let i = 0; i < 2; i++) {
      handleTransformEvent('HISTORY_CHANGED', payload, useEditorStore.setState, useEditorStore.getState);
    }
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('observes native edit transforms but lets runtime physics transforms continue', () => {
    const payload = { entityId: 'entity', position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] };
    handleTransformEvent('TRANSFORM_CHANGED', payload, useEditorStore.setState, useEditorStore.getState);
    expect(changed).toHaveBeenCalledTimes(1);
    useEditorStore.setState({ engineMode: 'play' });
    changed.mockClear();
    handleTransformEvent('TRANSFORM_CHANGED', payload, useEditorStore.setState, useEditorStore.getState);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['play', 'paused'] as const)('allows runtime history events while %s', (engineMode) => {
    useEditorStore.setState({ engineMode });
    changed.mockClear();
    handleTransformEvent('HISTORY_CHANGED', { canUndo: true, canRedo: false, undoDescription: 'Spawn', redoDescription: null }, useEditorStore.setState, useEditorStore.getState);
    expect(changed).not.toHaveBeenCalled();
    getCommandDispatcher()!('undo', {});
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('stops observing after unsubscribe', () => {
    unsubscribe();
    getCommandDispatcher()!('delete_entity', {});
    expect(changed).not.toHaveBeenCalled();
  });
});
