import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { PALETTES, getPalette, validateCustomPalette } from '@/lib/generate/palettes';
import type { PaletteId } from '@/lib/generate/palettes';

const VALID_SIZES = [16, 32, 64, 128];
const VALID_DITHERING = ['none', 'bayer4x4', 'bayer8x8'];
const VALID_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'];
const VALID_PROVIDERS = ['auto', 'openai', 'replicate'];
const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
const TOKEN_COSTS: Record<string, number> = { replicate: 10, openai: 20 };

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // 1b. Rate limit: 10 generation requests per 5 minutes per user
    const rl = rateLimit(`gen-pixel-art:${authResult.ctx.user.id}`, 10, 300_000);
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

    // 3. Resolve provider
    const resolvedProvider = (!provider || provider === 'auto' || provider === 'replicate') ? 'replicate' : 'openai';
    const tokenCost = TOKEN_COSTS[resolvedProvider] ?? 10;

    // 4. Resolve API key and charge tokens
    let usageId: string | undefined;
    try {
      const resolved = await resolveApiKey(
        authResult.ctx.user.id,
        resolvedProvider as 'replicate' | 'openai',
        tokenCost,
        'pixel_art_generation',
        { prompt, targetSize, palette, style }
      );
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

    // Phase 1: Returns a pending job stub. Phase 2 will integrate PixelArtClient
    // to start the actual provider generation and add a /pixel-art/status endpoint.
    const jobId = `pxart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return NextResponse.json({
      status: 'pending',
      jobId,
      usageId,
      provider: resolvedProvider,
      tokenCost,
      palette: paletteData?.name ?? palette,
      targetSize,
      dithering: dithering ?? 'none',
      ditheringIntensity: ditheringIntensity ?? 0,
      style: style ?? 'character',
    }, { status: 201 });
  } catch (err) {
    console.error('Pixel art generation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
