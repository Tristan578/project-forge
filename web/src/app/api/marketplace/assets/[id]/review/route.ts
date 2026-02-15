import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { users, assetPurchases, assetReviews, marketplaceAssets } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await context.params;

  try {
    const db = getDb();
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { rating, content } = body;

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 });
    }

    // Get user
    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
