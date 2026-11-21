import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

const patchAssetSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  priceTokens: z.number().int().nonnegative().optional(),
  license: z.string().max(50).optional(),
  tags: z.array(z.string()).max(20).optional(),
  previewUrl: z.string().max(2000).optional(),
  assetFileUrl: z.string().max(2000).optional(),
  assetFileSize: z.number().int().nonnegative().optional(),
  status: z.enum(['draft', 'pending_review']).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:seller-asset-patch:${id}`, max: 10, windowSeconds: 60, distributed: false },
      validate: patchAssetSchema,
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;
    const body = mid.body as z.infer<typeof patchAssetSchema>;

    // Check ownership
    const [asset] = await queryWithResilience(() => getDb()
      .select()
      .from(marketplaceAssets)
      .where(and(eq(marketplaceAssets.id, assetId), eq(marketplaceAssets.sellerId, user.id)))
      .limit(1));

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priceTokens !== undefined) updates.priceTokens = body.priceTokens;
    if (body.license !== undefined) updates.license = body.license;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.previewUrl !== undefined) updates.previewUrl = body.previewUrl;
    if (body.assetFileUrl !== undefined) updates.assetFileUrl = body.assetFileUrl;
    if (body.assetFileSize !== undefined) updates.assetFileSize = body.assetFileSize;
    if (body.status !== undefined) {
      // Sellers can only transition draft -> pending_review. Publishing requires admin review.
      const allowedTransitions: Record<string, string[]> = {
        draft: ['pending_review'],
        pending_review: ['draft'], // Can withdraw back to draft
        rejected: ['pending_review', 'draft'], // Can resubmit
      };
      const allowed = allowedTransitions[asset.status] || [];
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          { error: `Cannot transition from '${asset.status}' to '${body.status}'` },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }

    await queryWithResilience(() => getDb()
      .update(marketplaceAssets)
      .set(updates)
      .where(eq(marketplaceAssets.id, assetId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating asset:', error);
    captureException(error, { route: '/api/marketplace/seller/assets/[id]', method: 'PATCH' });
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 });
  }
}
