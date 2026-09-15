/**
 * Sprite generation API client for DALL-E 3, Replicate SD, and background removal.
 *
 * Server-side only. Do NOT import in client components.
 */

import { validateResourceId } from '@/lib/validation/resourceId';
import { REPLICATE_MODEL_SDXL } from '@/lib/ai/models';
import { composeAbortSignal } from '@/lib/generate/abortComposition';

export interface SpriteGenerateParams {
  prompt: string;
  style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
  size: '32x32' | '64x64' | '128x128' | '256x256' | '512x512' | '1024x1024';
  provider?: 'auto' | 'dalle3' | 'sdxl';
  removeBackground?: boolean;
  /**
   * The remove.bg API key (platform PLATFORM_REMOVEBG_KEY or the user's BYOK
   * key), resolved by the route with the same BYOK-then-platform precedence
   * every generate route uses. Required to honour `removeBackground` — the
   * client is constructed with the SPRITE provider's key (OpenAI / Replicate),
   * which is not the remove.bg key, so background removal cannot reuse
   * `this.apiKey`. Only the synchronous DALL-E path consumes it (#9734); the
   * SDXL path returns a pending prediction id and has no resolved image URL to
   * post to remove.bg inline. When absent, `removeBackground` is a no-op and the
   * original sprite is returned unchanged rather than failing a paid generation.
   */
  removeBackgroundKey?: string;
  signal?: AbortSignal;
}

export interface SpriteSheetParams {
  prompt: string;
  frameCount: number;
  style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
  size: '32x32' | '64x64' | '128x128' | '256x256';
  signal?: AbortSignal;
}

export interface TilesetParams {
  prompt: string;
  tileSize: 16 | 32 | 48 | 64;
  gridSize: '4x4' | '8x8' | '16x16';
  signal?: AbortSignal;
}

export interface GenerationResult {
  taskId: string;
  status: string;
}

function requireProviderArtifact(value: unknown, artifact: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Provider response did not include a non-empty ${artifact}`);
  }
  return value;
}

export class SpriteClient {
  private baseUrlDalle = 'https://api.openai.com/v1/images/generations';
  private baseUrlReplicate = 'https://api.replicate.com/v1/predictions';

  constructor(private apiKey: string, private provider: 'dalle3' | 'sdxl' | 'removebg') {}

  async generateSprite(params: SpriteGenerateParams): Promise<GenerationResult> {
    if (this.provider === 'dalle3') {
      return this.generateWithDalle(params);
    } else {
      return this.generateWithReplicate(params);
    }
  }

  private async generateWithDalle(params: SpriteGenerateParams): Promise<GenerationResult> {
    const enhancedPrompt = this.enhancePrompt(params.prompt, params.style);

    const response = await fetch(this.baseUrlDalle, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: enhancedPrompt,
        n: 1,
        size: params.size === '32x32' || params.size === '64x64' || params.size === '128x128' || params.size === '256x256'
          ? '1024x1024'
          : params.size,
        quality: 'standard',
      }),
      signal: composeAbortSignal(params.signal, 60000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`DALL-E API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const imageUrl = requireProviderArtifact(data?.data?.[0]?.url, 'image URL');

    // Background removal (#9734). DALL-E completes synchronously, so the image
    // URL is in hand here — the one place a resolved URL exists before the
    // client hands control back. Gated on both the flag AND a resolved
    // remove.bg key: a deployment (or user) with no remove.bg key still gets a
    // sprite rather than a failed, refunded generation. A remove.bg FAILURE, by
    // contrast, propagates — the caller asked for a transparent sprite and did
    // not get one, so `createGenerationHandler` refunds and reports it rather
    // than silently shipping the background.
    if (params.removeBackground && params.removeBackgroundKey) {
      const { resultUrl } = await this.removeBackground(imageUrl, {
        key: params.removeBackgroundKey,
        signal: params.signal,
      });
      return {
        taskId: resultUrl,
        status: 'completed',
      };
    }

    // Return the URL directly as taskId for synchronous completion
    return {
      taskId: imageUrl,
      status: 'completed',
    };
  }

  private async generateWithReplicate(params: SpriteGenerateParams): Promise<GenerationResult> {
    const enhancedPrompt = this.enhancePrompt(params.prompt, params.style);
    const [width, height] = params.size.split('x').map(Number);

    const response = await fetch(this.baseUrlReplicate, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: REPLICATE_MODEL_SDXL,
        input: {
          prompt: enhancedPrompt,
          width,
          height,
          num_inference_steps: 30,
          guidance_scale: 7.5,
        },
      }),
      signal: composeAbortSignal(params.signal, 30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replicate API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const predictionId = requireProviderArtifact(data?.id, 'prediction ID');
    return {
      taskId: predictionId,
      status: data.status,
    };
  }

  async generateSpriteSheet(params: SpriteSheetParams): Promise<GenerationResult> {
    const frameW = parseInt(params.size.split('x')[0], 10);
    const maxDim = 1024;
    const maxFrames = Math.floor(maxDim / frameW);
    const effectiveFrameCount = Math.min(params.frameCount, maxFrames);
    if (effectiveFrameCount < params.frameCount) {
      console.warn(
        `Sprite sheet frame count reduced from ${params.frameCount} to ${effectiveFrameCount} ` +
        `(SDXL max dimension: ${maxDim}px, frame width: ${frameW}px)`
      );
    }
    const sheetWidth = frameW * effectiveFrameCount;
    const sheetHeight = frameW;

    const enhancedPrompt = this.enhanceSpriteSheetPrompt(
      params.prompt,
      params.style,
      effectiveFrameCount,
    );

    const response = await fetch(this.baseUrlReplicate, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: REPLICATE_MODEL_SDXL,
        input: {
          prompt: enhancedPrompt,
          width: sheetWidth,
          height: Math.min(sheetHeight, maxDim),
          num_inference_steps: 40,
          guidance_scale: 8,
        },
      }),
      signal: composeAbortSignal(params.signal, 30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replicate API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const predictionId = requireProviderArtifact(data?.id, 'sprite-sheet prediction ID');
    return {
      taskId: predictionId,
      status: data.status,
    };
  }

  async generateTileset(params: TilesetParams): Promise<GenerationResult> {
    const enhancedPrompt = `${params.prompt}, game tileset, seamless tiling texture, ${params.tileSize}px tiles, top-down view`;

    const response = await fetch(this.baseUrlReplicate, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: REPLICATE_MODEL_SDXL,
        input: {
          prompt: enhancedPrompt,
          width: 512,
          height: 512,
          num_inference_steps: 50,
          guidance_scale: 9,
        },
      }),
      signal: composeAbortSignal(params.signal, 30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replicate API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const predictionId = requireProviderArtifact(data?.id, 'tileset prediction ID');
    return {
      taskId: predictionId,
      status: data.status,
    };
  }

  async removeBackground(
    imageUrl: string,
    opts?: { signal?: AbortSignal; key?: string },
  ): Promise<{ resultUrl: string }> {
    // remove.bg uses its OWN key, distinct from the sprite provider key this
    // client is constructed with. `generateSprite` chains here with the key the
    // route resolved (#9734); direct callers of this method (provider
    // 'removebg') fall back to `this.apiKey`.
    const apiKey = opts?.key ?? this.apiKey;
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        size: 'auto',
      }),
      signal: composeAbortSignal(opts?.signal, 30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`remove.bg API error (${response.status}): ${error}`);
    }

    const blob = await response.blob();
    // Convert to data URL
    const base64 = await this.blobToBase64(blob);
    return { resultUrl: base64 };
  }

  private enhanceSpriteSheetPrompt(prompt: string, style: string | undefined, frameCount: number): string {
    const styleTag = style === 'pixel-art' ? 'pixel art, 8-bit style, sharp pixels'
      : style === 'hand-drawn' ? 'hand-drawn style, clean linework'
      : style === 'vector' ? 'vector art, flat colors'
      : style === 'realistic' ? 'realistic style, detailed'
      : '';

    return `sprite sheet, ${frameCount} frames side by side in a single horizontal row, ${prompt}, ${styleTag}, game animation sprite sheet, consistent character across all frames, white background, evenly spaced frames`.trim();
  }

  private enhancePrompt(prompt: string, style?: string): string {
    let enhanced = prompt;

    // Add style modifiers
    switch (style) {
      case 'pixel-art':
        enhanced = `${prompt}, pixel art, 8-bit style, retro game sprite, sharp pixels, no anti-aliasing, game sprite`;
        break;
      case 'hand-drawn':
        enhanced = `${prompt}, hand-drawn style, sketch art, game sprite, clean linework`;
        break;
      case 'vector':
        enhanced = `${prompt}, vector art, flat colors, clean edges, game sprite`;
        break;
      case 'realistic':
        enhanced = `${prompt}, realistic style, detailed, game sprite`;
        break;
      default:
        enhanced = `${prompt}, game sprite`;
    }

    // Always append transparent background request
    enhanced += ', transparent background, PNG format, centered, isolated on white background';

    return enhanced;
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    // Runtime-agnostic (#9734). `FileReader` is a browser/worker API absent from
    // the Node request runtime this client actually runs in — it only ever
    // "worked" under jsdom in tests, and would have thrown the first time
    // `generateSprite` chained background removal server-side. `Blob.arrayBuffer`
    // + `Buffer` produces the same `data:<mime>;base64,...` URL in both.
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = blob.type || 'image/png';
    return `data:${mimeType};base64,${base64}`;
  }

  async getReplicateStatus(predictionId: string, opts?: { signal?: AbortSignal }): Promise<{ status: string; output?: string[] }> {
    validateResourceId(predictionId);
    const safePredictionId = encodeURIComponent(predictionId);
    const url = new URL(`/v1/predictions/${safePredictionId}`, 'https://api.replicate.com');
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      signal: composeAbortSignal(opts?.signal, 10000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replicate status error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      status: data.status,
      output: data.output,
    };
  }
}
