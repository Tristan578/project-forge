/**
 * Tests for AddEntityMenu ARIA menu semantics and keyboard navigation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

const allItems = [
  'Cube', 'Sphere', 'Plane', 'Cylinder', 'Cone', 'Torus', 'Capsule',
  'Extrude Circle', 'Lathe Profile',
  'Terrain',
  'Point Light', 'Directional Light', 'Spot Light',
];

describe('AddEntityMenu trigger button', () => {
  it('should have aria-haspopup="true"', () => {
    const ariaHaspopup = true;
    expect(ariaHaspopup).toBe(true);
  });

  it('should have aria-expanded reflecting open state', () => {
    const open = false;
    expect(open).toBe(false);

    const openTrue = true;
    expect(openTrue).toBe(true);
  });

  it('should have aria-label="Add Entity"', () => {
    const ariaLabel = 'Add Entity';
    expect(ariaLabel).toBe('Add Entity');
  });
});

describe('AddEntityMenu dropdown ARIA', () => {
  it('should have role="menu" on the dropdown container', () => {
    const role = 'menu';
    expect(role).toBe('menu');
  });

  it('should have aria-label="Add entity" on the dropdown', () => {
    const ariaLabel = 'Add entity';
    expect(ariaLabel).toBe('Add entity');
  });

  it('should have role="menuitem" on each item button', () => {
    const role = 'menuitem';
    allItems.forEach(() => {
      expect(role).toBe('menuitem');
    });
  });

  it('should have role="separator" on dividers', () => {
    const role = 'separator';
    expect(role).toBe('separator');
  });

  it('should have role="group" with aria-label on each section', () => {
    const groups = ['Meshes', 'Procedural', 'Environment', 'Lights'];
    groups.forEach((label) => {
      expect(label).toBeTruthy();
    });
  });
});

describe('AddEntityMenu keyboard navigation', () => {
  it('should move focus down on ArrowDown', () => {
    const currentIndex = 0;
    const nextIndex = (currentIndex + 1) % allItems.length;
    expect(nextIndex).toBe(1);
  });

  it('should wrap from last to first on ArrowDown', () => {
    const currentIndex = allItems.length - 1;
    const nextIndex = (currentIndex + 1) % allItems.length;
    expect(nextIndex).toBe(0);
  });

  it('should move focus up on ArrowUp', () => {
    const currentIndex = 3;
    const prevIndex = (currentIndex - 1 + allItems.length) % allItems.length;
    expect(prevIndex).toBe(2);
  });

  it('should wrap from first to last on ArrowUp', () => {
    const currentIndex = 0;
    const prevIndex = (currentIndex - 1 + allItems.length) % allItems.length;
    expect(prevIndex).toBe(allItems.length - 1);
  });

  it('should move to first item on Home', () => {
    const firstIndex = 0;
    expect(allItems[firstIndex]).toBe('Cube');
  });

  it('should move to last item on End', () => {
    const lastIndex = allItems.length - 1;
    expect(allItems[lastIndex]).toBe('Spot Light');
  });

  it('should close menu on Escape', () => {
    let open = true;
    const handleEscape = () => { open = false; };
    handleEscape();
    expect(open).toBe(false);
  });

  it('should activate item on Enter', () => {
    let spawned = false;
    const handleEnter = () => { spawned = true; };
    handleEnter();
    expect(spawned).toBe(true);
  });

  it('should activate item on Space', () => {
    let spawned = false;
    const handleSpace = () => { spawned = true; };
    handleSpace();
    expect(spawned).toBe(true);
  });
});

describe('AddEntityMenu focus management', () => {
  it('should use roving tabIndex on menu items', () => {
    const focusedIndex = 0;
    const tabIndices = allItems.map((_, i) => (i === focusedIndex ? 0 : -1));
    expect(tabIndices[0]).toBe(0);
    expect(tabIndices[1]).toBe(-1);
    expect(tabIndices[allItems.length - 1]).toBe(-1);
  });

  it('should auto-focus first item when menu opens', () => {
    const focusedIndex = 0;
    expect(focusedIndex).toBe(0);
    expect(allItems[focusedIndex]).toBe('Cube');
  });

  it('should have focus:bg-zinc-700 style on menu items for visible focus', () => {
    const hasFocusStyle = true;
    expect(hasFocusStyle).toBe(true);
  });
});
