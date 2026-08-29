import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ASSET_STORAGE_ENV } from '@/lib/config/assetStorage';

let client: S3Client | null = null;

function getR2Client(): S3Client {
  if (client) return client;

  const accountId = process.env[ASSET_STORAGE_ENV.accountId];
  const accessKeyId = process.env[ASSET_STORAGE_ENV.accessKeyId];
  const secretAccessKey = process.env[ASSET_STORAGE_ENV.secretAccessKey];

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      `R2 storage not configured. Set ${ASSET_STORAGE_ENV.accountId}, ${ASSET_STORAGE_ENV.accessKeyId}, ${ASSET_STORAGE_ENV.secretAccessKey}.`
    );
  }

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

function getBucket(): string {
  const bucket = process.env[ASSET_STORAGE_ENV.bucketName];
  if (!bucket) throw new Error(`${ASSET_STORAGE_ENV.bucketName} not configured`);
  return bucket;
}

/**
 * The CDN host for asset URLs, with any configured scheme normalised away.
 *
 * `CDN_URL` is documented as a bare hostname, and both sides of this module have
 * to agree on that. They did not: `uploadToR2` unconditionally prepended
 * `https://`, so a value like `https://cdn.example.com` minted
 * `https://https://cdn.example.com/<key>`. That URL still parses, but its host
 * is `https`, so `resolveOwnedAssetKey` could never match it back to a key and
 * every later cleanup for that asset silently no-opped, orphaning the object in
 * R2. Normalising in one place is what keeps the mint and the match symmetric.
 *
 * Returns '' when unset or unparseable; callers treat that as "not configured".
 */
function getCdnHost(): string {
  const raw = (process.env.CDN_URL ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).host;
  } catch {
    return '';
  }
}

/**
 * Upload a file buffer to R2.
 * Returns the public CDN URL and the storage key.
 * Throws if CDN_URL is not configured, since callers treat the URL as absolute.
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | ReadableStream<Uint8Array>,
  contentType: string
): Promise<{ url: string; key: string }> {
  const r2 = getR2Client();
  const bucket = getBucket();

  const cdn = getCdnHost();
  if (!cdn) {
    throw new Error(
      'CDN_URL not configured, or not a parseable host. Cannot produce a valid asset URL without it.'
    );
  }

  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  const url = `https://${cdn}/${key}`;

  return { url, key };
}

/**
 * S3/R2 hard limit on how many keys a single DeleteObjects request accepts.
 * Cloudflare R2 implements the S3 DeleteObjects API with the same 1000-key cap.
 */
const R2_DELETE_BATCH_SIZE = 1000;

/**
 * Ceiling on how many keys one best-effort sweep will attempt.
 *
 * 5000 keys = 5 DeleteObjects round-trips, which fits comfortably inside a
 * serverless function budget. Without a ceiling, a seller with a pathological
 * number of assets would turn account deletion into an unbounded loop and blow
 * the function timeout — which, because the DB transaction commits first, would
 * abort the sweep at an arbitrary point with no record of what was left behind.
 * Anything past the ceiling is reported via `truncated` so the caller can log
 * it for reconciliation instead.
 */
export const MAX_R2_SWEEP_KEYS = 5000;

export interface R2DeleteSweepResult {
  /** Keys actually attempted (after de-duplication and truncation). */
  requested: number;
  /** Keys R2 reported as removed (a missing key counts as removed). */
  deleted: number;
  /** Keys R2 refused or that a transport failure took down with them. */
  failedKeys: string[];
  /** Human-readable failure reasons, for logging to monitoring. */
  errors: string[];
  /** True when the input exceeded MAX_R2_SWEEP_KEYS and the tail was skipped. */
  truncated: boolean;
}

/**
 * Best-effort batch delete of many R2 objects.
 *
 * This function NEVER throws — not on a misconfigured client, not on a network
 * failure, not on a per-key S3 error. Callers use it on the tail end of
 * user-facing destructive operations (account deletion, asset replacement)
 * where an object-storage hiccup must not fail the operation the user asked
 * for: an orphaned object costs storage, whereas a half-failed account deletion
 * costs the user their account in an undefined state. Every failure is returned
 * in `failedKeys`/`errors` so the caller can log it to monitoring, and the keys
 * remain enumerable by the `assets/{sellerId}/` prefix for later reconciliation.
 *
 * Batching: keys are de-duplicated, capped at MAX_R2_SWEEP_KEYS, and sent in
 * DeleteObjects requests of at most R2_DELETE_BATCH_SIZE keys each — so the
 * number of round-trips is bounded by construction (≤5), never one request
 * per object.
 */
export async function deleteManyFromR2(keys: string[]): Promise<R2DeleteSweepResult> {
  const unique = Array.from(
    new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0))
  );
  const truncated = unique.length > MAX_R2_SWEEP_KEYS;
  const target = truncated ? unique.slice(0, MAX_R2_SWEEP_KEYS) : unique;

  const result: R2DeleteSweepResult = {
    requested: target.length,
    deleted: 0,
    failedKeys: [],
    errors: [],
    truncated,
  };

  if (target.length === 0) return result;

  let r2: S3Client;
  let bucket: string;
  try {
    r2 = getR2Client();
    bucket = getBucket();
  } catch (error: unknown) {
    // R2 not configured (e.g. a preview deploy without storage credentials).
    // Report, do not throw — the caller's operation must still succeed.
    result.failedKeys = target;
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  for (let i = 0; i < target.length; i += R2_DELETE_BATCH_SIZE) {
    const batch = target.slice(i, i + R2_DELETE_BATCH_SIZE);
    try {
      const response = await r2.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
      const batchErrors = (response as { Errors?: { Key?: string; Code?: string; Message?: string }[] } | undefined)
        ?.Errors ?? [];
      for (const failure of batchErrors) {
        result.failedKeys.push(failure.Key ?? '<unknown key>');
        result.errors.push(
          `${failure.Key ?? '<unknown key>'}: ${failure.Code ?? 'Error'} ${failure.Message ?? ''}`.trim()
        );
      }
      result.deleted += batch.length - batchErrors.length;
    } catch (error: unknown) {
      result.failedKeys.push(...batch);
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}

/**
 * Resolve a stored asset URL to the R2 key we are allowed to act on.
 *
 * Returns null unless the URL parses, is served from the configured CDN host,
 * and its key sits under the owning seller's own `assets/{sellerId}/{assetId}/`
 * prefix — the exact shape `buildAssetKey` produces.
 *
 * The prefix check is a security boundary, not a tidiness check: sellers can
 * set `previewUrl` / `assetFileUrl` to an arbitrary string via
 * PATCH /api/marketplace/seller/assets/[id], so trusting the stored URL would
 * let one seller point at another seller's key and have us delete it (or mint a
 * signed download URL for it).
 */
export function resolveOwnedAssetKey(
  url: string | null | undefined,
  sellerId: string,
  assetId: string
): string | null {
  if (!url || !sellerId || !assetId) return null;

  const cdnHost = getCdnHost();
  if (!cdnHost) {
    // Distinct from a URL that merely fails to match: this is a fault on our
    // side, and it makes cleanup no-op for every asset of every seller. Staying
    // silent here is what turns one bad env var into unbounded orphaned objects.
    console.warn(
      '[r2] CDN_URL is unset or unparseable — cannot resolve owned asset keys, so asset cleanup will delete nothing.'
    );
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.host || parsed.host !== cdnHost) return null;

  // `new URL()` already normalises away any `..` segments in the path.
  const key = parsed.pathname.replace(/^\/+/, '');
  if (!key.startsWith(`assets/${sellerId}/${assetId}/`)) return null;

  return key;
}

/**
 * Suffix of the JSON sidecar the asset post-processing Worker writes back beside
 * every object created in the asset bucket.
 *
 * `infra/asset-postprocess/worker.mjs` (`STATUS_SUFFIX`) consumes bucket-wide
 * R2 object-create notifications for `spawnforge-assets` — the same bucket this
 * module writes marketplace uploads to — and PUTs a `<key>.status.json` record
 * next to each artifact it validates. The sidecar therefore:
 *   - lives under the same `assets/{sellerId}/{assetId}/` prefix as the object,
 *   - is keyed to the uploading seller, and
 *   - is recorded nowhere in Postgres.
 *
 * So a sweep driven off DB rows has to derive it. Without that, deleting a
 * marketplace object leaves its sidecar behind forever, and account deletion
 * leaves per-user JSON in the bucket after the account is gone.
 */
export const ASSET_STATUS_SIDECAR_SUFFIX = '.status.json';

/**
 * Expand object keys to also cover each key's status sidecar.
 *
 * Each input key is followed immediately by `<key>.status.json`. A key that is
 * already a sidecar is passed through unchanged rather than growing a second
 * suffix. Deleting a sidecar that was never written is a no-op in R2, so it is
 * always safe to ask for one.
 */
export function withStatusSidecars(keys: string[]): string[] {
  const expanded: string[] = [];
  for (const key of keys) {
    expanded.push(key);
    if (!key.endsWith(ASSET_STATUS_SIDECAR_SUFFIX)) {
      expanded.push(`${key}${ASSET_STATUS_SIDECAR_SUFFIX}`);
    }
  }
  return expanded;
}

/**
 * Check if a file exists in R2.
 * Returns false only for NotFound errors; rethrows all other errors.
 */
export async function existsInR2(key: string): Promise<boolean> {
  const r2 = getR2Client();
  const bucket = getBucket();

  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: unknown) {
    const isNotFound =
      (error instanceof Error && error.name === 'NotFound') ||
      (typeof error === 'object' && error !== null && '$metadata' in error &&
        (error as { $metadata: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404);
    if (isNotFound) return false;
    throw error;
  }
}

/**
 * Generate a time-limited signed download URL for a private R2 object.
 * Default expiry: 1 hour.
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const r2 = getR2Client();
  const bucket = getBucket();

  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

/**
 * Build a deterministic storage key for marketplace assets.
 * Format: assets/{sellerId}/{assetId}/{type}/{filename}
 */
export function buildAssetKey(
  sellerId: string,
  assetId: string,
  filename: string,
  type: 'file' | 'preview'
): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `assets/${sellerId}/${assetId}/${type}/${sanitized}`;
}
