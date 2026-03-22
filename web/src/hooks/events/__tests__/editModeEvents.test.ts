/**
 * Unit tests for hooks/events/editModeEvents.ts
 *
 * Verifies every event type handled by handleEditModeEvent updates the store
 * correctly via the set callback, and that unknown events are rejected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet } from './eventTestUtils';
import { handleEditModeEvent } from '../editModeEvents';

describe('handleEditModeEvent', () => {
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    mockSetGet = createMockSetGet();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Unknown events
  // -------------------------------------------------------------------------

  it('returns false for unknown event types', () => {
    const result = handleEditModeEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(false);
    expect(mockSetGet.set).not.toHaveBeenCalled();
  });

  it('returns false for empty string event type', () => {
    const result = handleEditModeEvent('', {}, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(false);
  });

  it('returns false for an event from a different domain', () => {
    const result = handleEditModeEvent(
      'PHYSICS_CHANGED',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // edit_mode_entered
  // -------------------------------------------------------------------------

  it('edit_mode_entered: returns true', () => {
    const result = handleEditModeEvent(
      'edit_mode_entered',
      { entityId: 'ent-42' },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(true);
  });

  it('edit_mode_entered: sets editModeActive to true', () => {
    handleEditModeEvent(
      'edit_mode_entered',
      { entityId: 'ent-42' },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ editModeActive: true }),
    );
  });

  it('edit_mode_entered: sets editModeEntityId from payload', () => {
    handleEditModeEvent(
      'edit_mode_entered',
      { entityId: 'cube-001' },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ editModeEntityId: 'cube-001' }),
    );
  });

  it('edit_mode_entered: calls set exactly once', () => {
    handleEditModeEvent(
      'edit_mode_entered',
      { entityId: 'ent-1' },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // edit_mode_exited
  // -------------------------------------------------------------------------

  it('edit_mode_exited: returns true', () => {
    const result = handleEditModeEvent(
      'edit_mode_exited',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(true);
  });

  it('edit_mode_exited: sets editModeActive to false', () => {
    handleEditModeEvent(
      'edit_mode_exited',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ editModeActive: false }),
    );
  });

  it('edit_mode_exited: sets editModeEntityId to null', () => {
    handleEditModeEvent(
      'edit_mode_exited',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ editModeEntityId: null }),
    );
  });

  it('edit_mode_exited: clears selectedIndices', () => {
    handleEditModeEvent(
      'edit_mode_exited',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIndices: [] }),
    );
  });

  it('edit_mode_exited: calls set exactly once', () => {
    handleEditModeEvent(
      'edit_mode_exited',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // edit_mode_selection_changed
  // -------------------------------------------------------------------------

  it('edit_mode_selection_changed: returns true', () => {
    const result = handleEditModeEvent(
      'edit_mode_selection_changed',
      { indices: [0, 2, 5] },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(true);
  });

  it('edit_mode_selection_changed: sets selectedIndices from payload', () => {
    handleEditModeEvent(
      'edit_mode_selection_changed',
      { indices: [1, 3, 7] },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIndices: [1, 3, 7] }),
    );
  });

  it('edit_mode_selection_changed: handles empty indices array', () => {
    handleEditModeEvent(
      'edit_mode_selection_changed',
      { indices: [] },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIndices: [] }),
    );
  });

  it('edit_mode_selection_changed: handles single index', () => {
    handleEditModeEvent(
      'edit_mode_selection_changed',
      { indices: [99] },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ selectedIndices: [99] }),
    );
  });

  // -------------------------------------------------------------------------
  // edit_mode_mesh_stats
  // -------------------------------------------------------------------------

  it('edit_mode_mesh_stats: returns true', () => {
    const result = handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 8, edgeCount: 12, faceCount: 6 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(true);
  });

  it('edit_mode_mesh_stats: sets vertexCount', () => {
    handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 24, edgeCount: 36, faceCount: 14 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ vertexCount: 24 }),
    );
  });

  it('edit_mode_mesh_stats: sets edgeCount', () => {
    handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 24, edgeCount: 36, faceCount: 14 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ edgeCount: 36 }),
    );
  });

  it('edit_mode_mesh_stats: sets faceCount', () => {
    handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 24, edgeCount: 36, faceCount: 14 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ faceCount: 14 }),
    );
  });

  it('edit_mode_mesh_stats: handles zero counts', () => {
    handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 0, edgeCount: 0, faceCount: 0 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ vertexCount: 0, edgeCount: 0, faceCount: 0 }),
    );
  });

  it('edit_mode_mesh_stats: handles large polygon counts', () => {
    handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 100000, edgeCount: 200000, faceCount: 50000 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledWith(
      expect.objectContaining({ vertexCount: 100000 }),
    );
  });

  it('edit_mode_mesh_stats: calls set exactly once', () => {
    handleEditModeEvent(
      'edit_mode_mesh_stats',
      { vertexCount: 8, edgeCount: 12, faceCount: 6 },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(mockSetGet.set).toHaveBeenCalledTimes(1);
  });
});
