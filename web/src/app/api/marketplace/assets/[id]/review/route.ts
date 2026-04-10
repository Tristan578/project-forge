import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { assetPurchases, assetReviews, marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';
import { z } from 'zod';

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `review:${id}`, max: 20, windowSeconds: 60, distributed: false },
      validate: reviewSchema,
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;
    const { rating, content } = mid.body as z.infer<typeof reviewSchema>;

    // Check if user purchased the asset
    const [purchase] = await queryWithResilience(() => getDb()
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1));

    if (!purchase) {
      return NextResponse.json({ error: 'Must purchase asset before reviewing' }, { status: 403 });
    }

    // Check if already reviewed
    const [existingReview] = await queryWithResilience(() => getDb()
      .select()
      .from(assetReviews)
      .where(and(eq(assetReviews.assetId, assetId), eq(assetReviews.userId, user.id)))
      .limit(1));

    if (existingReview) {
      // Update existing review
      await queryWithResilience(() => getDb()
        .update(assetReviews)
        .set({ rating: rating, content: content ?? null })
        .where(eq(assetReviews.id, existingReview.id)));
    } else {
      // Insert new review — onConflictDoNothing makes this idempotent under
      // queryWithResilience retry (if INSERT succeeds but response is lost,
      // the retry won't fail with a duplicate key error).
      await queryWithResilience(() => getDb().insert(assetReviews).values({
        assetId,
        userId: user.id,
        rating: rating,
        content: content ?? null,
      }).onConflictDoNothing());
    }

    // Recalculate average rating (stored as rating * 100)
    const reviews = await queryWithResilience(() => getDb()
      .select({ rating: assetReviews.rating })
      .from(assetReviews)
      .where(eq(assetReviews.assetId, assetId)));

    const avgRating = Math.round((reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviews.length) * 100);

    await queryWithResilience(() => getDb()
      .update(marketplaceAssets)
      .set({
        avgRating,
        ratingCount: reviews.length,
      })
      .where(eq(marketplaceAssets.id, assetId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, { route: '/api/marketplace/assets/[id]/review' });
    console.error('Error submitting review:', error);
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
  }
}
