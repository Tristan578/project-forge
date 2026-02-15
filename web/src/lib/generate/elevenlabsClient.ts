/**
 * ElevenLabs API client for SFX and voice generation.
 *
 * Server-side only. Do NOT import in client components.
 *
 * API docs: https://elevenlabs.io/docs
 */

export interface ElevenLabsConfig {
  apiKey: string;
}

export interface GenerateSfxParams {
  prompt: string;
  durationSeconds?: number;
}

export interface GenerateVoiceParams {
  text: string;
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
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
        duration_seconds: params.durationSeconds || 5,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs SFX API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      audioBase64,
      durationSeconds: params.durationSeconds || 5,
    };
  }

  async generateVoice(params: GenerateVoiceParams): Promise<AudioResult> {
    const voiceId = params.voiceId || 'JBFqnCBsd6RMkjVDRZzb'; // Default: George

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
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
      signal: AbortSignal.timeout(30000),
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
}
