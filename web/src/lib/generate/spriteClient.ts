/**
 * Sprite generation API client for DALL-E 3, Replicate SD, and background removal.
 *
 * Server-side only. Do NOT import in client components.
 */

export interface SpriteGenerateParams {
  prompt: string;
  style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
  size: '32x32' | '64x64' | '128x128' | '256x256' | '512x512' | '1024x1024';
  provider?: 'auto' | 'dalle3' | 'sdxl';
  removeBackground?: boolean;
}

export interface SpriteSheetParams {
  sourceAssetId: string;
  frameCount: number;
  style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
  size: '32x32' | '64x64' | '128x128' | '256x256';
}

export interface TilesetParams {
  prompt: string;
  tileSize: 16 | 32 | 48 | 64;
  gridSize: '4x4' | '8x8' | '16x16';
}

export interface GenerationResult {
  taskId: string;
  status: string;
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
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`DALL-E API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    // Return the URL directly as taskId for synchronous completion
    return {
      taskId: data.data[0].url,
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
        version: 'stability-ai/sdxl:latest',
        input: {
          prompt: enhancedPrompt,
          width,
          height,
          num_inference_steps: 30,
          guidance_scale: 7.5,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replicate API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      taskId: data.id,
      status: data.status,
    };
  }

  async generateSpriteSheet(_params: SpriteSheetParams): Promise<GenerationResult> {
    // For now, return a placeholder indicating sprite sheet generation
    // Full ControlNet implementation would go here
    return {
      taskId: `spritesheet_${Date.now()}`,
      status: 'pending',
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
        version: 'stability-ai/sdxl:latest',
        input: {
          prompt: enhancedPrompt,
          width: 512,
          height: 512,
          num_inference_steps: 50,
          guidance_scale: 9,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Replicate API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      taskId: data.id,
      status: data.status,
    };
  }

  async removeBackground(imageUrl: string): Promise<{ resultUrl: string }> {
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        size: 'auto',
      }),
      signal: AbortSignal.timeout(30000),
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
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async getReplicateStatus(predictionId: string): Promise<{ status: string; output?: string[] }> {
    const response = await fetch(`${this.baseUrlReplicate}/${predictionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
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
