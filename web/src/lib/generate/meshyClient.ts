/**
 * Meshy API client for 3D model and texture generation.
 *
 * Server-side only. Do NOT import in client components.
 *
 * API docs: https://docs.meshy.ai
 */

export interface MeshyConfig {
  apiKey: string;
}

export interface TextTo3DParams {
  prompt: string;
  artStyle?: string;
  negativePrompt?: string;
  quality?: 'standard' | 'high';
}

export interface ImageTo3DParams {
  imageBase64: string;
  prompt?: string;
}

export interface TextToTextureParams {
  prompt: string;
  resolution?: string;
  style?: string;
  tiling?: boolean;
}

export interface TaskStatus {
  status: string;
  progress: number;
  modelUrls?: { glb: string };
  thumbnailUrl?: string;
}

export interface TextureStatus {
  status: string;
  progress: number;
  maps?: Record<string, string>;
}

export class MeshyClient {
  private baseUrl = 'https://api.meshy.ai/openapi/v2';

  constructor(private config: MeshyConfig) {}

  async createTextTo3D(params: TextTo3DParams): Promise<{ taskId: string }> {
    const response = await fetch(`${this.baseUrl}/text-to-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        mode: 'refine',
        prompt: params.prompt,
        art_style: params.artStyle || 'realistic',
        negative_prompt: params.negativePrompt || '',
        ai_model: 'meshy-4',
        target_polycount: params.quality === 'high' ? 50000 : 30000,
        topology: 'triangle',
        should_remesh: true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Meshy API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return { taskId: data.result };
  }

  async createImageTo3D(params: ImageTo3DParams): Promise<{ taskId: string }> {
    const response = await fetch(`${this.baseUrl}/image-to-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        image_url: params.imageBase64,
        prompt: params.prompt || '',
        ai_model: 'meshy-4',
        target_polycount: 30000,
        topology: 'triangle',
        should_remesh: true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Meshy API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return { taskId: data.result };
  }

  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const response = await fetch(`${this.baseUrl}/text-to-3d/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Meshy status error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      status: data.status,
      progress: data.progress || 0,
      modelUrls: data.model_urls,
      thumbnailUrl: data.thumbnail_url,
    };
  }

  async createTextToTexture(params: TextToTextureParams): Promise<{ taskId: string }> {
    const response = await fetch(`${this.baseUrl}/text-to-texture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        resolution: params.resolution || '1024',
        style: params.style || 'realistic',
        tiling: params.tiling ?? true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Meshy texture API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return { taskId: data.result };
  }

  async getTextureStatus(taskId: string): Promise<TextureStatus> {
    const response = await fetch(`${this.baseUrl}/text-to-texture/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Meshy texture status error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      status: data.status,
      progress: data.progress || 0,
      maps: data.texture_urls,
    };
  }
}
