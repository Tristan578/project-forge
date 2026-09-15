/**
 * ElevenLabs API client for sound effects, voice, and music generation.
 *
 * Server-side only. Do NOT import in client components.
 *
 * API docs: https://elevenlabs.io/docs
 */

import { validateResourceId } from '@/lib/validation/resourceId';
import { composeAbortSignal } from '@/lib/generate/abortComposition';
import { EmptyArtifactError } from '@/lib/generate/emptyArtifactError';

export interface ElevenLabsConfig {
  apiKey: string;
}

export interface GenerateSfxParams {
  prompt: string;
  durationSeconds?: number;
  signal?: AbortSignal;
}

export interface GenerateVoiceParams {
  text: string;
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  signal?: AbortSignal;
}

/** Music composition inputs, optional provider controls and caller cancellation. */
export interface GenerateMusicParams {
  prompt: string;
  /** Track length in milliseconds. ElevenLabs accepts 3000–600000. */
  musicLengthMs?: number;
  /** When true, request an instrumental (no vocals) track. */
  forceInstrumental?: boolean;
  /** ElevenLabs music model: 'music_v1' (default) or 'music_v2'. */
  modelId?: string;
  signal?: AbortSignal;
}

export interface AudioResult {
  audioBase64: string;
  durationSeconds: number;
}

export class ElevenLabsClient {
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(private config: ElevenLabsConfig) {}

  async generateSfx(params: GenerateSfxParams): Promise<AudioResult> {
    const response = await fetch(`${this.baseUrl}/sound-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        text: params.prompt,
        duration_seconds: params.durationSeconds ?? 5,
      }),
      signal: composeAbortSignal(params.signal, 30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs SFX API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      audioBase64,
      durationSeconds: params.durationSeconds ?? 5,
    };
  }

  async generateVoice(params: GenerateVoiceParams): Promise<AudioResult> {
    const voiceId = params.voiceId || 'JBFqnCBsd6RMkjVDRZzb'; // Default: George
    validateResourceId(voiceId);

    const safeVoiceId = encodeURIComponent(voiceId);
    const url = new URL(`/v1/text-to-speech/${safeVoiceId}`, 'https://api.elevenlabs.io');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        text: params.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: params.stability ?? 0.5,
          similarity_boost: params.similarityBoost ?? 0.75,
          style: params.style ?? 0,
        },
      }),
      signal: composeAbortSignal(params.signal, 30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs TTS API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    // Estimate duration based on text length (rough: ~150 words per minute)
    const wordCount = params.text.split(/\s+/).length;
    const durationSeconds = Math.max(1, Math.ceil((wordCount / 150) * 60));

    return {
      audioBase64,
      durationSeconds,
    };
  }

  /**
   * Generate a music track (PF-1301 / #9522 — replaces Suno).
   *
   * ElevenLabs `POST /v1/music` returns the audio bytes directly (no async task
   * id), so this resolves to an {@link AudioResult} exactly like `generateSfx`
   * and `generateVoice`: the caller persists/attaches the base64 inline rather
   * than polling a status route. `xi-api-key` is the same header/credential the
   * SFX and voice calls use — one key now covers all three audio capabilities.
   */
  async generateMusic(params: GenerateMusicParams): Promise<AudioResult> {
    // ElevenLabs bounds: 3000–600000 ms. The route validates 15–120s upstream;
    // clamp defensively so a stray value can never post an out-of-range length.
    const requestedMs = typeof params.musicLengthMs === 'number' && Number.isFinite(params.musicLengthMs)
      ? params.musicLengthMs
      : 30000;
    const musicLengthMs = Math.min(600000, Math.max(3000, Math.round(requestedMs)));

    const response = await fetch(`${this.baseUrl}/music`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        music_length_ms: musicLengthMs,
        force_instrumental: params.forceInstrumental ?? true,
        model_id: params.modelId ?? 'music_v1',
      }),
      signal: composeAbortSignal(params.signal, 180000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs Music API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new EmptyArtifactError('Music', 'audio');
    }
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      audioBase64,
      durationSeconds: Math.round(musicLengthMs / 1000),
    };
  }
}
