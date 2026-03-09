/**
 * Sprite sheet import pipeline.
 *
 * Loads an image file, auto-detects or accepts user-specified grid dimensions,
 * slices the sheet into FrameRect entries, and generates default animation clips.
 */

import type { FrameRect, SpriteSheetData, SpriteAnimClip, SliceMode } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Grid configuration for slicing a sprite sheet. */
export interface GridConfig {
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

/** Result returned by loadSpriteSheet. */
export interface SpriteSheetImportResult {
  /** The loaded image as an HTMLImageElement (for preview rendering). Optional when importing from server-side generation. */
  image?: HTMLImageElement;
  /** Original image width in pixels. */
  width: number;
  /** Original image height in pixels. */
  height: number;
  /** Auto-detected (or user-provided) grid configuration. */
  grid: GridConfig;
  /** The generated frame rectangles. */
  frames: FrameRect[];
}

// ---------------------------------------------------------------------------
// Accepted image MIME types
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// ---------------------------------------------------------------------------
// Common sprite sheet sizes
// ---------------------------------------------------------------------------

/**
 * Common frame dimensions found in standard sprite sheets.
 * Used by detectGridDimensions to guess a reasonable default.
 */
const COMMON_FRAME_SIZES = [16, 24, 32, 48, 64, 96, 128, 256] as const;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Load an image file into an HTMLImageElement.
 * Rejects if the file is not an accepted image type or fails to decode.
 */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return Promise.reject(new Error(`Unsupported image type "${file.type}". Accepted: PNG, JPG, WebP.`));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image file.'));
    };
    img.src = url;
  });
}

/**
 * Auto-detect grid dimensions from an image's pixel size.
 *
 * Strategy: pick the largest common frame size that divides evenly into both
 * width and height with at least 2 total frames. Falls back to treating the
 * entire image as a single frame.
 */
export function detectGridDimensions(width: number, height: number): GridConfig {
  let bestSize = 0;
  let bestCols = 1;
  let bestRows = 1;

  for (const size of COMMON_FRAME_SIZES) {
    if (size > width || size > height) continue;

    const cols = Math.floor(width / size);
    const rows = Math.floor(height / size);

    // Only accept if the frame size divides evenly (no leftover pixels).
    if (cols * size !== width || rows * size !== height) continue;

    const total = cols * rows;
    if (total >= 2 && size > bestSize) {
      bestSize = size;
      bestCols = cols;
      bestRows = rows;
    }
  }

  if (bestSize === 0) {
    // No common size fits -- default to a single-frame sheet.
    return { columns: 1, rows: 1, frameWidth: width, frameHeight: height };
  }

  return {
    columns: bestCols,
    rows: bestRows,
    frameWidth: bestSize,
    frameHeight: bestSize,
  };
}

/**
 * Slice a sprite sheet into FrameRect entries given rows & columns.
 * Frames are numbered left-to-right, top-to-bottom.
 */
export function sliceSheet(
  width: number,
  height: number,
  rows: number,
  cols: number,
): FrameRect[] {
  const frameW = Math.floor(width / cols);
  const frameH = Math.floor(height / rows);
  const frames: FrameRect[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      frames.push({
        index: r * cols + c,
        x: c * frameW,
        y: r * frameH,
        width: frameW,
        height: frameH,
      });
    }
  }

  return frames;
}

/**
 * Generate sensible default animation clips from a set of frames.
 *
 * Heuristic:
 * - 1 frame        -> "idle" (single frame, no loop)
 * - 2-4 frames     -> "idle" (all frames, loop)
 * - 5-8 frames     -> "idle" (first half), "walk" (second half)
 * - 9+ frames      -> "idle" (first third), "walk" (second third), "run" (last third)
 *
 * All clips default to 100 ms per frame (10 FPS) and looping.
 */
export function generateDefaultClips(
  frames: FrameRect[],
  _sheetName: string,
): Record<string, SpriteAnimClip> {
  const total = frames.length;
  const clips: Record<string, SpriteAnimClip> = {};

  const makeClip = (name: string, indices: number[], looping: boolean): SpriteAnimClip => ({
    name,
    frames: indices,
    frameDurations: { type: 'uniform', duration: 0.1 },
    looping,
    pingPong: false,
  });

  if (total <= 0) return clips;

  if (total <= 4) {
    clips['idle'] = makeClip('idle', range(0, total), total > 1);
  } else if (total <= 8) {
    const mid = Math.ceil(total / 2);
    clips['idle'] = makeClip('idle', range(0, mid), true);
    clips['walk'] = makeClip('walk', range(mid, total), true);
  } else {
    const third = Math.ceil(total / 3);
    const twoThirds = Math.ceil((total * 2) / 3);
    clips['idle'] = makeClip('idle', range(0, third), true);
    clips['walk'] = makeClip('walk', range(third, twoThirds), true);
    clips['run'] = makeClip('run', range(twoThirds, total), true);
  }

  return clips;
}

/**
 * Full import pipeline: load image -> detect grid -> slice -> generate clips.
 * Accepts optional user-specified rows/cols to override auto-detection.
 */
export async function loadSpriteSheet(
  file: File,
  overrideRows?: number,
  overrideCols?: number,
): Promise<SpriteSheetImportResult> {
  const image = await loadImageFile(file);
  const { naturalWidth: width, naturalHeight: height } = image;

  let grid: GridConfig;

  if (overrideRows != null && overrideCols != null && overrideRows > 0 && overrideCols > 0) {
    grid = {
      columns: overrideCols,
      rows: overrideRows,
      frameWidth: Math.floor(width / overrideCols),
      frameHeight: Math.floor(height / overrideRows),
    };
  } else {
    grid = detectGridDimensions(width, height);
  }

  const frames = sliceSheet(width, height, grid.rows, grid.columns);

  return { image, width, height, grid, frames };
}

/**
 * Build the final SpriteSheetData object from import results.
 */
export function buildSpriteSheetData(
  assetId: string,
  result: SpriteSheetImportResult,
  sheetName: string,
): SpriteSheetData {
  const { grid, frames } = result;

  const sliceMode: SliceMode = {
    type: 'grid',
    columns: grid.columns,
    rows: grid.rows,
    tileSize: [grid.frameWidth, grid.frameHeight],
    padding: [0, 0],
    offset: [0, 0],
  };

  const clips = generateDefaultClips(frames, sheetName);

  return {
    assetId,
    sliceMode,
    frames,
    clips,
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers for preview rendering
// ---------------------------------------------------------------------------

/**
 * Draw grid overlay lines on a canvas context.
 * Useful for previewing how the sheet will be sliced.
 */
export function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rows: number,
  cols: number,
  color = 'rgba(0, 200, 255, 0.6)',
): void {
  const frameW = width / cols;
  const frameH = height / rows;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  // Vertical lines
  for (let c = 1; c < cols; c++) {
    const x = Math.round(c * frameW) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Horizontal lines
  for (let r = 1; r < rows; r++) {
    const y = Math.round(r * frameH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

/**
 * Render a single frame from the sprite sheet onto a canvas.
 * Returns the canvas for display or further compositing.
 */
export function renderFrame(
  image: HTMLImageElement,
  frame: FrameRect,
  scale = 1,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width * scale;
  canvas.height = frame.height * scale;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      frame.x, frame.y, frame.width, frame.height,
      0, 0, canvas.width, canvas.height,
    );
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inclusive start, exclusive end range. */
function range(start: number, end: number): number[] {
  const arr: number[] = [];
  for (let i = start; i < end; i++) arr.push(i);
  return arr;
}
