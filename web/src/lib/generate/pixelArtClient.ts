// Server-only: This module uses API keys directly and must not be imported in client components.
// web/src/lib/generate/pixelArtClient.ts
import 'server-only';

export type { PixelArtStyle } from '@/lib/config/providers';
import type { PixelArtStyle } from '@/lib/config/providers';
export type PixelArtProvider = 'openai' | 'replicate';

interface GenerateParams {
  prompt: string;
  style: PixelArtStyle;
  size: 512 | 1024;
  referenceImage?: string; // base64
}

interface OpenAIResult {
  base64: string;
}

interface ReplicateResult {
  predictionId: string;
  status: string;
}

export type GenerateResult = (OpenAIResult & { predictionId?: undefined; status?: undefined })
  | (ReplicateResult & { base64?: undefined });

const STYLE_MODIFIERS: Record<PixelArtStyle, string> = {
  character: 'game character sprite, front-facing, clean silhouette, transparent background',
  prop: 'game item, game prop, centered, clean edges, transparent background',
  tile: 'tileable seamless texture, top-down view, repeating pattern',
  icon: 'game UI icon, simple, bold, centered, clean edges, transparent background',
  environment: 'game background, side-scrolling, layered depth, scenic',
};

export function buildPixelArtPrompt(userPrompt: string, style: PixelArtStyle): string {
  const modifier = STYLE_MODIFIERS[style];
  return `Pixel art style, retro 16-bit, ${modifier}, ${userPrompt}. Clean pixel art, no anti-aliasing, sharp pixel edges, limited color palette.`;
}

export class PixelArtClient {
  constructor(
    private apiKey: string,
    private provider: PixelArtProvider
  ) {}

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const enhancedPrompt = buildPixelArtPrompt(params.prompt, params.style);

    if (this.provider === 'openai') {
      return this.generateDalle(enhancedPrompt, params.size);
    }
    return this.generateReplicate(enhancedPrompt, params.size);
  }

  private async generateDalle(prompt: string, _size: 512 | 1024): Promise<OpenAIResult> {
    // DALL-E 3 only supports 1024x1024, 1024x1792, and 1792x1024.
    // Always request 1024x1024 and let the caller downscale if needed.
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { base64: data.data[0].b64_json };
  }

  private async generateReplicate(prompt: string, _size: 512 | 1024): Promise<ReplicateResult> {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        version: 'stability-ai/sdxl:latest',
        input: {
          prompt,
          negative_prompt: 'blurry, anti-aliased, smooth gradients, realistic, photograph',
          num_outputs: 1,
          width: 1024,
          height: 1024,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Replicate API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { predictionId: data.id, status: data.status };
  }

  async getReplicateStatus(predictionId: string): Promise<{ status: string; output?: string[] }> {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Replicate status error ${response.status}`);
    const data = await response.json();
    return { status: data.status, output: data.output };
  }
}
