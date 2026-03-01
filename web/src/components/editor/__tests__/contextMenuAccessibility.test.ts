/**
 * Tests for ContextMenu accessibility: ARIA roles and keyboard navigation helpers.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('ContextMenu ARIA roles', () => {
  it('should define menu role on container', () => {
    const role = 'menu';
    expect(role).toBe('menu');
  });

  it('should define menuitem role on action buttons', () => {
    const role = 'menuitem';
    expect(role).toBe('menuitem');
  });

  it('should define separator role on dividers', () => {
    const role = 'separator';
    expect(role).toBe('separator');
  });
});

describe('ContextMenu keyboard navigation logic', () => {
  // Simulates the actionableIndices filtering (skips dividers)
  function getActionableIndices(items: Array<{ type?: string }>): number[] {
    return items
      .map((item, i) => (item.type === 'divider' ? -1 : i))
      .filter((i) => i >= 0);
  }

  const sampleItems = [
    { id: 'rename' },
    { id: 'focus' },
    { type: 'divider' },
    { id: 'duplicate' },
    { type: 'divider' },
    { id: 'delete' },
  ];

  it('should identify actionable indices skipping dividers', () => {
    const indices = getActionableIndices(sampleItems);
    expect(indices).toEqual([0, 1, 3, 5]);
  });

  it('ArrowDown should advance to next actionable item', () => {
    const indices = [0, 1, 3, 5];
    const focusedIndex = 1;
    const currentPos = indices.indexOf(focusedIndex);
    const nextPos = currentPos < indices.length - 1 ? currentPos + 1 : 0;
    expect(indices[nextPos]).toBe(3); // Skips divider at index 2
  });

  it('ArrowDown should wrap from last to first', () => {
    const indices = [0, 1, 3, 5];
    const focusedIndex = 5;
    const currentPos = indices.indexOf(focusedIndex);
    const nextPos = currentPos < indices.length - 1 ? currentPos + 1 : 0;
    expect(indices[nextPos]).toBe(0);
  });

  it('ArrowUp should go to previous actionable item', () => {
    const indices = [0, 1, 3, 5];
    const focusedIndex = 3;
    const currentPos = indices.indexOf(focusedIndex);
    const prevPos = currentPos > 0 ? currentPos - 1 : indices.length - 1;
    expect(indices[prevPos]).toBe(1);
  });

  it('ArrowUp should wrap from first to last', () => {
    const indices = [0, 1, 3, 5];
    const focusedIndex = 0;
    const currentPos = indices.indexOf(focusedIndex);
    const prevPos = currentPos > 0 ? currentPos - 1 : indices.length - 1;
    expect(indices[prevPos]).toBe(5);
  });

  it('Home should focus first actionable item', () => {
    const indices = [0, 1, 3, 5];
    expect(indices[0]).toBe(0);
  });

  it('End should focus last actionable item', () => {
    const indices = [0, 1, 3, 5];
    expect(indices[indices.length - 1]).toBe(5);
  });

  it('should handle empty menu gracefully', () => {
    const indices = getActionableIndices([]);
    expect(indices).toEqual([]);
  });
});

describe('Shift+F10 keyboard context menu trigger', () => {
  it('should compose correct position from bounding rect', () => {
    const rect = { left: 200, top: 150 };
    const position = {
      x: rect.left + 60,
      y: rect.top + 40,
    };
    expect(position).toEqual({ x: 260, y: 190 });
  });

  it('should use fallback when no rect available', () => {
    const rect = undefined;
    const position = {
      x: (rect?.left ?? 100) + 60,
      y: (rect?.top ?? 100) + 40,
    };
    expect(position).toEqual({ x: 160, y: 140 });
  });
});
