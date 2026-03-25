/**
 * Pixel art pipeline handlers for MCP commands.
 * Wires pixel art generation, palette selection, and color quantization to API routes.
 */

import type { ToolHandler, ExecutionResult } from './types';
import { PALETTES, getPalette, validateCustomPalette } from '@/lib/generate/palettes';
import type { PaletteId } from '@/lib/generate/palettes';
import { trackJob, makeJobId } from './generationHandlers';

const VALID_PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
const VALID_SIZES = [16, 32, 64, 128] as const;
const VALID_DITHERING = ['none', 'bayer4x4', 'bayer8x8'] as const;
const VALID_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'] as const;

type DitheringMode = (typeof VALID_DITHERING)[number];
type PixelArtStyle = (typeof VALID_STYLES)[number];

export const handleGeneratePixelArt: ToolHandler = async (args): Promise<ExecutionResult> => {
  const prompt = args['prompt'];
  if (typeof prompt !== 'string' || prompt.length < 3) {
    return { success: false, error: 'Invalid arguments: prompt: Prompt must be at least 3 characters' };
  }

  const rawTargetSize = args['targetSize'] ?? 32;
  const targetSize = typeof rawTargetSize === 'number' ? rawTargetSize : Number(rawTargetSize);
  if (!(VALID_SIZES as readonly number[]).includes(targetSize)) {
    return { success: false, error: `Invalid arguments: targetSize: Target size must be ${VALID_SIZES.join(', ')}` };
  }

  const palette = typeof args['palette'] === 'string' ? args['palette'] : 'pico-8';
  if (!VALID_PALETTE_IDS.includes(palette as PaletteId)) {
    return { success: false, error: `Invalid arguments: palette: Palette must be one of: ${Object.keys(PALETTES).join(', ')}` };
  }

  const rawStyle = args['style'] ?? 'character';
  if (typeof rawStyle !== 'string' || !(VALID_STYLES as readonly string[]).includes(rawStyle)) {
    return { success: false, error: `Invalid arguments: style: Must be one of: ${VALID_STYLES.join(', ')}` };
  }
  const style = rawStyle as PixelArtStyle;

  const rawDithering = args['dithering'] ?? 'none';
  if (typeof rawDithering !== 'string' || !(VALID_DITHERING as readonly string[]).includes(rawDithering)) {
    return { success: false, error: `Invalid arguments: dithering: Must be one of: ${VALID_DITHERING.join(', ')}` };
  }
  const dithering = rawDithering as DitheringMode;

  const rawIntensity = args['ditheringIntensity'] ?? 0;
  const ditheringIntensity = typeof rawIntensity === 'number' ? rawIntensity : Number(rawIntensity);
  if (!Number.isFinite(ditheringIntensity) || ditheringIntensity < 0 || ditheringIntensity > 1) {
    return { success: false, error: 'Invalid arguments: ditheringIntensity: Must be between 0 and 1' };
  }

  const entityId = typeof args['entityId'] === 'string' && args['entityId'].length > 0 ? args['entityId'] : undefined;
  const targetEntityId = typeof args['targetEntityId'] === 'string' && args['targetEntityId'].length > 0 ? args['targetEntityId'] : undefined;
  const autoPlace = typeof args['autoPlace'] === 'boolean' ? args['autoPlace'] : undefined;

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

    const data = await response.json() as { jobId: string; provider: string; usageId?: string; tokenCost?: number; palette?: string };

    const pixelTargetId = targetEntityId ?? entityId;
    trackJob({
      jobId: makeJobId(),
      providerJobId: data.jobId,
      type: 'pixel-art',
      prompt,
      provider: data.provider ?? 'dalle3',
      entityId: pixelTargetId,
      usageId: data.usageId,
      autoPlace: autoPlace ?? !!pixelTargetId,
      targetEntityId: pixelTargetId,
    });

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
  const paletteId = args['palette'];
  if (typeof paletteId !== 'string' || paletteId.length === 0) {
    return { success: false, error: 'Invalid arguments: palette: Palette ID required' };
  }

  const colors = args['colors'];

  if (paletteId === 'custom') {
    if (!Array.isArray(colors)) {
      return { success: false, error: 'Colors array required for custom palette' };
    }
    const validation = validateCustomPalette(colors as string[]);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    return { success: true, message: `Custom palette set with ${(colors as string[]).length} colors` };
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
  const rawColorCount = args['colorCount'];
  if (typeof rawColorCount !== 'number' || !Number.isInteger(rawColorCount) || rawColorCount < 1 || rawColorCount > 256) {
    const detail = rawColorCount === undefined ? 'colorCount: Required' : 'colorCount: colorCount must be between 1 and 256';
    return { success: false, error: `Invalid arguments: ${detail}` };
  }

  const rawDithering = args['dithering'] ?? 'none';
  if (typeof rawDithering !== 'string' || !(VALID_DITHERING as readonly string[]).includes(rawDithering)) {
    return { success: false, error: `Invalid arguments: dithering: Must be one of: ${VALID_DITHERING.join(', ')}` };
  }

  const rawIntensity = args['ditheringIntensity'] ?? 0.5;
  const ditheringIntensity = typeof rawIntensity === 'number' ? rawIntensity : Number(rawIntensity);
  if (!Number.isFinite(ditheringIntensity) || ditheringIntensity < 0 || ditheringIntensity > 1) {
    return { success: false, error: 'Invalid arguments: ditheringIntensity: Must be between 0 and 1' };
  }

  // Color quantization pipeline is not yet implemented (PF-838).
  // Return 501 so callers know no work was done and no tokens should be charged.
  return {
    success: false,
    error: 'quantize_sprite_colors is not yet implemented',
  };
};

export const pixelArtHandlers: Record<string, ToolHandler> = {
  generate_pixel_art: handleGeneratePixelArt,
  set_pixel_art_palette: handleSetPixelArtPalette,
  quantize_sprite_colors: handleQuantizeSpriteColors,
};
