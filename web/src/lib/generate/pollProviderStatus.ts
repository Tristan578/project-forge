/**
 * Shared, server-side provider-status poller for durable generation callbacks
 * (PF-906, #8816).
 *
 * `pollProviderStatus` replicates the EXACT status mapping each
 * `/api/generate/<type>/status` route performs — including the
 * `succeededButEmpty → failed` guard from #8757 — so the durable QStash
 * callback and the client poller agree on terminal state. The status-route
 * tests are the source of truth; the parity test in
 * `__tests__/pollProviderStatus.test.ts` pins these mappings against them.
 */

import { MeshyClient } from '@/lib/generate/meshyClient';
import { SunoClient } from '@/lib/generate/sunoClient';
import { SpriteClient } from '@/lib/generate/spriteClient';

/**
 * Async generation types that have a status route and a `generation_jobs` row.
 *
 * `pixel-art` is intentionally EXCLUDED: it has no member in the
 * `generation_type` DB enum (its route asserts `type: 'pixel-art'` → 400), so
 * there is no `generation_jobs` row for a durable callback to finalize. Adding
 * it here would force an enum migration for zero benefit — pixel-art stays on
 * the client-poll path. Any new value added to this union MUST also (1) have a
 * `generation_type` enum member, (2) map in `ASYNC_TYPE_TO_DB_CAPABILITY`
 * below, and (3) be exercised by the parity test.
 */
export type AsyncGenerationType =
  | 'model'
  | 'texture'
  | 'skybox'
  | 'music'
  | 'sprite'
  | 'sprite_sheet'
  | 'tileset';

/** Provider-capability key (in DB_PROVIDER) used to resolve the poll key. */
export type DbCapabilityForType = 'model3d' | 'texture' | 'music' | 'sprite';

/**
 * Maps each async type to the `DB_PROVIDER` capability whose key the callback
 * must resolve to poll the provider. Skybox reuses the texture provider
 * (Meshy); all sprite variants use the sprite provider (Replicate).
 */
export const ASYNC_TYPE_TO_DB_CAPABILITY: Record<AsyncGenerationType, DbCapabilityForType> = {
  model: 'model3d',
  texture: 'texture',
  skybox: 'texture',
  music: 'music',
  sprite: 'sprite',
  sprite_sheet: 'sprite',
  tileset: 'sprite',
};

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
      return pollSuno(providerJobId, apiKey);
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
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: 'Model generation produced no file' };
  }
  if (status.status === 'FAILED' || status.status === 'EXPIRED') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: 'Model generation failed' };
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
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: 'Texture generation produced no maps' };
  }
  if (status.status === 'FAILED' || status.status === 'EXPIRED') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: 'Texture generation failed' };
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
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: 'Skybox generation produced no image' };
  }
  if (status.status === 'FAILED' || status.status === 'EXPIRED') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: 'Skybox generation failed' };
  }
  if (status.status === 'IN_PROGRESS') {
    return { status: 'processing', progress: status.progress, succeededButEmpty: false };
  }
  return { status: 'pending', progress: status.progress, succeededButEmpty: false };
}

// --- music (Suno) — mirrors generate/music/status/route.ts ---
async function pollSuno(jobId: string, apiKey: string): Promise<NormalizedProviderStatus> {
  const status = await new SunoClient({ apiKey }).getStatus(jobId);

  if (status.status === 'completed' || status.status === 'succeeded') {
    if (status.audioUrl) {
      return { status: 'completed', progress: status.progress, resultUrl: status.audioUrl, succeededButEmpty: false };
    }
    return { status: 'failed', progress: status.progress, succeededButEmpty: true, errorMessage: 'Music generation produced no audio' };
  }
  if (status.status === 'failed' || status.status === 'error') {
    return { status: 'failed', progress: status.progress, succeededButEmpty: false, errorMessage: 'Music generation failed' };
  }
  if (status.status === 'processing' || status.status === 'generating') {
    return { status: 'processing', progress: status.progress, succeededButEmpty: false };
  }
  return { status: 'pending', progress: status.progress, succeededButEmpty: false };
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
    return { status: 'failed', progress: 100, succeededButEmpty: true, errorMessage: REPLICATE_EMPTY_MESSAGE[type] };
  }
  if (status.status === 'failed' || status.status === 'canceled') {
    return { status: 'failed', progress: 10, succeededButEmpty: false, errorMessage: REPLICATE_FAILED_MESSAGE[type] };
  }
  if (status.status === 'processing') {
    return { status: 'processing', progress: 50, succeededButEmpty: false };
  }
  return { status: 'pending', progress: 10, succeededButEmpty: false };
}
