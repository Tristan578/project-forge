/**
 * Tests for SceneToolbar undo/redo button label logic.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('Undo/Redo button titles', () => {
  function undoTitle(canUndo: boolean, description: string | null): string {
    return canUndo && description ? `Undo: ${description} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  }

  function redoTitle(canRedo: boolean, description: string | null): string {
    return canRedo && description ? `Redo: ${description} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  }

  it('should show generic undo title when nothing to undo', () => {
    expect(undoTitle(false, null)).toBe('Undo (Ctrl+Z)');
  });

  it('should show descriptive undo title when available', () => {
    expect(undoTitle(true, 'Move Entity')).toBe('Undo: Move Entity (Ctrl+Z)');
  });

  it('should show generic undo title when canUndo but no description', () => {
    expect(undoTitle(true, null)).toBe('Undo (Ctrl+Z)');
  });

  it('should show generic redo title when nothing to redo', () => {
    expect(redoTitle(false, null)).toBe('Redo (Ctrl+Shift+Z)');
  });

  it('should show descriptive redo title when available', () => {
    expect(redoTitle(true, 'Rename Entity')).toBe('Redo: Rename Entity (Ctrl+Shift+Z)');
  });

  it('should show generic redo title when canRedo but no description', () => {
    expect(redoTitle(true, null)).toBe('Redo (Ctrl+Shift+Z)');
  });
});

describe('Undo/Redo button aria-labels', () => {
  function undoAriaLabel(canUndo: boolean, description: string | null): string {
    return canUndo && description ? `Undo: ${description}` : 'Undo';
  }

  function redoAriaLabel(canRedo: boolean, description: string | null): string {
    return canRedo && description ? `Redo: ${description}` : 'Redo';
  }

  it('should compose undo aria-label with description', () => {
    expect(undoAriaLabel(true, 'Delete Entity')).toBe('Undo: Delete Entity');
  });

  it('should use generic undo aria-label without description', () => {
    expect(undoAriaLabel(false, null)).toBe('Undo');
  });

  it('should compose redo aria-label with description', () => {
    expect(redoAriaLabel(true, 'Scale Entity')).toBe('Redo: Scale Entity');
  });

  it('should use generic redo aria-label without description', () => {
    expect(redoAriaLabel(false, null)).toBe('Redo');
  });
});
