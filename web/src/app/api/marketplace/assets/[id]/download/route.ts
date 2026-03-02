import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets, assetPurchases } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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

    // Get asset
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

    // Validate URL against allowed domains to prevent open redirect
    const allowedHosts = (process.env.ASSET_CDN_HOSTS || 'localhost').split(',').map(h => h.trim());
    try {
      const fileUrl = new URL(asset.assetFileUrl);
      const localhostNames = ['localhost', '127.0.0.1', '::1'];
      // Only allow https (or http for localhost/loopback dev)
      if (fileUrl.protocol !== 'https:' && !localhostNames.includes(fileUrl.hostname)) {
        console.error(`Blocked redirect to non-HTTPS URL: ${fileUrl.protocol}`);
        return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
      }
      // Check each allowed host by exact hostname or exact subdomain label match
      // to avoid incomplete substring sanitization (e.g. evil-cdn.com matching cdn.com)
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
        console.error(`Blocked redirect to disallowed host: ${fileUrl.hostname}`);
        return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid file URL' }, { status: 400 });
    }

    return NextResponse.redirect(asset.assetFileUrl);
  } catch (error) {
    console.error('Error downloading asset:', error);
    return NextResponse.json({ error: 'Failed to download asset' }, { status: 500 });
  }
}
