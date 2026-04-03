export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { PALETTES, getPalette, validateCustomPalette } from '@/lib/generate/palettes';
import type { PaletteId } from '@/lib/generate/palettes';
import { PixelArtClient } from '@/lib/generate/pixelArtClient';
import type { PixelArtStyle, PixelArtProvider } from '@/lib/generate/pixelArtClient';
import { TOKEN_COSTS as PRICING } from '@/lib/tokens/pricing';
import {
  PIXEL_ART_SIZES,
  PIXEL_ART_DITHERING_MODES,
  PIXEL_ART_STYLES,
} from '@/lib/config/providers';

const VALID_SIZES: number[] = [...PIXEL_ART_SIZES];
const VALID_DITHERING: string[] = [...PIXEL_ART_DITHERING_MODES];
const VALID_STYLES: string[] = [...PIXEL_ART_STYLES];
const VALID_PROVIDERS = ['auto', 'openai', 'replicate'];
const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

function resolveProviderSize(targetSize: number): 512 | 1024 {
  return targetSize <= 64 ? 512 : 1024;
}

interface PixelArtParams {
  prompt: string;
  targetSize: number;
  palette: string;
  customPalette?: string[];
  dithering: string;
  ditheringIntensity: number;
  style: string;
  resolvedProvider: PixelArtProvider;
}

export const POST = createGenerationHandler<
  PixelArtParams,
  {
    status: string;
    jobId: string;
    usageId: string | undefined;
    provider: PixelArtProvider;
    tokenCost: number;
    palette: string;
    targetSize: number;
    dithering: string;
    ditheringIntensity: number;
    style: string;
    base64?: string;
  }
>({
  route: '/api/generate/pixel-art',
  provider: (params) => params.resolvedProvider as 'replicate' | 'openai',
  operation: 'pixel_art_generation',
  rateLimitKey: 'gen-pixel-art',
  successStatus: 201,
  tokenCost: (params) =>
    params.resolvedProvider === 'openai'
      ? PRICING.pixel_art_openai
      : PRICING.pixel_art_replicate,
  validate: (body) => {
    const { prompt, targetSize, palette, customPalette, dithering, ditheringIntensity, style, provider } = body;

    if (typeof prompt !== 'string' || prompt.length < 3) {
      return { ok: false, error: 'Prompt must be at least 3 characters', status: 400 };
    }
    if (!VALID_SIZES.includes(targetSize as number)) {
      return { ok: false, error: `Invalid target size. Must be one of: ${VALID_SIZES.join(', ')}`, status: 400 };
    }
    if (!PALETTE_IDS.includes(palette as PaletteId)) {
      return { ok: false, error: `Invalid palette. Must be one of: ${PALETTE_IDS.join(', ')}`, status: 400 };
    }
    if (palette === 'custom') {
      if (!Array.isArray(customPalette)) {
        return { ok: false, error: 'Custom palette colors required when palette is "custom" (must be an array)', status: 400 };
      }
      const validation = validateCustomPalette(customPalette as string[]);
      if (!validation.valid) {
        return { ok: false, error: validation.error ?? 'Invalid custom palette', status: 400 };
      }
    }
    if (dithering && !VALID_DITHERING.includes(dithering as string)) {
      return { ok: false, error: `Invalid dithering. Must be one of: ${VALID_DITHERING.join(', ')}`, status: 400 };
    }
    if (ditheringIntensity !== undefined && (typeof ditheringIntensity !== 'number' || ditheringIntensity < 0 || ditheringIntensity > 1)) {
      return { ok: false, error: 'Dithering intensity must be a number between 0 and 1', status: 400 };
    }
    if (style && !VALID_STYLES.includes(style as string)) {
      return { ok: false, error: `Invalid style. Must be one of: ${VALID_STYLES.join(', ')}`, status: 400 };
    }
    if (provider && !VALID_PROVIDERS.includes(provider as string)) {
      return { ok: false, error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`, status: 400 };
    }

    const resolvedProvider: PixelArtProvider =
      (!provider || provider === 'auto' || provider === 'replicate') ? 'replicate' : 'openai';

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        targetSize: targetSize as number,
        palette: palette as string,
        customPalette: customPalette as string[] | undefined,
        dithering: (dithering as string) ?? 'none',
        ditheringIntensity: (ditheringIntensity as number) ?? 0,
        style: (style as string) ?? 'character',
        resolvedProvider,
      },
    };
  },
  execute: async (params, apiKey, ctx) => {
    const paletteData = params.palette === 'custom'
      ? { name: 'Custom', colors: params.customPalette as string[] }
      : getPalette(params.palette as PaletteId);

    const providerSize = resolveProviderSize(params.targetSize);
    const client = new PixelArtClient(apiKey, params.resolvedProvider);

    const result = await client.generate({
      prompt: params.prompt,
      style: params.style as PixelArtStyle,
      size: providerSize,
    });

    const jobId = result.predictionId ?? `pxart-openai-${Date.now()}`;
    const status = result.predictionId ? 'pending' : 'completed';

    return {
      status,
      jobId,
      usageId: ctx.usageId,
      provider: params.resolvedProvider,
      tokenCost: ctx.tokenCost,
      palette: paletteData?.name ?? params.palette,
      targetSize: params.targetSize,
      dithering: params.dithering,
      ditheringIntensity: params.ditheringIntensity,
      style: params.style,
      ...(result.base64 ? { base64: result.base64 } : {}),
    };
  },
});
