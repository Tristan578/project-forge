import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { assetPurchases, assetReviews, marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

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
    const rl = rateLimit(`review:${clerkId}`, 20, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { rating, content } = body;

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 });
    }

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
        .set({ rating, content: content || null })
        .where(eq(assetReviews.id, existingReview.id));
    } else {
      // Insert new review
      await db.insert(assetReviews).values({
        assetId,
        userId: user.id,
        rating,
        content: content || null,
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
    console.error('Error submitting review:', error);
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
  }
}
