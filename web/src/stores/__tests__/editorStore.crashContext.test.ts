/**
 * Coverage for the WASM-panic enrichment wiring on editorStore:
 *  - command dispatch records into a 20-entry ring buffer (FIFO),
 *  - each dispatch emits a Sentry breadcrumb,
 *  - the snapshot provider registered with useEngine returns live state.
 *
 * The aim is to prove the diagnostic context is actually populated so the
 * next #8462 panic surfaces with engine state attached, not just a stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addBreadcrumbMock = vi.fn();
const setSnapshotProviderMock = vi.fn();

vi.mock('@/lib/monitoring/sentry-client', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
  // unused in these tests but exported by the real module
  captureException: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock('@/hooks/useEngine', () => ({
  setEngineSnapshotProvider: (...args: unknown[]) => setSnapshotProviderMock(...args),
}));

vi.mock('@/lib/analytics/events', () => ({
  trackCommandDispatched: vi.fn(),
}));

let getRecentCommands: typeof import('../editorStore')['getRecentCommands'];
let setCommandDispatcher: typeof import('../editorStore')['setCommandDispatcher'];
let getCommandDispatcher: typeof import('../editorStore')['getCommandDispatcher'];
let useEditorStore: typeof import('../editorStore')['useEditorStore'];

beforeEach(async () => {
  vi.resetModules();
  addBreadcrumbMock.mockClear();
  setSnapshotProviderMock.mockClear();

  const mod = await import('../editorStore');
  getRecentCommands = mod.getRecentCommands;
  setCommandDispatcher = mod.setCommandDispatcher;
  getCommandDispatcher = mod.getCommandDispatcher;
  useEditorStore = mod.useEditorStore;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('editorStore crash-context wiring', () => {
  it('registers a snapshot provider with useEngine on import', () => {
    expect(setSnapshotProviderMock).toHaveBeenCalledTimes(1);
    expect(setSnapshotProviderMock.mock.calls[0][0]).toBeTypeOf('function');
  });

  it('records each dispatched command in a ring and emits a breadcrumb', () => {
    setCommandDispatcher(() => { /* engine no-op for test */ });
    const dispatch = getCommandDispatcher();
    expect(dispatch).not.toBeNull();

    dispatch!('spawn_entity', { type: 'cube' });
    dispatch!('set_transform', { id: 'e1' });

    expect(getRecentCommands()).toEqual(['spawn_entity', 'set_transform']);
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(2);
    expect(addBreadcrumbMock.mock.calls[0][0]).toMatchObject({
      category: 'engine.command',
      message: 'spawn_entity',
      level: 'info',
    });
  });

  it('caps the ring at 20 entries (oldest evicted first)', () => {
    setCommandDispatcher(() => { /* no-op */ });
    const dispatch = getCommandDispatcher()!;

    for (let i = 0; i < 25; i++) dispatch(`cmd_${i}`, {});

    const recent = getRecentCommands();
    expect(recent).toHaveLength(20);
    expect(recent[0]).toBe('cmd_5');
    expect(recent[19]).toBe('cmd_24');
  });

  it('snapshot provider returns live editor state', () => {
    const provider = setSnapshotProviderMock.mock.calls[0][0] as () => Record<string, unknown>;

    setCommandDispatcher(() => { /* no-op */ });
    const dispatch = getCommandDispatcher()!;
    dispatch('rename_entity', { id: 'e1', name: 'Cube' });
    dispatch('select_entity', { id: 'e1' });

    useEditorStore.getState().setHistoryState(true, false, 'rename', null);
    useEditorStore.getState().setSelection(['e1'], 'e1', 'Cube');

    const snapshot = provider();
    expect(snapshot).toMatchObject({
      entityCount: 0, // sceneGraph not populated in this isolated test
      selectionSize: 1,
      primarySelection: 'e1',
      canUndo: true,
      canRedo: false,
      undoDescription: 'rename',
    });
    expect(snapshot.recentCommands).toEqual(['rename_entity', 'select_entity']);
  });
});
