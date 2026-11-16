/**
 * Shared, server-side provider-status poller for durable generation callbacks
 * (PF-906, #8816).
 *
 * `pollProviderStatus` replicates the EXACT status mapping each
 * `/api/generate/<type>/status` route performs — including the
 * `succeededButEmpty → failed` guard from #8757 — so the durable QStash
 * callback and the client poller agree on terminal state.
 *
 * MAINTENANCE CONTRACT: this file MUST stay in sync with each
 * `/api/generate/<type>/status` route. That invariant is enforced
 * automatically by `__tests__/pollProviderStatus.parity.test.ts`, which feeds
 * the SAME mocked provider response to both this poller and the matching route
 * `GET` handler and asserts they agree on the terminal `status` and the
 * failure message for every case. So if you change a status-route mapping you
 * MUST also update the matching `poll<Type>` function below — otherwise the
 * parity suite fails CI rather than letting the durable callback silently
 * disagree with the client poller. (The companion
 * `__tests__/pollProviderStatus.test.ts` additionally pins this file's
 * normalized output branch by branch against mocked provider clients.)
 */

import { MeshyClient } from '@/lib/generate/meshyClient';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { withRetryGuidance } from '@/lib/generate/retryGuidance';
import type { AsyncGenerationType } from './asyncTypeCapability';

/**
 * Terminal message for a music-job poll (PF-1301 / #9522). Music routes to
 * ElevenLabs `/v1/music`, which returns audio inline, so there is no async task
 * to poll: `POST /api/generate/music` resolves synchronously. If a music job is
 * ever polled anyway, both this poller and `/api/generate/music/status` return
 * this exact terminal message — the parity suite pins them together.
 */
export const MUSIC_SYNC_TERMINAL_MESSAGE = withRetryGuidance(
  'Music generation completes inline and has no job to poll',
);

/**
 * The async type union and its type→capability map live in the leaf module
 * `asyncTypeCapability.ts` (so `POST /api/jobs` can derive the ownership
 * provider without importing the provider clients above, #10262) and are
 * re-exported here for every existing import site.
 */
export {
  ASYNC_TYPE_TO_DB_CAPABILITY,
  type AsyncGenerationType,
  type DbCapabilityForType,
} from './asyncTypeCapability';

/** Normalized, provider-agnostic status the callback acts on. */
export interface NormalizedProviderStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** 0–100. */
  progress: number;
  /** Single result artifact URL (model glb, skybox image, music audio, sprite image). */
  resultUrl?: string;
  /** Map of PBR texture URLs (texture type only). */
  resultMeta?: Record<string, string>;
  /**
   * True when the provider reported success but produced no artifact (#8757):
   * the job is mapped to `failed` so the user is refunded rather than stuck.
   */
  succeededButEmpty: boolean;
  errorMessage?: string;
}

/**
 * Poll a provider for the terminal state of one job and normalize the result.
 * Mirrors the matching `/status` route exactly. Throws on a transport error so
 * the webhook returns 500 and QStash retries with its own backoff.
 */
export async function pollProviderStatus(
  type: AsyncGenerationType,
  providerJobId: string,
  apiKey: string,
): Promise<NormalizedProviderStatus> {
  switch (type) {
    case 'model':
      return pollMeshyModel(providerJobId, apiKey);
    case 'texture':
      return pollMeshyTexture(providerJobId, apiKey);
    case 'skybox':
      return pollMeshySkybox(providerJobId, apiKey);
    case 'music':
      return pollElevenLabsMusic();
    case 'sprite':
    case 'sprite_sheet':
    case 'tileset':
      return pollReplicate(type, providerJobId, apiKey);
  }
}

// --- model (Meshy text-to-3D) — mirrors generate/model/status/route.ts ---
async function pollMeshyModel(jobId: string, apiKey: string): Promise<NormalizedProviderStatus> {
  const status = await new MeshyClient({ apiKey }).getTaskStatus(jobId);

  if (status.status === 'SUCCEEDED') {
    if (status.modelUrls?.glb) {
      return { status: 'completed', progress: status.progress, resultUrl: status.modelUrls.glb, succeededButEmpty: false };
    }
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: withRetryGuidance('Model generation produced no file') };
  }
  if (status.status === 'FAILED' || status.status === 'EXPIRED') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: withRetryGuidance('Model generation failed') };
  }
  if (status.status === 'IN_PROGRESS') {
    return { status: 'processing', progress: status.progress, succeededButEmpty: false };
  }
  return { status: 'pending', progress: status.progress, succeededButEmpty: false };
}

// --- texture (Meshy text-to-texture) — mirrors generate/texture/status/route.ts ---
async function pollMeshyTexture(jobId: string, apiKey: string): Promise<NormalizedProviderStatus> {
  const status = await new MeshyClient({ apiKey }).getTextureStatus(jobId);
  const hasMaps = !!status.maps && Object.keys(status.maps).length > 0;

  if (status.status === 'SUCCEEDED') {
    if (hasMaps) {
      return { status: 'completed', progress: status.progress, resultMeta: status.maps, succeededButEmpty: false };
    }
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: withRetryGuidance('Texture generation produced no maps') };
  }
  if (status.status === 'FAILED' || status.status === 'EXPIRED') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: withRetryGuidance('Texture generation failed') };
  }
  if (status.status === 'IN_PROGRESS') {
    return { status: 'processing', progress: status.progress, succeededButEmpty: false };
  }
  return { status: 'pending', progress: status.progress, succeededButEmpty: false };
}

// --- skybox (Meshy text-to-texture, single image) — mirrors generate/skybox/status/route.ts ---
async function pollMeshySkybox(jobId: string, apiKey: string): Promise<NormalizedProviderStatus> {
  const status = await new MeshyClient({ apiKey }).getTextureStatus(jobId);
  const skyboxUrl = status.maps ? Object.values(status.maps)[0] : undefined;

  if (status.status === 'SUCCEEDED') {
    if (skyboxUrl) {
      return { status: 'completed', progress: status.progress, resultUrl: skyboxUrl, succeededButEmpty: false };
    }
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: withRetryGuidance('Skybox generation produced no image') };
  }
  if (status.status === 'FAILED' || status.status === 'EXPIRED') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: withRetryGuidance('Skybox generation failed') };
  }
  if (status.status === 'IN_PROGRESS') {
    return { status: 'processing', progress: status.progress, succeededButEmpty: false };
  }
  return { status: 'pending', progress: status.progress, succeededButEmpty: false };
}

// --- music (ElevenLabs) — mirrors generate/music/status/route.ts ---
// ElevenLabs `/v1/music` returns audio inline (no async task), so the generate
// route resolves synchronously and nothing enqueues a music job for polling. A
// poll reaching here is defensive: report a single terminal `failed` state so a
// phantom job is refunded rather than left in flight. Takes no provider call —
// there is no music status endpoint to hit.
function pollElevenLabsMusic(): NormalizedProviderStatus {
  return {
    status: 'failed',
    progress: 0,
    succeededButEmpty: false,
    errorMessage: MUSIC_SYNC_TERMINAL_MESSAGE,
  };
}

// --- sprite / sprite_sheet / tileset (Replicate SDXL) — mirrors the three sprite status routes ---
const REPLICATE_EMPTY_MESSAGE: Record<'sprite' | 'sprite_sheet' | 'tileset', string> = {
  sprite: 'Sprite generation produced no image',
  sprite_sheet: 'Sprite sheet generation produced no image',
  tileset: 'Tileset generation produced no image',
};
const REPLICATE_FAILED_MESSAGE: Record<'sprite' | 'sprite_sheet' | 'tileset', string> = {
  sprite: 'Sprite generation failed',
  sprite_sheet: 'Sprite sheet generation failed',
  tileset: 'Tileset generation failed',
};

async function pollReplicate(
  type: 'sprite' | 'sprite_sheet' | 'tileset',
  jobId: string,
  apiKey: string,
): Promise<NormalizedProviderStatus> {
  const status = await new SpriteClient(apiKey, 'sdxl').getReplicateStatus(jobId);

  if (status.status === 'succeeded') {
    if (status.output?.length) {
      return { status: 'completed', progress: 100, resultUrl: status.output[0], succeededButEmpty: false };
    }
    return { status: 'failed', progress: 100, succeededButEmpty: true, errorMessage: withRetryGuidance(REPLICATE_EMPTY_MESSAGE[type]) };
  }
  if (status.status === 'failed' || status.status === 'canceled') {
    return { status: 'failed', progress: 10, succeededButEmpty: false, errorMessage: withRetryGuidance(REPLICATE_FAILED_MESSAGE[type]) };
  }
  if (status.status === 'processing') {
    return { status: 'processing', progress: 50, succeededButEmpty: false };
  }
  return { status: 'pending', progress: 10, succeededButEmpty: false };
}
