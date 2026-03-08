import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets, assetPurchases } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSignedDownloadUrl } from '@/lib/storage/r2';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Extract the R2 storage key from a CDN URL.
 * e.g. "https://cdn.spawnforge.ai/assets/seller/asset/file/model.glb"
 *   -> "assets/seller/asset/file/model.glb"
 */
function extractStorageKey(cdnUrl: string): string | null {
  try {
    const url = new URL(cdnUrl);
    // Strip leading slash from pathname
    const key = url.pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
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
      .where(eq(marketplaceAssets.id, assetId))
      .limit(1);

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Check if user purchased it or owns it
    const [purchase] = await db
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1);

    const isOwner = asset.sellerId === user.id;

    if (!purchase && !isOwner) {
      return NextResponse.json({ error: 'Not authorized to download' }, { status: 403 });
    }

    if (!asset.assetFileUrl) {
      return NextResponse.json({ error: 'No file available' }, { status: 404 });
    }

    // If the URL is a CDN URL, generate a signed download URL from R2
    const cdnHost = process.env.CDN_URL;
    if (cdnHost && asset.assetFileUrl.includes(cdnHost)) {
      const storageKey = extractStorageKey(asset.assetFileUrl);
      if (storageKey) {
        const signedUrl = await getSignedDownloadUrl(storageKey);
        return NextResponse.json({ downloadUrl: signedUrl });
      }
    }

    // Fallback: validate URL against allowed domains to prevent open redirect
    const allowedHosts = (process.env.ASSET_CDN_HOSTS || 'localhost').split(',').map(h => h.trim());
    try {
      const fileUrl = new URL(asset.assetFileUrl);
      const localhostNames = ['localhost', '127.0.0.1', '::1'];
      if (fileUrl.protocol !== 'https:' && !localhostNames.includes(fileUrl.hostname)) {
        return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
      }
      const hostLabels = fileUrl.hostname.split('.');
      const isAllowed = allowedHosts.some(host => {
        if (fileUrl.hostname === host) return true;
        const allowedLabels = host.split('.');
        if (hostLabels.length <= allowedLabels.length) return false;
        return allowedLabels.every((label, i) =>
          hostLabels[hostLabels.length - allowedLabels.length + i] === label
        );
      });
      if (!isAllowed) {
        return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
    }

    return NextResponse.redirect(asset.assetFileUrl);
  } catch (error) {
    captureException(error, { route: '/api/marketplace/assets/[id]/download', assetId });
    console.error('Error downloading asset:', error);
    return NextResponse.json({ error: 'Failed to download asset' }, { status: 500 });
  }
}
