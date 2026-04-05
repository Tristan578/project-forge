import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { marketplaceAssets, assetPurchases } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
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
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:marketplace-download:${id}`, max: 10, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    const [asset] = await queryWithResilience(() => getDb()
      .select()
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.id, assetId))
      .limit(1));

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Check if user purchased it or owns it
    const [purchase] = await queryWithResilience(() => getDb()
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1));

    const isOwner = asset.sellerId === user.id;

    if (!purchase && !isOwner) {
      return NextResponse.json({ error: 'Not authorized to download' }, { status: 403 });
    }

    if (!asset.assetFileUrl) {
      return NextResponse.json({ error: 'No file available' }, { status: 404 });
    }

    // Atomic download count increment (PF-7507).
    // Only count buyer downloads — owner downloads don't reflect buyer engagement.
    // Uses SQL expression SET download_count = download_count + 1 so concurrent
    // downloads never lose an update (no stale read-increment-write pattern).
    // Fire-and-forget: a failure here does not block the user's download.
    if (!isOwner) {
      queryWithResilience(() => getDb().update(marketplaceAssets)
        .set({ downloadCount: sql`${marketplaceAssets.downloadCount} + 1` })
        .where(eq(marketplaceAssets.id, assetId)))
        .catch(() => {});
    }

    // If the URL is a CDN URL, generate a signed download URL from R2.
    // Compare parsed hostnames explicitly to avoid substring false positives
    // (e.g. "evil-cdn.spawnforge.ai" matching "cdn.spawnforge.ai").
    const cdnHost = process.env.CDN_URL;
    if (cdnHost) {
      try {
        const assetHostname = new URL(asset.assetFileUrl).hostname;
        const cdnHostname = cdnHost.includes('://') ? new URL(cdnHost).hostname : cdnHost;
        if (assetHostname === cdnHostname) {
          const storageKey = extractStorageKey(asset.assetFileUrl);
          if (storageKey) {
            const signedUrl = await getSignedDownloadUrl(storageKey);
            return NextResponse.redirect(signedUrl);
          }
        }
      } catch {
        // assetFileUrl is not a valid URL — fall through to validation below
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
