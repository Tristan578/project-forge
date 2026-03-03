/**
 * Suno API client for music generation.
 *
 * Server-side only. Do NOT import in client components.
 *
 * Note: Suno API is invite-only. This is a hypothetical implementation.
 */

import { validateResourceId } from '@/lib/validation/resourceId';

export interface SunoConfig {
  apiKey: string;
}

export interface CreateMusicParams {
  prompt: string;
  durationSeconds?: number;
  instrumental?: boolean;
}

export interface MusicStatus {
  status: string;
  progress: number;
  audioUrl?: string;
  durationSeconds?: number;
}

export class SunoClient {
  private readonly baseUrl = 'https://api.suno.ai';

  constructor(private config: SunoConfig) {}

  async createMusic(params: CreateMusicParams): Promise<{ taskId: string }> {
    const response = await fetch(new URL('/v1/generation', this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        duration_seconds: params.durationSeconds || 30,
        instrumental: params.instrumental ?? true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Suno API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return { taskId: data.task_id || data.id };
  }

  async getStatus(taskId: string): Promise<MusicStatus> {
    validateResourceId(taskId);
    const url = new URL(`/v1/generation/${taskId}`, this.baseUrl);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`Suno status error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return {
      status: data.status,
      progress: data.progress || 0,
      audioUrl: data.audio_url,
      durationSeconds: data.duration_seconds,
    };
  }
}
