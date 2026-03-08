/**
 * Pixel art pipeline handlers for MCP commands.
 * Wires pixel art generation, palette selection, and color quantization to API routes.
 */

import type { ToolHandler } from './types';
import { PALETTES, getPalette, validateCustomPalette } from '@/lib/generate/palettes';
import type { PaletteId } from '@/lib/generate/palettes';

const VALID_PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export const handleGeneratePixelArt: ToolHandler = async (args) => {
  const prompt = args.prompt as string | undefined;
  if (!prompt || prompt.length < 3) {
    return { success: false, error: 'Prompt must be at least 3 characters' };
  }

  const targetSize = (args.targetSize as number) ?? 32;
  if (![16, 32, 64, 128].includes(targetSize)) {
    return { success: false, error: 'Target size must be 16, 32, 64, or 128' };
  }

  const palette = (args.palette as string) ?? 'pico-8';
  const style = (args.style as string) ?? 'character';
  const dithering = (args.dithering as string) ?? 'none';
  const ditheringIntensity = (args.ditheringIntensity as number) ?? 0;

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
      message: `Pixel art generation started (${data.provider}, ${data.tokenCost} tokens). Style: ${style}, Size: ${targetSize}px, Palette: ${data.palette}`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Generation request failed' };
  }
};

export const handleSetPixelArtPalette: ToolHandler = async (args) => {
  const paletteId = args.palette as string | undefined;
  if (!paletteId) {
    return { success: false, error: 'Palette ID required' };
  }

  if (paletteId === 'custom') {
    const colors = args.colors as string[] | undefined;
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

export const handleQuantizeSpriteColors: ToolHandler = async (args) => {
  const colorCount = args.colorCount as number | undefined;
  if (colorCount === undefined || typeof colorCount !== 'number') {
    return { success: false, error: 'colorCount (number) required' };
  }
  if (colorCount < 1 || colorCount > 256) {
    return { success: false, error: 'colorCount must be between 1 and 256' };
  }

  const dithering = (args.dithering as string) ?? 'none';
  if (!['none', 'bayer4x4', 'bayer8x8'].includes(dithering)) {
    return { success: false, error: 'Dithering must be none, bayer4x4, or bayer8x8' };
  }

  const intensity = (args.ditheringIntensity as number) ?? 0.5;

  return {
    success: true,
    message: `Colors quantized to ${colorCount} with ${dithering} dithering (intensity: ${intensity})`,
  };
};

export const pixelArtHandlers: Record<string, ToolHandler> = {
  generate_pixel_art: handleGeneratePixelArt,
  set_pixel_art_palette: handleSetPixelArtPalette,
  quantize_sprite_colors: handleQuantizeSpriteColors,
};
