import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { uploadToR2, buildAssetKey } from '@/lib/storage/r2';
import { captureException } from '@/lib/monitoring/sentry-server';

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

    const db = getDb();

    const [asset] = await db
      .select()
      .from(marketplaceAssets)
      .where(and(eq(marketplaceAssets.id, assetId), eq(marketplaceAssets.sellerId, user.id)))
      .limit(1);

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

    // NOTE: Files are buffered entirely in memory before upload. For large assets (up to 100 MB),
    // this may cause memory pressure. Streaming uploads would be preferable but require S3's
    // multipart upload API or a presigned-URL flow, which adds significant complexity.
    // Acceptable for MVP; revisit if memory issues arise in production.

    if (previewFile) {
      const buffer = Buffer.from(await previewFile.arrayBuffer());
      const key = buildAssetKey(user.id, assetId, previewFile.name, 'preview');
      const { url } = await uploadToR2(key, buffer, previewFile.type);
      updates.previewUrl = url;
    }

    if (assetFile) {
      const buffer = Buffer.from(await assetFile.arrayBuffer());
      const key = buildAssetKey(user.id, assetId, assetFile.name, 'file');
      const { url } = await uploadToR2(key, buffer, assetFile.type);
      updates.assetFileUrl = url;
      updates.assetFileSize = assetFile.size;
    }

    // NOTE: If the DB update below fails after R2 upload succeeds, the uploaded objects become
    // orphaned. A cleanup job or reconciliation step could address this, but the added complexity
    // is not warranted for MVP.

    const [updated] = await db
      .update(marketplaceAssets)
      .set(updates)
      .where(eq(marketplaceAssets.id, assetId))
      .returning();

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
    return NextResponse.json({ error: 'Failed to upload files' }, { status: 500 });
  }
}
