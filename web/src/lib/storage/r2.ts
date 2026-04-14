import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

let client: S3Client | null = null;

function getR2Client(): S3Client {
  if (client) return client;

  const accountId = process.env.ASSET_R2_ACCOUNT_ID;
  const accessKeyId = process.env.ASSET_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ASSET_R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 storage not configured. Set ASSET_R2_ACCOUNT_ID, ASSET_R2_ACCESS_KEY_ID, ASSET_R2_SECRET_ACCESS_KEY.'
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
  const bucket = process.env.ASSET_BUCKET_NAME;
  if (!bucket) throw new Error('ASSET_BUCKET_NAME not configured');
  return bucket;
}

function getCdnUrl(): string {
  return process.env.CDN_URL ?? '';
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

  const cdn = getCdnUrl();
  if (!cdn) {
    throw new Error(
      'CDN_URL not configured. Cannot produce a valid asset URL without it.'
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
 * Delete a file from R2 by its storage key.
 */
export async function deleteFromR2(key: string): Promise<void> {
  const r2 = getR2Client();
  const bucket = getBucket();

  await r2.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
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
