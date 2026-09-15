import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { FALLBACK_SCHEMA } from '../types';
import { makeStepError, successResult, failResult } from './shared';

// ElevenLabs SFX accepts 0.5–22s (see /api/generate/sfx validation). Default 5s.
const SFX_MIN_SECONDS = 0.5;
const SFX_MAX_SECONDS = 22;
const SFX_DEFAULT_SECONDS = 5;

const inputSchema = z.object({
  type: z.enum(['3d-model', 'texture', 'sound', 'music', 'voice', 'sprite']),
  description: z.string().min(1).max(500),
  entityRef: z.string().optional(),
  styleDirective: z.string().max(500),
  priority: z.enum(['required', 'nice-to-have']),
  fallback: z.string(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  optional: z.boolean().optional(),
  // Optional per-step SFX length. Absent → SFX_DEFAULT_SECONDS. Bounded to the
  // same window the /api/generate/sfx route enforces so a bad value fails here
  // (clear INVALID_INPUT) rather than as an opaque 400 from the route.
  durationSeconds: z.number().min(SFX_MIN_SECONDS).max(SFX_MAX_SECONDS).optional(),
});

/**
 * The ONLY asset type wired to real generation in this slice (#9900,
 * operation `ai.FR-1.OP-04`). Model, texture, sprite, music and voice adapters
 * remain owned by parent #9808 and stay explicitly unsupported/pending here.
 */
const SUPPORTED_TYPES = new Set(['sound']);

/** Decode base64 to bytes using web-standard `atob` (browser + Node ≥16). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * True when `bytes` begin with a recognizable audio-container signature. Covers
 * the formats ElevenLabs can return (MP3 by default) plus WAV/OGG so a future
 * format switch is not silently rejected:
 *  - MP3: an `ID3` tag, or an MPEG frame-sync (0xFF followed by 0b111x xxxx)
 *  - WAV: `RIFF` + `WAVE`
 *  - OGG: `OggS`
 */
function hasAudioSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b = bytes;
  // "ID3"
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  // MPEG frame sync: 11 bits set (0xFF then top 3 bits of next byte)
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true;
  // "RIFF" .... "WAVE"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b.length >= 12 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
  ) {
    return true;
  }
  // "OggS"
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return true;
  return false;
}

/**
 * Throw unless `audioBase64` is non-empty, valid base64, and decodes to a
 * non-empty buffer carrying a real audio-container header. Any throw here routes
 * the step to the validated fallback — a provider "200 with no usable audio"
 * must NOT be treated as success or attached as a fabricated asset (#9900).
 */
function assertDecodableAudio(audioBase64: string): Uint8Array {
  if (!audioBase64) {
    throw new Error('SFX generation returned no audio');
  }
  // Reject anything that is not well-formed base64 before decoding.
  if (audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) {
    throw new Error('SFX audio payload is not valid base64');
  }
  const bytes = base64ToBytes(audioBase64);
  if (bytes.length === 0) {
    throw new Error('SFX audio decoded to zero bytes');
  }
  if (!hasAudioSignature(bytes)) {
    throw new Error('SFX audio has no recognizable audio-container header');
  }
  return bytes;
}

interface SfxAudioResult {
  audioBase64: string;
  durationSeconds: number;
  provider?: string;
}

/**
 * Generate a sound effect through the EXISTING authenticated server route.
 *
 * The executor runs client-side (it is invoked from `OrchestratorPanel`), so it
 * must NOT instantiate `ElevenLabsClient` directly — that client is server-only
 * and needs the provider API key. `POST /api/generate/sfx` is the one path that
 * already resolves the key, runs bot/rate-limit checks, and handles idempotent
 * failure billing via `createGenerationHandler`. Reusing it keeps the secret on
 * the server and keeps billing/idempotency in their existing owner.
 */
async function generateSfxViaRoute(
  description: string,
  styleDirective: string,
  durationSeconds: number,
  signal: AbortSignal,
): Promise<SfxAudioResult> {
  const prompt = styleDirective.trim()
    ? `${description}. Style: ${styleDirective}`
    : description;

  const response = await fetch('/api/generate/sfx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, durationSeconds }),
    signal,
  });

  if (!response.ok) {
    // The route redacts provider internals; the status is all we surface.
    throw new Error(`SFX generation failed (${response.status})`);
  }

  const data = (await response.json()) as {
    audioBase64?: unknown;
    durationSeconds?: unknown;
    provider?: unknown;
  };

  const audioBase64 = typeof data.audioBase64 === 'string' ? data.audioBase64 : '';
  assertDecodableAudio(audioBase64);

  const returnedDuration =
    typeof data.durationSeconds === 'number' && Number.isFinite(data.durationSeconds)
      ? data.durationSeconds
      : durationSeconds;

  return {
    audioBase64,
    durationSeconds: returnedDuration,
    provider: typeof data.provider === 'string' ? data.provider : undefined,
  };
}

export const assetGenerateExecutor: ExecutorDefinition = {
  name: 'asset_generate',
  inputSchema,
  userFacingErrorMessage:
    'Asset generation failed. Using a placeholder instead.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    const { type, description, styleDirective, fallback, durationSeconds } = parsed.data;

    // Validate fallback before attempting generation, so we can use it on failure
    const fallbackParsed = FALLBACK_SCHEMA.safeParse(fallback);
    if (!fallbackParsed.success) {
      return failResult(
        makeStepError(
          'INVALID_FALLBACK',
          `Fallback value is invalid: ${fallbackParsed.error.message}`,
          this.userFacingErrorMessage,
        ),
      );
    }
    const fallbackId = fallbackParsed.data;

    if (ctx.signal.aborted) {
      return successResult({
        assetId: fallbackId,
        usedFallback: true,
        assetType: type,
      });
    }

    // Asset types without an adapter yet are explicitly unsupported/pending.
    // They resolve to the plan's deterministic fallback (never a fabricated
    // random id) and flag `pending`/`unsupported` so UI and AI can surface that
    // the real artifact is still owed by #9808 — a random `asset_<id>` is never
    // reported as success (#9900).
    if (!SUPPORTED_TYPES.has(type)) {
      return successResult({
        assetId: fallbackId,
        usedFallback: true,
        unsupported: true,
        pending: true,
        assetType: type,
      });
    }

    // type === 'sound' — real, authenticated ElevenLabs SFX generation.
    try {
      const audio = await generateSfxViaRoute(
        description,
        styleDirective,
        durationSeconds ?? SFX_DEFAULT_SECONDS,
        ctx.signal,
      );

      // TODO(#9922 / parent #9808): persist this audio through the asset
      // pipeline and attach it to the planned entity, replacing `assetId: null`
      // with the real persisted asset id. Billing finalization and the #8892
      // duplicate-callback recovery contract also land in that follow-up slice.
      // This slice deliberately stops at "validated audio in hand".
      return successResult({
        assetId: null,
        usedFallback: false,
        pending: true,
        assetType: 'sound',
        audioBase64: audio.audioBase64,
        durationSeconds: audio.durationSeconds,
        provider: audio.provider,
      });
    } catch {
      // Provider error, zero bytes, or undecodable audio — degrade to the
      // validated fallback. No fabricated asset is attached; the route's own
      // idempotent failure billing policy stands (no new job/refund here).
      return successResult({
        assetId: fallbackId,
        usedFallback: true,
        assetType: 'sound',
      });
    }
  },
};
