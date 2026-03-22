import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { assetPurchases, assetReviews, marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { parseJsonBody, requireInteger, optionalString } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user, clerkId } = authResult.ctx;

    const db = getDb();

    // Rate limit: 20 review submissions per minute per user
    const rl = await rateLimit(`review:${clerkId}`, 20, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const parsed = await parseJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const ratingResult = requireInteger(parsed.body.rating, 'Rating', { min: 1, max: 5 });
    if (!ratingResult.ok) return ratingResult.response;

    const contentResult = optionalString(parsed.body.content, 'Review content', { maxLength: 2000 });
    if (!contentResult.ok) return contentResult.response;

    // Check if user purchased the asset
    const [purchase] = await db
      .select()
      .from(assetPurchases)
      .where(and(eq(assetPurchases.buyerId, user.id), eq(assetPurchases.assetId, assetId)))
      .limit(1);

    if (!purchase) {
      return NextResponse.json({ error: 'Must purchase asset before reviewing' }, { status: 403 });
    }

    // Check if already reviewed
    const [existingReview] = await db
      .select()
      .from(assetReviews)
      .where(and(eq(assetReviews.assetId, assetId), eq(assetReviews.userId, user.id)))
      .limit(1);

    if (existingReview) {
      // Update existing review
      await db
        .update(assetReviews)
        .set({ rating: ratingResult.value, content: contentResult.value ?? null })
        .where(eq(assetReviews.id, existingReview.id));
    } else {
      // Insert new review
      await db.insert(assetReviews).values({
        assetId,
        userId: user.id,
        rating: ratingResult.value,
        content: contentResult.value ?? null,
      });
    }

    // Recalculate average rating (stored as rating * 100)
    const reviews = await db
      .select({ rating: assetReviews.rating })
      .from(assetReviews)
      .where(eq(assetReviews.assetId, assetId));

    const avgRating = Math.round((reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviews.length) * 100);

    await db
      .update(marketplaceAssets)
      .set({
        avgRating,
        ratingCount: reviews.length,
      })
      .where(eq(marketplaceAssets.id, assetId));

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, { route: '/api/marketplace/assets/[id]/review', method: 'POST' });
    console.error('Error submitting review:', error);
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
  }
}
