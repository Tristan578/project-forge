/**
 * Integration test for the chat executor pipeline.
 * Verifies: executeToolCall → real handler → correct store method invocation.
 *
 * Unlike executorDispatch.test.ts (which mocks all handlers), this test
 * uses REAL handler implementations to verify that each handler calls the
 * correct store actions with the right arguments. The store itself uses
 * vi.fn() stubs to capture calls (not a real Zustand store).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EditorState } from '@/stores/editorStore';
import type { ExecutionResult } from '../handlers/types';

// ── Mock only the store dispatcher, not the handlers ────────────────────────
const mocks = vi.hoisted(() => {
  const dispatchCommand = vi.fn();
  return { dispatchCommand };
});

vi.mock('@/stores/editorStore', () => ({
  getCommandDispatcher: () => mocks.dispatchCommand,
  // Provide the EditorState type stub so handler imports don't crash
  useEditorStore: { getState: () => ({}) },
}));

// ── Minimal store state builder ─────────────────────────────────────────────

function makeStore(overrides: Partial<EditorState> = {}): EditorState {
  return {
    sceneName: 'Test Scene',
    sceneGraph: {
      nodes: {
        'entity-1': { entityId: 'entity-1', name: 'Cube', type: 'cube', parentId: null, children: [], components: [], visible: true },
        'entity-2': { entityId: 'entity-2', name: 'Light', type: 'point_light', parentId: null, children: [], components: [], visible: true },
      },
      rootIds: ['entity-1', 'entity-2'],
    },
    selectedEntityIds: ['entity-1'],
    primarySelectedId: 'entity-1',
    allScripts: {},
    // Action stubs that track calls
    spawnEntity: vi.fn(),
    deleteSelectedEntities: vi.fn(),
    duplicateSelectedEntity: vi.fn(),
    setSelection: vi.fn(),
    selectEntity: vi.fn(),
    renameEntity: vi.fn(),
    setTransform: vi.fn(),
    updateTransform: vi.fn(),
    ...overrides,
  } as unknown as EditorState;
}

// ── Import the real executor (not mocked) ───────────────────────────────────

import { executeToolCall } from '../executor';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Chat executor integration: executeToolCall → handler → store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawn_entity: calls store.spawnEntity with correct type', async () => {
    const store = makeStore();
    const result: ExecutionResult = await executeToolCall(
      'spawn_entity',
      { entityType: 'sphere', name: 'My Sphere' },
      store,
    );

    expect(result.success).toBe(true);
    expect(store.spawnEntity).toHaveBeenCalledWith('sphere', 'My Sphere');
  });

  it('spawn_entity: rejects invalid entity type', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'spawn_entity',
      { entityType: 'invalid_thing' },
      store,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(store.spawnEntity).not.toHaveBeenCalled();
  });

  it('despawn_entity: calls setSelection + deleteSelectedEntities', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'despawn_entity',
      { entityId: 'entity-1' },
      store,
    );

    expect(result.success).toBe(true);
    expect(store.setSelection).toHaveBeenCalledWith(['entity-1'], 'entity-1', null);
    expect(store.deleteSelectedEntities).toHaveBeenCalled();
  });

  it('duplicate_entity: calls selectEntity + duplicateSelectedEntity', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'duplicate_entity',
      { entityId: 'entity-1' },
      store,
    );

    expect(result.success).toBe(true);
    expect(store.selectEntity).toHaveBeenCalledWith('entity-1', 'replace');
    expect(store.duplicateSelectedEntity).toHaveBeenCalled();
  });

  it('update_transform: calls store.updateTransform with position', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'update_transform',
      { entityId: 'entity-1', position: { x: 1, y: 2, z: 3 } },
      store,
    );

    expect(result.success).toBe(true);
    expect(store.updateTransform).toHaveBeenCalledWith(
      'entity-1',
      'position',
      { x: 1, y: 2, z: 3 },
    );
  });

  it('rename_entity: calls store.renameEntity', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'rename_entity',
      { entityId: 'entity-1', name: 'Renamed Cube' },
      store,
    );

    expect(result.success).toBe(true);
    expect(store.renameEntity).toHaveBeenCalledWith('entity-1', 'Renamed Cube');
  });

  it('unknown tool: returns success=false without crashing', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'nonexistent_tool_xyz',
      {},
      store,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('dispatchCommand is wired: set_entity_lod calls dispatchCommand with engine payload', async () => {
    const store = makeStore();
    const result = await executeToolCall(
      'set_entity_lod',
      { entityId: 'entity-1' },
      store,
    );

    expect(result.success).toBe(true);
    expect(mocks.dispatchCommand).toHaveBeenCalledWith('set_lod', expect.objectContaining({
      entityId: 'entity-1',
    }));
  });
});
