import { API_MAX_DURATION_STANDARD_GEN_S } from '@/lib/config/timeouts';
export const maxDuration = API_MAX_DURATION_STANDARD_GEN_S;

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { sanitizePrompt } from '@/lib/ai/contentSafety';
import { PALETTES, getPalette, validateCustomPalette } from '@/lib/generate/palettes';
import type { PaletteId } from '@/lib/generate/palettes';
import { PixelArtClient } from '@/lib/generate/pixelArtClient';
import type { PixelArtStyle, PixelArtProvider } from '@/lib/generate/pixelArtClient';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { TOKEN_COSTS as PRICING } from '@/lib/tokens/pricing';
import {
  PIXEL_ART_SIZES,
  PIXEL_ART_DITHERING_MODES,
  PIXEL_ART_STYLES,
} from '@/lib/config/providers';

// Spread to mutable arrays so .includes() accepts unknown runtime values
const VALID_SIZES: number[] = [...PIXEL_ART_SIZES];
const VALID_DITHERING: string[] = [...PIXEL_ART_DITHERING_MODES];
const VALID_STYLES: string[] = [...PIXEL_ART_STYLES];

const VALID_PROVIDERS = ['auto', 'openai', 'replicate'];
const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

// Map target pixel-art size to the nearest supported provider canvas size.
// Providers generate at high resolution; the post-processor downsamples to targetSize.
function resolveProviderSize(targetSize: number): 512 | 1024 {
  return targetSize <= 64 ? 512 : 1024;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
    const aggRl = await aggregateGenerationRateLimit(authResult.ctx.user.id);
    if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

    // 1b. Rate limit: 10 generation requests per 5 minutes per user
    const rl = await distributedRateLimit(`gen-pixel-art:${authResult.ctx.user.id}`, 10, 300);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    // 2. Parse request
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { prompt, targetSize, palette, customPalette, dithering, ditheringIntensity, style, provider } = body;

    // Validate required fields
    if (typeof prompt !== 'string' || prompt.length < 3) {
      return NextResponse.json({ error: 'Prompt must be at least 3 characters' }, { status: 400 });
    }
    if (!VALID_SIZES.includes(targetSize as number)) {
      return NextResponse.json({ error: `Invalid target size. Must be one of: ${VALID_SIZES.join(', ')}` }, { status: 400 });
    }
    if (!PALETTE_IDS.includes(palette as PaletteId)) {
      return NextResponse.json({ error: `Invalid palette. Must be one of: ${PALETTE_IDS.join(', ')}` }, { status: 400 });
    }
    if (palette === 'custom') {
      if (!Array.isArray(customPalette)) {
        return NextResponse.json({ error: 'Custom palette colors required when palette is "custom" (must be an array)' }, { status: 400 });
      }
      const validation = validateCustomPalette(customPalette as string[]);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }
    if (dithering && !VALID_DITHERING.includes(dithering as string)) {
      return NextResponse.json({ error: `Invalid dithering. Must be one of: ${VALID_DITHERING.join(', ')}` }, { status: 400 });
    }
    if (ditheringIntensity !== undefined && (typeof ditheringIntensity !== 'number' || ditheringIntensity < 0 || ditheringIntensity > 1)) {
      return NextResponse.json({ error: 'Dithering intensity must be a number between 0 and 1' }, { status: 400 });
    }
    if (style && !VALID_STYLES.includes(style as string)) {
      return NextResponse.json({ error: `Invalid style. Must be one of: ${VALID_STYLES.join(', ')}` }, { status: 400 });
    }
    if (provider && !VALID_PROVIDERS.includes(provider as string)) {
      return NextResponse.json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` }, { status: 400 });
    }

    // 2b. Content safety filter
    const safety = sanitizePrompt(prompt as string);
    if (!safety.safe) {
      return NextResponse.json(
        { error: safety.reason ?? 'Content rejected by safety filter' },
        { status: 422 }
      );
    }
    const safePrompt = safety.filtered ?? (prompt as string);

    // 3. Resolve provider
    const resolvedProvider: PixelArtProvider =
      (!provider || provider === 'auto' || provider === 'replicate') ? 'replicate' : 'openai';
    const tokenCost = resolvedProvider === 'openai'
      ? PRICING.pixel_art_openai
      : PRICING.pixel_art_replicate;

    // 4. Resolve API key and charge tokens
    let apiKey: string;
    let usageId: string | undefined;
    try {
      const resolved = await resolveApiKey(
        authResult.ctx.user.id,
        resolvedProvider as 'replicate' | 'openai',
        tokenCost,
        'pixel_art_generation',
        { prompt: safePrompt, targetSize, palette, style }
      );
      apiKey = resolved.key;
      usageId = resolved.usageId;
    } catch (err) {
      if (err instanceof ApiKeyError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
      }
      throw err;
    }

    // 5. Get palette colors for response metadata
    const paletteData = palette === 'custom'
      ? { name: 'Custom', colors: customPalette as string[] }
      : getPalette(palette as PaletteId);

    // 6. Call the provider
    const providerSize = resolveProviderSize(targetSize as number);
    const client = new PixelArtClient(apiKey, resolvedProvider);

    try {
      const result = await client.generate({
        prompt: safePrompt,
        style: (style as PixelArtStyle) ?? 'character',
        size: providerSize,
      });

      // Replicate returns a predictionId for async polling.
      // OpenAI returns base64 directly (synchronous).
      const jobId = result.predictionId ?? `pxart-openai-${Date.now()}`;
      const status = result.predictionId ? 'pending' : 'completed';

      return NextResponse.json({
        status,
        jobId,
        usageId,
        provider: resolvedProvider,
        tokenCost,
        palette: paletteData?.name ?? palette,
        targetSize,
        dithering: dithering ?? 'none',
        ditheringIntensity: ditheringIntensity ?? 0,
        style: style ?? 'character',
        ...(result.base64 ? { base64: result.base64 } : {}),
      }, { status: 201 });
    } catch (err) {
      // Provider call failed — refund tokens so user is not billed for nothing
      if (usageId) {
        try {
          await refundTokens(authResult.ctx.user.id, usageId);
        } catch (refundErr) {
          captureException(refundErr, { route: '/api/generate/pixel-art', action: 'refund', usageId });
        }
      }
      captureException(err, { route: '/api/generate/pixel-art', prompt: safePrompt });
      const message = err instanceof Error ? err.message : 'Provider error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    captureException(err, { route: '/api/generate/pixel-art' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
