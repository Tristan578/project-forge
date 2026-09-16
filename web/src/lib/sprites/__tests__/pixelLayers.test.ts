/**
 * Tests for the Pixel Art Editor multi-layer data model.
 *
 * Operation family `pixel.FR-1.OP-01` (Layers, selections and palette editing),
 * layer-model portion — parent issue #9817, delivered under #10094.
 *
 * Covers: create/migrate, add/delete (at-least-one-layer invariant), reorder and
 * move up/down bounds, visibility/rename/opacity/grid patches, and alpha
 * compositing (ordering, opacity blend, hidden-layer exclusion, top-opaque
 * coverage, empty stack).
 */

import { describe, it, expect } from 'vitest';
import {
  createGrid,
  cloneGrid,
  colorsEqual,
  createLayer,
  fromFlatGrid,
  addLayer,
  deleteLayer,
  reorderLayer,
  moveLayerUp,
  moveLayerDown,
  setLayerVisibility,
  toggleLayerVisibility,
  renameLayer,
  setLayerOpacity,
  clampOpacity,
  setLayerGrid,
  compositeLayers,
  flattenLayers,
  type Layer,
  type RGBA,
} from '../pixelLayers';

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];

function filled(size: number, color: RGBA): RGBA[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => [...color] as RGBA)
  );
}

describe('createLayer', () => {
  it('creates a layer with a fresh transparent grid of the given size', () => {
    const layer = createLayer(8, { id: 'a', name: 'Base' });
    expect(layer.id).toBe('a');
    expect(layer.name).toBe('Base');
    expect(layer.visible).toBe(true);
    expect(layer.opacity).toBe(1);
    expect(layer.grid).toHaveLength(8);
    expect(layer.grid[0][0]).toEqual([0, 0, 0, 0]);
  });

  it('clones a provided grid so the layer owns its data', () => {
    const src = filled(4, RED);
    const layer = createLayer(4, { grid: src });
    layer.grid[0][0] = [...GREEN];
    expect(src[0][0]).toEqual(RED); // source untouched
  });

  it('clamps opacity into 0..1', () => {
    expect(createLayer(2, { opacity: 2 }).opacity).toBe(1);
    expect(createLayer(2, { opacity: -3 }).opacity).toBe(0);
    expect(createLayer(2, { opacity: 0.4 }).opacity).toBe(0.4);
  });

  it('assigns unique ids when none is provided', () => {
    const a = createLayer(2);
    const b = createLayer(2);
    expect(a.id).not.toBe(b.id);
  });
});

describe('clampOpacity', () => {
  it('handles non-finite input by returning 1', () => {
    expect(clampOpacity(Number.NaN)).toBe(1);
    expect(clampOpacity(Infinity)).toBe(1);
  });
});

describe('fromFlatGrid', () => {
  it('wraps a legacy flat grid as a single default layer', () => {
    const grid = filled(4, BLUE);
    const layers = fromFlatGrid(grid);
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe('Layer 1');
    expect(layers[0].grid[0][0]).toEqual(BLUE);
    // Cloned, not aliased.
    layers[0].grid[0][0] = [...RED];
    expect(grid[0][0]).toEqual(BLUE);
  });
});

describe('addLayer', () => {
  it('appends a new layer on top with an auto name', () => {
    const layers = [createLayer(4, { name: 'Layer 1' })];
    const next = addLayer(layers, 4);
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe('Layer 2');
    // Original array not mutated.
    expect(layers).toHaveLength(1);
  });
});

describe('deleteLayer', () => {
  it('removes the layer at the index', () => {
    const layers = [
      createLayer(4, { id: '1' }),
      createLayer(4, { id: '2' }),
      createLayer(4, { id: '3' }),
    ];
    const next = deleteLayer(layers, 1);
    expect(next.map((l) => l.id)).toEqual(['1', '3']);
  });

  it('refuses to delete the last remaining layer (>=1 invariant)', () => {
    const layers = [createLayer(4, { id: 'only' })];
    expect(deleteLayer(layers, 0)).toBe(layers);
  });

  it('ignores an out-of-range index', () => {
    const layers = [createLayer(4), createLayer(4)];
    expect(deleteLayer(layers, 9)).toBe(layers);
  });
});

describe('reorderLayer / moveLayerUp / moveLayerDown', () => {
  const base = (): Layer[] => [
    createLayer(4, { id: 'a' }),
    createLayer(4, { id: 'b' }),
    createLayer(4, { id: 'c' }),
  ];

  it('moves a layer from one index to another', () => {
    expect(reorderLayer(base(), 0, 2).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for equal or out-of-range indices', () => {
    const layers = base();
    expect(reorderLayer(layers, 1, 1)).toBe(layers);
    expect(reorderLayer(layers, -1, 2)).toBe(layers);
    expect(reorderLayer(layers, 0, 5)).toBe(layers);
  });

  it('moveLayerUp increases the index and is bounded at the top', () => {
    expect(moveLayerUp(base(), 0).map((l) => l.id)).toEqual(['b', 'a', 'c']);
    const layers = base();
    expect(moveLayerUp(layers, 2)).toBe(layers); // already top
  });

  it('moveLayerDown decreases the index and is bounded at the bottom', () => {
    expect(moveLayerDown(base(), 2).map((l) => l.id)).toEqual(['a', 'c', 'b']);
    const layers = base();
    expect(moveLayerDown(layers, 0)).toBe(layers); // already bottom
  });
});

describe('visibility / rename / opacity / grid patches', () => {
  it('sets and toggles visibility without mutating the input', () => {
    const layers = [createLayer(4, { visible: true })];
    const hidden = setLayerVisibility(layers, 0, false);
    expect(hidden[0].visible).toBe(false);
    expect(layers[0].visible).toBe(true);
    expect(toggleLayerVisibility(hidden, 0)[0].visible).toBe(true);
  });

  it('renames a layer but ignores blank names', () => {
    const layers = [createLayer(4, { name: 'Old' })];
    expect(renameLayer(layers, 0, 'New')[0].name).toBe('New');
    expect(renameLayer(layers, 0, '   ')).toBe(layers);
  });

  it('sets clamped opacity', () => {
    const layers = [createLayer(4)];
    expect(setLayerOpacity(layers, 0, 0.25)[0].opacity).toBe(0.25);
    expect(setLayerOpacity(layers, 0, 5)[0].opacity).toBe(1);
  });

  it('replaces the active layer grid', () => {
    const layers = [createLayer(2), createLayer(2)];
    const newGrid = filled(2, RED);
    const next = setLayerGrid(layers, 1, newGrid);
    expect(next[1].grid[0][0]).toEqual(RED);
    expect(next[0].grid[0][0]).toEqual([0, 0, 0, 0]);
    expect(layers[1].grid[0][0]).toEqual([0, 0, 0, 0]); // input untouched
  });
});

describe('compositeLayers', () => {
  it('returns a fully transparent grid for an empty stack', () => {
    const out = compositeLayers([], 3);
    expect(out).toHaveLength(3);
    for (const row of out) {
      for (const px of row) expect(px).toEqual([0, 0, 0, 0]);
    }
  });

  it('returns a single opaque layer unchanged', () => {
    const layer = createLayer(2, { grid: filled(2, RED) });
    const out = compositeLayers([layer], 2);
    expect(out[0][0]).toEqual(RED);
  });

  it('paints later (top) layers over earlier ones when opaque', () => {
    const bottom = createLayer(2, { grid: filled(2, RED) });
    const top = createLayer(2, { grid: filled(2, GREEN) });
    const out = compositeLayers([bottom, top], 2);
    expect(out[0][0]).toEqual(GREEN);
  });

  it('excludes a hidden layer from the composite', () => {
    const bottom = createLayer(2, { grid: filled(2, RED) });
    const top = createLayer(2, { grid: filled(2, GREEN), visible: false });
    const out = compositeLayers([bottom, top], 2);
    expect(out[0][0]).toEqual(RED);
  });

  it('blends a half-opacity top layer over an opaque bottom layer', () => {
    const bottom = createLayer(2, { grid: filled(2, [0, 0, 0, 255]) }); // black
    const top = createLayer(2, { grid: filled(2, [255, 255, 255, 255]), opacity: 0.5 });
    const out = compositeLayers([bottom, top], 2);
    // 50% white over black → mid grey, fully opaque.
    expect(out[0][0][3]).toBe(255);
    expect(out[0][0][0]).toBeGreaterThanOrEqual(126);
    expect(out[0][0][0]).toBeLessThanOrEqual(129);
    expect(out[0][0][0]).toBe(out[0][0][1]);
    expect(out[0][0][1]).toBe(out[0][0][2]);
  });

  it('leaves lower layers showing through a transparent hole in the top layer', () => {
    const bottomGrid = filled(2, RED);
    const topGrid = filled(2, GREEN);
    topGrid[0][0] = [0, 0, 0, 0]; // hole
    const out = compositeLayers(
      [createLayer(2, { grid: bottomGrid }), createLayer(2, { grid: topGrid })],
      2
    );
    expect(out[0][0]).toEqual(RED); // shows bottom through the hole
    expect(out[0][1]).toEqual(GREEN);
  });

  it('does not mutate its input layers', () => {
    const grid = filled(2, RED);
    const layer = createLayer(2, { grid });
    compositeLayers([layer], 2);
    expect(layer.grid[0][0]).toEqual(RED);
  });

  it('flattenLayers is an alias for compositeLayers', () => {
    const layers = [createLayer(2, { grid: filled(2, BLUE) })];
    expect(flattenLayers(layers, 2)).toEqual(compositeLayers(layers, 2));
  });
});

describe('grid primitives', () => {
  it('createGrid / cloneGrid / colorsEqual behave', () => {
    const g = createGrid(3);
    expect(g).toHaveLength(3);
    const c = cloneGrid(g);
    c[0][0] = [...RED];
    expect(g[0][0]).toEqual([0, 0, 0, 0]);
    expect(colorsEqual(RED, [255, 0, 0, 255])).toBe(true);
    expect(colorsEqual(RED, GREEN)).toBe(false);
  });
});
