import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  uploadToR2,
  buildAssetKey,
  deleteManyFromR2,
  resolveOwnedAssetKey,
  withStatusSidecars,
} from '@/lib/storage/r2';
import { captureException, captureMessage } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';

const ALLOWED_PREVIEW_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_ASSET_TYPES = [
  'model/gltf-binary', 'model/gltf+json', 'application/octet-stream',
  'image/png', 'image/jpeg', 'image/webp',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac',
];
const MAX_PREVIEW_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ASSET_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * POST /api/marketplace/seller/assets/[id]/upload
 *
 * Accepts multipart/form-data with `preview` and/or `asset` file fields.
 * Uploads to Cloudflare R2 and updates the asset record with CDN URLs.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:seller-asset-upload:${id}`, max: 10, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    const [asset] = await queryWithResilience(() => getDb()
      .select()
      .from(marketplaceAssets)
      .where(and(eq(marketplaceAssets.id, assetId), eq(marketplaceAssets.sellerId, user.id)))
      .limit(1));

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found or not owned by you' }, { status: 404 });
    }

    const formData = await req.formData();
    const previewFile = formData.get('preview') as File | null;
    const assetFile = formData.get('asset') as File | null;

    if (!previewFile && !assetFile) {
      return NextResponse.json({ error: 'No files provided. Include "preview" and/or "asset" fields.' }, { status: 400 });
    }

    const errors: string[] = [];

    if (previewFile) {
      if (!ALLOWED_PREVIEW_TYPES.includes(previewFile.type)) {
        errors.push(`Preview type "${previewFile.type}" not allowed. Use: ${ALLOWED_PREVIEW_TYPES.join(', ')}`);
      }
      if (previewFile.size > MAX_PREVIEW_SIZE) {
        errors.push(`Preview file too large (${(previewFile.size / 1024 / 1024).toFixed(1)} MB). Max: 5 MB`);
      }
    }

    if (assetFile) {
      if (!ALLOWED_ASSET_TYPES.includes(assetFile.type)) {
        errors.push(`Asset type "${assetFile.type}" not allowed. Use: ${ALLOWED_ASSET_TYPES.join(', ')}`);
      }
      if (assetFile.size > MAX_ASSET_SIZE) {
        errors.push(`Asset file too large (${(assetFile.size / 1024 / 1024).toFixed(1)} MB). Max: 100 MB`);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const updates: {
      previewUrl?: string;
      assetFileUrl?: string;
      assetFileSize?: number;
      updatedAt?: Date;
    } = { updatedAt: new Date() };

    // Keys the row currently points at. A re-upload under a *different*
    // filename leaves the old object live forever unless we remove it, so
    // collect the superseded keys and sweep them once the row no longer
    // references them (PF-9457). Only keys under this asset's own
    // assets/{sellerId}/{assetId}/ prefix qualify — previewUrl/assetFileUrl are
    // seller-writable via the asset PATCH route.
    const supersededKeys: string[] = [];

    if (previewFile) {
      const key = buildAssetKey(user.id, assetId, previewFile.name, 'preview');
      const body = typeof previewFile.stream === 'function'
        ? previewFile.stream()
        : Buffer.from(await previewFile.arrayBuffer());
      const { url } = await uploadToR2(key, body, previewFile.type);
      updates.previewUrl = url;

      const previousKey = resolveOwnedAssetKey(asset.previewUrl, user.id, assetId);
      // Same key means the PUT above overwrote the object in place — deleting
      // it would destroy the upload we just made.
      if (previousKey && previousKey !== key) supersededKeys.push(previousKey);
    }

    if (assetFile) {
      const key = buildAssetKey(user.id, assetId, assetFile.name, 'file');
      const body = typeof assetFile.stream === 'function'
        ? assetFile.stream()
        : Buffer.from(await assetFile.arrayBuffer());
      const { url } = await uploadToR2(key, body, assetFile.type);
      updates.assetFileUrl = url;
      updates.assetFileSize = assetFile.size;

      const previousKey = resolveOwnedAssetKey(asset.assetFileUrl, user.id, assetId);
      if (previousKey && previousKey !== key) supersededKeys.push(previousKey);
    }

    // NOTE: If the DB update below fails after R2 upload succeeds, the uploaded objects become
    // orphaned. A cleanup job or reconciliation step could address this, but the added complexity
    // is not warranted for MVP.

    const [updated] = await queryWithResilience(() => getDb()
      .update(marketplaceAssets)
      .set(updates)
      .where(eq(marketplaceAssets.id, assetId))
      .returning());

    // Best-effort, after the row stops referencing them: a storage failure here
    // must not fail an upload that already succeeded. deleteManyFromR2 never
    // throws; it reports what it could not remove so we can log it.
    if (supersededKeys.length > 0) {
      // Each superseded object has a `.status.json` sidecar written back by the
      // asset post-processing Worker. It is keyed off the object, not recorded
      // in Postgres, and nothing else ever removes it — so it goes with the
      // object it describes or it outlives it forever.
      const sweep = await deleteManyFromR2(withStatusSidecars(supersededKeys));
      if (sweep.failedKeys.length > 0) {
        console.error('Failed to delete superseded marketplace asset objects', {
          assetId,
          failedKeys: sweep.failedKeys,
          errors: sweep.errors,
        });
        captureMessage(
          `Superseded R2 object(s) orphaned for asset ${assetId}: ${sweep.failedKeys.join(', ')}`,
          'error',
        );
      }
    }

    return NextResponse.json({
      uploaded: {
        preview: updates.previewUrl ?? null,
        asset: updates.assetFileUrl ?? null,
        assetFileSize: updates.assetFileSize ?? null,
      },
      asset: updated,
    });
  } catch (error) {
    captureException(error, { route: '/api/marketplace/seller/assets/[id]/upload', assetId });
    console.error('Error uploading asset files:', error);
    return redactedJson({ error: 'Failed to upload files' }, { status: 500 });
  }
}
