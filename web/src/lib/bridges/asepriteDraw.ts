import 'server-only';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { executeOperation } from './asepriteBridge';

/**
 * Pixel art as DATA, drawn by the fixed `drawFrames.lua` template (#10271).
 *
 * This is the only way model output reaches Aseprite: the model (or a client)
 * supplies a palette and per-frame grids of palette indices, which are
 * validated here and serialised into the template as data. No model- or
 * client-written Lua ever runs, because the bridge executes Lua on the server
 * and Aseprite's Lua has `os` and `io` (see the #7579 decomposition).
 */

export const PIXEL_ART_LIMITS = {
  maxSize: 64,
  maxFrames: 16,
  maxColors: 32,
  minFrameDurationMs: 10,
  maxFrameDurationMs: 10_000,
} as const;

const HEX_COLOR = /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/**
 * `palette[i - 1]` is the colour for index `i`; index 0 is transparent.
 * `frames[f]` is row-major, `width * height` indices long.
 */
export const pixelArtSchema = z
  .object({
    width: z.number().int().min(1).max(PIXEL_ART_LIMITS.maxSize),
    height: z.number().int().min(1).max(PIXEL_ART_LIMITS.maxSize),
    palette: z
      .array(z.string().regex(HEX_COLOR, 'palette entries are 6- or 8-digit hex colours'))
      .min(1)
      .max(PIXEL_ART_LIMITS.maxColors),
    frames: z
      .array(z.array(z.number().int().min(0)))
      .min(1)
      .max(PIXEL_ART_LIMITS.maxFrames),
    frameDurationMs: z
      .number()
      .int()
      .min(PIXEL_ART_LIMITS.minFrameDurationMs)
      .max(PIXEL_ART_LIMITS.maxFrameDurationMs)
      .default(100),
  })
  .superRefine((art, ctx) => {
    const cells = art.width * art.height;
    art.frames.forEach((frame, f) => {
      if (frame.length !== cells) {
        ctx.addIssue({
          code: 'custom',
          path: ['frames', f],
          message: `frame ${f} has ${frame.length} pixels; a ${art.width}x${art.height} sprite needs ${cells}`,
        });
        return;
      }
      const bad = frame.findIndex((index) => index > art.palette.length);
      if (bad !== -1) {
        ctx.addIssue({
          code: 'custom',
          path: ['frames', f, bad],
          message: `index ${frame[bad]} is outside the ${art.palette.length}-colour palette`,
        });
      }
    });
  });

export type PixelArt = z.output<typeof pixelArtSchema>;

/** Validate untrusted pixel art. Throws a ZodError naming the first problem. */
export function parsePixelArt(input: unknown): PixelArt {
  return pixelArtSchema.parse(input);
}

/** Two lowercase hex characters per index, row-major, frame after frame. */
export function encodePixelData(art: PixelArt): string {
  let out = '';
  for (const frame of art.frames) {
    for (const index of frame) out += index.toString(16).padStart(2, '0');
  }
  return out;
}

/** One frame's rectangle in the exported sheet, from Aseprite's JSON. */
export interface SheetFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  durationMs: number;
}

export type DrawResult =
  | { success: true; png: Buffer; frames: SheetFrame[]; sheetWidth: number; sheetHeight: number }
  | { success: false; error: string };

interface AsepriteSheetJson {
  frames: Array<{ frame: { x: number; y: number; w: number; h: number }; duration: number }>;
  meta?: { size?: { w: number; h: number } };
}

const TEMP_DIR = join(tmpdir(), 'spawnforge-bridge');

/**
 * Draw pixel art in Aseprite and return the horizontal sprite sheet.
 *
 * The output paths are generated here, under the bridge's temp directory, and
 * deleted before returning; no caller can choose where Aseprite writes.
 */
export async function drawPixelArt(binaryPath: string, input: unknown): Promise<DrawResult> {
  const art = parsePixelArt(input);
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
  const id = randomUUID();
  const outputPng = join(TEMP_DIR, `${id}.png`);
  const outputJson = join(TEMP_DIR, `${id}.json`);

  try {
    const result = await executeOperation(binaryPath, {
      name: 'drawFrames',
      params: {
        width: art.width,
        height: art.height,
        frameCount: art.frames.length,
        frameDuration: art.frameDurationMs,
        paletteColors: art.palette.join(','),
        pixelData: encodePixelData(art),
        // Lua strings take forward slashes on every platform; backslashes
        // would be escaped by the template renderer but read worse in logs.
        outputPng: outputPng.replace(/\\/g, '/'),
        outputJson: outputJson.replace(/\\/g, '/'),
      },
    });
    if (!result.success) {
      return { success: false, error: result.error ?? 'Aseprite did not draw the sprite' };
    }
    if (!existsSync(outputPng) || !existsSync(outputJson)) {
      return { success: false, error: 'Aseprite reported success but wrote no sprite sheet' };
    }
    const sheet = JSON.parse(readFileSync(outputJson, 'utf-8')) as AsepriteSheetJson;
    const frames = sheet.frames.map((f) => ({ ...f.frame, durationMs: f.duration }));
    if (frames.length !== art.frames.length) {
      return {
        success: false,
        error: `Aseprite exported ${frames.length} frames; ${art.frames.length} were drawn`,
      };
    }
    return {
      success: true,
      png: readFileSync(outputPng),
      frames,
      sheetWidth: sheet.meta?.size?.w ?? art.width * art.frames.length,
      sheetHeight: sheet.meta?.size?.h ?? art.height,
    };
  } finally {
    for (const path of [outputPng, outputJson]) {
      try {
        unlinkSync(path);
      } catch {
        /* never written, or already gone */
      }
    }
  }
}
