/**
 * pixelLayers — frontend manual multi-layer data model for the Pixel Art Editor.
 *
 * Operation family `pixel.FR-1.OP-01` (Layers, selections and palette editing),
 * layer-model portion. Parent issue #9817.
 *
 * A sprite is an ordered array of {@link Layer}s. Index 0 is the BOTTOM layer;
 * the last index is the TOP layer (painted last, i.e. on top). Each layer owns
 * its own pixel grid, plus visibility and opacity. Operations never mutate their
 * inputs; unchanged layer/grid records are shared and must be treated as immutable.
 * Identity generation is stateful. This editor-local model does not define a durable
 * engine layer format or AI parity; the remaining work under #9817 stays open.
 *
 * This module deliberately contains no DOM access so it can be unit-tested in
 * the node pool and imported by non-client code.
 */

/** A single pixel: red, green, blue, alpha — each channel 0..255. */
export type RGBA = [number, number, number, number];

/** A square pixel grid indexed as `grid[y][x]`. */
export type PixelGrid = RGBA[][];

/** A named, ordered, independently-visible drawing layer. */
export interface Layer {
  /** Stable unique id (used as a React key and for reorder identity). */
  id: string;
  /** Human-readable label shown in the layer panel. */
  name: string;
  /** Whether this layer contributes to the composite. */
  visible: boolean;
  /** Layer-wide opacity; the factory/setter clamp to 0..1, raw records must supply valid values. */
  opacity: number;
  /** This layer's own pixel data. */
  grid: PixelGrid;
}

/** Fully transparent pixel. */
export const TRANSPARENT: RGBA = [0, 0, 0, 0];

/* ─── Grid primitives (pure, DOM-free) ───────────────────────────────────── */

/**
 * Create a `size`×`size` grid of transparent pixels.
 * @param size Nonnegative integer side length; the caller bounds allocation.
 * @returns A fresh square grid with independent transparent pixel tuples.
 */
export function createGrid(size: number): PixelGrid {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => [...TRANSPARENT] as RGBA)
  );
}

/**
 * Deep-clone a grid so callers can mutate the copy freely.
 * @param grid Rectangular rows of RGBA pixel tuples to copy.
 * @returns A deep copy of rows and tuples; channel edits do not affect the input.
 */
export function cloneGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => row.map((px) => [...px] as RGBA));
}

/**
 * Channel-exact equality for two pixels.
 * @param a First RGBA tuple with channels from 0 to 255.
 * @param b Second RGBA tuple with channels from 0 to 255.
 * @returns Whether all four channels match exactly.
 */
export function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/* ─── Layer identity ─────────────────────────────────────────────────────── */

let layerIdCounter = 0;

/**
 * Generate a process-unique layer id.
 * @returns A new process-unique ID; increments module state and reads the current time.
 */
export function nextLayerId(): string {
  layerIdCounter += 1;
  return `layer-${Date.now().toString(36)}-${layerIdCounter}`;
}

/* ─── Layer factory ──────────────────────────────────────────────────────── */

/** Optional identity, appearance and initial data for a new layer. */
export interface CreateLayerOptions {
  /** Stable ID; omitted values use the stateful ID generator. */
  id?: string;
  /** Display name, default Layer (or the stack action default). */
  name?: string;
  /** Include the layer in composites, default true. */
  visible?: boolean;
  /** Opacity multiplier, default 1; clamped with nonfinite values falling back to 1. */
  opacity?: number;
  /** Provide an existing grid instead of a fresh transparent one (cloned in). */
  grid?: PixelGrid;
}

/**
 * Clamp a raw opacity to the valid 0..1 range; non-finite → 1.
 * @param value Raw opacity multiplier.
 * @returns A value from 0 to 1; nonfinite input returns 1.
 */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Build a new {@link Layer}. When `grid` is supplied it is cloned so the layer
 * owns its data; otherwise a fresh transparent `size`×`size` grid is created.
 * @param size Nonnegative integer grid size used when opts.grid is absent.
 * @param opts Initial fields; defaults are generated ID, Layer, visible true and opacity 1.
 * @returns A new layer that owns a cloned supplied grid or a fresh transparent grid.
 */
export function createLayer(size: number, opts: CreateLayerOptions = {}): Layer {
  return {
    id: opts.id ?? nextLayerId(),
    name: opts.name ?? 'Layer',
    visible: opts.visible ?? true,
    opacity: clampOpacity(opts.opacity ?? 1),
    grid: opts.grid ? cloneGrid(opts.grid) : createGrid(size),
  };
}

/**
 * Migrate a legacy single flat grid into a one-layer stack. Any code path that
 * loads a pre-layers sprite should route it through here so it becomes editable
 * as the default layer.
 * @param grid Legacy square RGBA grid; copied into the new layer.
 * @param name Display name, default Layer 1.
 * @returns A new one-layer editor stack with independent pixel data.
 */
export function fromFlatGrid(grid: PixelGrid, name = 'Layer 1'): Layer[] {
  return [createLayer(grid.length, { name, grid })];
}

/* ─── Stack operations (no-ops may preserve array identity) ───────────────────────────── */

/**
 * Append a new layer on top of the stack.
 * @param layers Existing immutable bottom-to-top stack.
 * @param size Nonnegative integer side length for a fresh grid.
 * @param opts New-layer options; the default name is Layer followed by stack length plus one.
 * @returns A new array with a new top layer; existing layer/grid records remain shared.
 */
export function addLayer(
  layers: Layer[],
  size: number,
  opts: CreateLayerOptions = {}
): Layer[] {
  const name = opts.name ?? `Layer ${layers.length + 1}`;
  return [...layers, createLayer(size, { ...opts, name })];
}

/**
 * Delete the layer at `index`. Refuses to remove the final remaining layer —
 * a sprite always has at least one layer — and returns the array unchanged if
 * the index is out of range or would empty the stack.
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer layer index to remove.
 * @returns A new array sharing retained records, or the original array for invalid indices/final layer.
 */
export function deleteLayer(layers: Layer[], index: number): Layer[] {
  if (layers.length <= 1) return layers;
  if (index < 0 || index >= layers.length) return layers;
  return layers.filter((_, i) => i !== index);
}

/**
 * Move the layer at `from` to position `to`, shifting the rest. Out-of-range
 * indices return the array unchanged.
 * @param layers Existing immutable bottom-to-top stack.
 * @param from Integer source index.
 * @param to Integer destination index.
 * @returns A reordered array sharing records, or the original for invalid/equal indices.
 */
export function reorderLayer(layers: Layer[], from: number, to: number): Layer[] {
  if (from < 0 || from >= layers.length) return layers;
  if (to < 0 || to >= layers.length) return layers;
  if (from === to) return layers;
  const next = [...layers];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Move a layer one step toward the top of the stack (higher index).
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index to move toward the top.
 * @returns A reordered array sharing records, or the original at invalid/top bounds.
 */
export function moveLayerUp(layers: Layer[], index: number): Layer[] {
  if (index < 0 || index >= layers.length - 1) return layers;
  return reorderLayer(layers, index, index + 1);
}

/**
 * Move a layer one step toward the bottom of the stack (lower index).
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index to move toward the bottom.
 * @returns A reordered array sharing records, or the original at invalid/bottom bounds.
 */
export function moveLayerDown(layers: Layer[], index: number): Layer[] {
  if (index <= 0 || index >= layers.length) return layers;
  return reorderLayer(layers, index, index - 1);
}

/** Replace fields of the layer at `index` with a shallow merge. */
function patchLayer(layers: Layer[], index: number, patch: Partial<Layer>): Layer[] {
  if (index < 0 || index >= layers.length) return layers;
  return layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
}

/**
 * Set a layer's visibility explicitly.
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index to update.
 * @param visible Whether the layer contributes to compositing.
 * @returns A new array and patched record sharing its grid, or the original for an invalid index.
 */
export function setLayerVisibility(
  layers: Layer[],
  index: number,
  visible: boolean
): Layer[] {
  return patchLayer(layers, index, { visible });
}

/**
 * Flip a layer's visibility.
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index whose visibility is inverted.
 * @returns A new array and patched record sharing its grid, or the original for an invalid index.
 */
export function toggleLayerVisibility(layers: Layer[], index: number): Layer[] {
  if (index < 0 || index >= layers.length) return layers;
  return patchLayer(layers, index, { visible: !layers[index].visible });
}

/**
 * Rename a layer. Empty/whitespace names are ignored to keep the panel legible.
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index to rename.
 * @param name Nonblank display name, retained as supplied.
 * @returns A patched array sharing grids, or the original for a blank name/invalid index.
 */
export function renameLayer(layers: Layer[], index: number, name: string): Layer[] {
  if (name.trim().length === 0) return layers;
  return patchLayer(layers, index, { name });
}

/**
 * Set a layer's opacity (clamped to 0..1).
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index to update.
 * @param opacity Raw opacity; finite values clamp to 0..1 and nonfinite values become 1.
 * @returns A patched array sharing grids, or the original for an invalid index.
 */
export function setLayerOpacity(
  layers: Layer[],
  index: number,
  opacity: number
): Layer[] {
  return patchLayer(layers, index, { opacity: clampOpacity(opacity) });
}

/**
 * Replace a layer's grid (used by draw/erase/fill on the active layer).
 * @param layers Existing immutable bottom-to-top stack.
 * @param index Integer index to update.
 * @param grid Replacement square RGBA grid, retained by reference; do not mutate it afterward.
 * @returns A patched array retaining the supplied grid and unchanged records, or original for invalid index.
 */
export function setLayerGrid(
  layers: Layer[],
  index: number,
  grid: PixelGrid
): Layer[] {
  return patchLayer(layers, index, { grid });
}

/* ─── Compositing ────────────────────────────────────────────────────────── */

/**
 * Alpha-composite every visible layer, bottom (index 0) to top (last index),
 * into a single `size`×`size` grid using the standard source-over operator with
 * per-layer opacity folded into the source alpha. The returned grid is fresh and
 * owns its pixels; inputs are never mutated. Hidden layers and fully-transparent
 * pixels contribute nothing.
 * @param layers Immutable bottom-to-top layers with valid RGBA channels and opacity from 0 to 1.
 * @param size Nonnegative integer output side length; missing rows/pixels contribute nothing.
 * @returns A fresh independently owned grid of rounded source-over RGBA pixels.
 */
export function compositeLayers(layers: Layer[], size: number): PixelGrid {
  const out = createGrid(size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Accumulator in straight (non-premultiplied) float form, alpha 0..1.
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (const layer of layers) {
        if (!layer.visible || layer.opacity <= 0) continue;
        const row = layer.grid[y];
        if (!row) continue;
        const px = row[x];
        if (!px) continue;
        const srcA = (px[3] / 255) * layer.opacity;
        if (srcA <= 0) continue;

        const outA = srcA + accA * (1 - srcA);
        if (outA <= 0) continue;
        accR = (px[0] * srcA + accR * accA * (1 - srcA)) / outA;
        accG = (px[1] * srcA + accG * accA * (1 - srcA)) / outA;
        accB = (px[2] * srcA + accB * accA * (1 - srcA)) / outA;
        accA = outA;
      }

      out[y][x] = [
        Math.round(accR),
        Math.round(accG),
        Math.round(accB),
        Math.round(accA * 255),
      ];
    }
  }

  return out;
}

/**
 * Flatten a layer stack to a single opaque-capable grid for export/apply. This
 * is compositing under a different name so export intent reads clearly at call
 * sites.
 * @param layers Immutable bottom-to-top layers with valid RGBA channels and opacity from 0 to 1.
 * @param size Nonnegative integer side length of the exported composite.
 * @returns A fresh composite grid; layer metadata is not retained in this flattened output.
 */
export function flattenLayers(layers: Layer[], size: number): PixelGrid {
  return compositeLayers(layers, size);
}
