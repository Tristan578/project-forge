/**
 * POST /api/generate/sprite — generate a sprite image via DALL-E or SDXL.
 * Accepts prompt (3–500 chars), optional style, size (default 64x64), provider
 * (auto by default), and removeBackground (true by default). HTTP 201 delivers
 * a completed DALL-E resultUrl with an opaque nonpollable jobId, or an SDXL
 * prediction jobId for polling. backgroundRemoval reports removed, not-requested,
 * unavailable (missing/failed key lookup), or unsupported (SDXL). usageId supports
 * client-side import-failure refunds; provider failures refund server-side.
 */

export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { SPRITE_SIZES, SPRITE_ESTIMATED_SECONDS, resolveSpriteProvider, spriteTokenCost } from '@/lib/config/providers';
import type { SpriteStyle } from '@/lib/config/providers';
import type { SpriteSize } from '@/lib/config/providers';
import { resolveByokOrPlatformKey } from '@/lib/keys/resolver';
import { captureException } from '@/lib/monitoring/sentry-server';
import { withEgressGuard } from '@/lib/security/egressGuard';

type SpriteProvider = 'dalle3' | 'sdxl';

const POST_impl = createGenerationHandler<
  {
    prompt: string;
    style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
    size: SpriteSize;
    provider: SpriteProvider;
    removeBackground: boolean;
    serviceName: 'openai' | 'replicate';
  },
  {
    jobId: string;
    provider: SpriteProvider;
    status: string;
    estimatedSeconds: number;
    usageId: string | undefined;
    // Present only for a SYNCHRONOUSLY completed DALL-E generation. The finished
    // image (a base64 `data:` URL after background removal, or a provider URL)
    // rides here in the response body so the client imports it directly — it is
    // NEVER embedded in `jobId`, which travels through the status-poll query
    // string where a base64 payload corrupts and exceeds request-line limits
    // (#9734).
    resultUrl?: string;
    backgroundRemoval: 'removed' | 'not-requested' | 'unavailable' | 'unsupported';
  }
>({
  route: '/api/generate/sprite',
  panel: 'generate-sprite',
  enforceRequestDeadline: true,
  provider: (params) => params.serviceName,
  operation: 'sprite_generation',
  rateLimitKey: 'gen-sprite',
  successStatus: 201,
  tokenCost: (params) => spriteTokenCost(params.style, params.provider),
  validate: (body) => {
    const {
      prompt,
      style,
      size = '64x64',
      provider = 'auto',
      removeBackground = true,
    } = body as Record<string, unknown>;

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    const VALID_PROVIDERS = ['auto', 'dalle3', 'sdxl'];
    if (provider !== undefined && !VALID_PROVIDERS.includes(provider as string)) {
      return { ok: false, error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` };
    }

    const VALID_SIZES: readonly string[] = SPRITE_SIZES;
    if (!VALID_SIZES.includes(size as string)) {
      return { ok: false, error: `Invalid size. Must be one of: ${VALID_SIZES.join(', ')}` };
    }

    if (typeof removeBackground !== 'boolean') {
      return { ok: false, error: 'removeBackground must be a boolean' };
    }

    // Shared with GenerateSpriteDialog so the quote the user is shown, the
    // balance the dialog gates on, and the amount charged here cannot disagree
    // (#9741).
    const actualProvider = resolveSpriteProvider(
      style as SpriteStyle | undefined,
      (provider ?? 'auto') as SpriteProvider,
    );

    const serviceName = actualProvider === 'dalle3' ? 'openai' as const : 'replicate' as const;

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        style: style as 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic' | undefined,
        size: size as SpriteSize,
        provider: actualProvider,
        removeBackground,
        serviceName,
      },
    };
  },
  execute: async (params, apiKey, ctx) => {
    const client = new SpriteClient(apiKey, params.provider);

    // Background removal (#9734) needs the remove.bg key, NOT the sprite
    // provider key `apiKey`, so it is resolved separately with the same
    // BYOK-then-platform precedence (PLATFORM_REMOVEBG_KEY). Only the DALL-E
    // path is synchronous — SDXL returns a pending prediction id with no
    // resolved URL to post to remove.bg inline — so the lookup is skipped for
    // it. Resolution never charges and yields `null` when no key exists, in
    // which case `generateSprite` returns the sprite unchanged rather than
    // failing the generation the user paid for. A lookup error must not sink a
    // successful sprite either, so it degrades to "no background removal".
    let removeBackgroundKey: string | undefined;
    if (params.removeBackground && params.provider === 'dalle3') {
      try {
        removeBackgroundKey =
          (await resolveByokOrPlatformKey(ctx.userId, 'removebg')) ?? undefined;
      } catch (err) {
        captureException(err, { route: '/api/generate/sprite', action: 'resolve_removebg_key' });
      }
    }

    const result = await client.generateSprite({
      prompt: params.prompt,
      style: params.style,
      size: params.size,
      provider: params.provider,
      removeBackground: params.removeBackground,
      removeBackgroundKey,
      signal: ctx.abortSignal,
    });

    // DALL-E completes synchronously: the finished image is in hand now.
    // Deliver it in the response BODY as `resultUrl` and hand the client a
    // short, opaque, NON-pollable jobId. The image — a base64 `data:` URL after
    // background removal, up to several MB — must never be threaded through
    // `jobId` and the `/status?jobId=` query string, where `+` decodes to a
    // space and the request-line size limit is exceeded, breaking the very
    // background-removal path #9734 wires up. The client detects synchronous
    // completion by `status === 'completed'` + a `resultUrl` in the body and
    // imports it directly instead of polling.
    if (params.provider === 'dalle3' && result.status === 'completed') {
      return {
        jobId: `dalle3-sync:${ctx.usageId ?? crypto.randomUUID()}`,
        provider: params.provider,
        status: 'completed',
        estimatedSeconds: SPRITE_ESTIMATED_SECONDS[params.provider],
        usageId: ctx.usageId,
        resultUrl: result.resultUrl ?? result.taskId,
        backgroundRemoval: result.backgroundRemoval ?? (params.removeBackground ? 'unavailable' : 'not-requested'),
      };
    }

    // SDXL returns a short, url-safe prediction id the client polls.
    return {
      jobId: result.taskId,
      provider: params.provider,
      status: result.status,
      backgroundRemoval: params.removeBackground ? 'unsupported' : 'not-requested',
      estimatedSeconds: SPRITE_ESTIMATED_SECONDS[params.provider],
      usageId: ctx.usageId,
    };
  },
  // Durable server-side completion + refund (PF-906). Dormant unless QStash set.
  // DALL-E sprites complete synchronously (inline image) and need no polling —
  // only SDXL (Replicate) returns a pollable prediction id.
  asyncJob: {
    type: 'sprite',
    providerJobId: (result) => (result.provider === 'sdxl' ? result.jobId : null),
    estimatedSeconds: SPRITE_ESTIMATED_SECONDS.sdxl,
  },
});

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
