/**
 * Tests for F6 editor region focus cycling.
 *
 * Tests the DOM-level focus cycling logic independently from React component
 * rendering, since WorkspaceProvider (Dockview) contains most panels and is
 * complex to set up in jsdom.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/** Regions in tab order — must match EditorLayout.tsx handleGlobalKeyDown */
const REGIONS = ['sidebar', 'hierarchy', 'canvas', 'right-panel'] as const;

/**
 * Replicates the F6 handler logic from EditorLayout.tsx.
 * Extracted here so we can test it without rendering the full component tree.
 */
function cycleRegion(direction: 1 | -1): void {
  const targetEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const current = targetEl?.closest('[data-editor-region]')?.getAttribute('data-editor-region');
  const currentIdx = current ? REGIONS.indexOf(current as typeof REGIONS[number]) : -1;
  // When unfocused (currentIdx=-1), forward starts at 0, backward at last
  const nextIdx = currentIdx === -1
    ? (direction === 1 ? 0 : REGIONS.length - 1)
    : (currentIdx + direction + REGIONS.length) % REGIONS.length;
  const nextEl = document.querySelector(`[data-editor-region="${REGIONS[nextIdx]}"]`) as HTMLElement | null;
  nextEl?.focus();
}

function createRegionEl(tag: string, region: string, tabIndex: number): HTMLElement {
  const el = document.createElement(tag);
  el.setAttribute('data-editor-region', region);
  el.setAttribute('tabindex', String(tabIndex));
  el.textContent = region;
  return el;
}

describe('F6 region focus cycling', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.appendChild(createRegionEl('div', 'sidebar', -1));
    container.appendChild(createRegionEl('div', 'hierarchy', 0));
    container.appendChild(createRegionEl('canvas', 'canvas', 0));
    container.appendChild(createRegionEl('div', 'right-panel', -1));
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('cycles to sidebar when nothing is focused (F6 forward)', () => {
    cycleRegion(1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('sidebar');
  });

  it('cycles to right-panel when nothing is focused (Shift+F6 backward)', () => {
    cycleRegion(-1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('right-panel');
  });

  it('cycles forward: sidebar → hierarchy → canvas → right-panel → sidebar', () => {
    const sidebar = container.querySelector('[data-editor-region="sidebar"]') as HTMLElement;
    sidebar.focus();

    cycleRegion(1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('hierarchy');

    cycleRegion(1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('canvas');

    cycleRegion(1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('right-panel');

    // Wraps around
    cycleRegion(1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('sidebar');
  });

  it('cycles backward: sidebar → right-panel → canvas → hierarchy → sidebar', () => {
    const sidebar = container.querySelector('[data-editor-region="sidebar"]') as HTMLElement;
    sidebar.focus();

    cycleRegion(-1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('right-panel');

    cycleRegion(-1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('canvas');

    cycleRegion(-1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('hierarchy');

    // Wraps around
    cycleRegion(-1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('sidebar');
  });

  it('works when focused on a child of a region', () => {
    const hierarchy = container.querySelector('[data-editor-region="hierarchy"]') as HTMLElement;
    const button = document.createElement('button');
    button.textContent = 'Select';
    hierarchy.appendChild(button);
    button.focus();

    // Should detect we're in hierarchy and move to canvas
    cycleRegion(1);
    expect(document.activeElement?.getAttribute('data-editor-region')).toBe('canvas');
  });
});
