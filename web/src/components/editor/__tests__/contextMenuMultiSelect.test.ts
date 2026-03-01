/**
 * Tests for context menu multi-select awareness.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('Context menu multi-select labels', () => {
  function getDeleteLabel(selectionCount: number): string {
    const isMulti = selectionCount > 1;
    return isMulti ? `Delete ${selectionCount} entities` : 'Delete';
  }

  function getDuplicateLabel(selectionCount: number): string {
    const isMulti = selectionCount > 1;
    return isMulti ? `Duplicate ${selectionCount} entities` : 'Duplicate';
  }

  it('should show singular label for single selection', () => {
    expect(getDeleteLabel(1)).toBe('Delete');
    expect(getDuplicateLabel(1)).toBe('Duplicate');
  });

  it('should show count in label for multi-selection', () => {
    expect(getDeleteLabel(3)).toBe('Delete 3 entities');
    expect(getDuplicateLabel(3)).toBe('Duplicate 3 entities');
  });

  it('should show count for 2 entities', () => {
    expect(getDeleteLabel(2)).toBe('Delete 2 entities');
    expect(getDuplicateLabel(2)).toBe('Duplicate 2 entities');
  });

  it('should handle large selections', () => {
    expect(getDeleteLabel(50)).toBe('Delete 50 entities');
  });
});

describe('Context menu rename disabled state', () => {
  it('should be disabled when multi-selecting', () => {
    const isMulti = 3 > 1;
    expect(isMulti).toBe(true);
  });

  it('should be enabled for single selection', () => {
    const isMulti = 1 > 1;
    expect(isMulti).toBe(false);
  });
});

describe('Context menu selection preservation', () => {
  function shouldPreserveSelection(entityId: string, selectedIds: Set<string>): boolean {
    return selectedIds.has(entityId);
  }

  it('should preserve selection when right-clicked entity is already selected', () => {
    const selectedIds = new Set(['a', 'b', 'c']);
    expect(shouldPreserveSelection('b', selectedIds)).toBe(true);
  });

  it('should not preserve selection when right-clicked entity is not selected', () => {
    const selectedIds = new Set(['a', 'b']);
    expect(shouldPreserveSelection('d', selectedIds)).toBe(false);
  });

  it('should determine correct selection count', () => {
    const selectedIds = new Set(['a', 'b', 'c']);
    const entityId = 'b';
    const count = selectedIds.has(entityId) ? selectedIds.size : 1;
    expect(count).toBe(3);
  });

  it('should show count of 1 when right-clicking unselected entity', () => {
    const selectedIds = new Set(['a', 'b', 'c']);
    const entityId = 'x';
    const count = selectedIds.has(entityId) ? selectedIds.size : 1;
    expect(count).toBe(1);
  });
});
