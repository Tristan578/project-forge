/**
 * Pixel art pipeline handlers for MCP commands.
 * Wires pixel art generation, palette selection, and color quantization to API routes.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { parseArgs } from './types';
import { PALETTES, getPalette, validateCustomPalette } from '@/lib/generate/palettes';
import type { PaletteId } from '@/lib/generate/palettes';

const VALID_PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
const VALID_SIZES = [16, 32, 64, 128] as const;
const VALID_DITHERING = ['none', 'bayer4x4', 'bayer8x8'] as const;
const VALID_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'] as const;

const generatePixelArtSchema = z.object({
  prompt: z.string().min(3, 'Prompt must be at least 3 characters'),
  targetSize: z.number().refine((n) => (VALID_SIZES as readonly number[]).includes(n), {
    message: `Target size must be ${VALID_SIZES.join(', ')}`,
  }).optional().default(32),
  palette: z.string().optional().default('pico-8'),
  style: z.enum(VALID_STYLES).optional().default('character'),
  dithering: z.enum(VALID_DITHERING).optional().default('none'),
  ditheringIntensity: z.number().min(0).max(1).optional().default(0),
});

const setPaletteSchema = z.object({
  palette: z.string().min(1, 'Palette ID required'),
  colors: z.array(z.string()).optional(),
});

const quantizeSchema = z.object({
  colorCount: z.number().int().min(1).max(256, 'colorCount must be between 1 and 256'),
  dithering: z.enum(VALID_DITHERING).optional().default('none'),
  ditheringIntensity: z.number().min(0).max(1).optional().default(0.5),
});

export const handleGeneratePixelArt: ToolHandler = async (args): Promise<ExecutionResult> => {
  const p = parseArgs(generatePixelArtSchema, args);
  if (p.error) return p.error;

  const { prompt, targetSize, palette, style, dithering, ditheringIntensity } = p.data;

  try {
    const response = await fetch('/api/generate/pixel-art', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, targetSize, palette, style, dithering, ditheringIntensity }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error ?? 'Generation failed' };
    }

    const data = await response.json();
    return {
      success: true,
      result: { jobId: data.jobId, provider: data.provider, usageId: data.usageId, tokenCost: data.tokenCost },
      message: `Pixel art generation started (${data.provider}, ${data.tokenCost} tokens). Style: ${style}, Size: ${targetSize}px, Palette: ${data.palette}`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Generation request failed' };
  }
};

export const handleSetPixelArtPalette: ToolHandler = async (args): Promise<ExecutionResult> => {
  const p = parseArgs(setPaletteSchema, args);
  if (p.error) return p.error;

  const { palette: paletteId, colors } = p.data;

  if (paletteId === 'custom') {
    if (!colors) {
      return { success: false, error: 'Colors array required for custom palette' };
    }
    const validation = validateCustomPalette(colors);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    return { success: true, message: `Custom palette set with ${colors.length} colors` };
  }

  if (!VALID_PALETTE_IDS.includes(paletteId as PaletteId)) {
    return { success: false, error: `Unknown palette: ${paletteId}. Available: ${VALID_PALETTE_IDS.join(', ')}` };
  }

  const palette = getPalette(paletteId as PaletteId);
  return {
    success: true,
    message: `Palette set to ${palette!.name} (${palette!.colors.length} colors)`,
  };
};

export const handleQuantizeSpriteColors: ToolHandler = async (args): Promise<ExecutionResult> => {
  const p = parseArgs(quantizeSchema, args);
  if (p.error) return p.error;

  const { colorCount, dithering, ditheringIntensity } = p.data;

  return {
    success: true,
    message: `Colors quantized to ${colorCount} with ${dithering} dithering (intensity: ${ditheringIntensity})`,
  };
};

export const pixelArtHandlers: Record<string, ToolHandler> = {
  generate_pixel_art: handleGeneratePixelArt,
  set_pixel_art_palette: handleSetPixelArtPalette,
  quantize_sprite_colors: handleQuantizeSpriteColors,
};
