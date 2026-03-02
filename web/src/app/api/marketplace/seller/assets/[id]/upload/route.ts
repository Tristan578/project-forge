import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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
 * Currently validates files and returns 501 — actual cloud storage upload
 * requires ASSET_STORAGE_TYPE and storage credentials to be configured.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

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

    // Check if cloud storage is configured
    const storageType = process.env.ASSET_STORAGE_TYPE;
    if (!storageType) {
      return NextResponse.json(
        {
          error: 'File storage not configured',
          message: 'Cloud object storage (R2/S3) is not yet configured. Set ASSET_STORAGE_TYPE and storage credentials in environment variables.',
          validated: {
            preview: previewFile ? { name: previewFile.name, type: previewFile.type, size: previewFile.size } : null,
            asset: assetFile ? { name: assetFile.name, type: assetFile.type, size: assetFile.size } : null,
          },
        },
        { status: 501 }
      );
    }

    // Future: Upload to R2/S3 and update DB with URLs
    return NextResponse.json({ error: 'Storage integration not yet implemented' }, { status: 501 });
  } catch (error) {
    console.error('Error uploading asset files:', error);
    return NextResponse.json({ error: 'Failed to upload files' }, { status: 500 });
  }
}
