import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets, sellerProfiles, assetReviews, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const db = getDb();

    // Fetch asset with seller info
    const [asset] = await db
      .select({
        id: marketplaceAssets.id,
        name: marketplaceAssets.name,
        description: marketplaceAssets.description,
        category: marketplaceAssets.category,
        priceTokens: marketplaceAssets.priceTokens,
        license: marketplaceAssets.license,
        previewUrl: marketplaceAssets.previewUrl,
        assetFileSize: marketplaceAssets.assetFileSize,
        downloadCount: marketplaceAssets.downloadCount,
        avgRating: marketplaceAssets.avgRating,
        ratingCount: marketplaceAssets.ratingCount,
        tags: marketplaceAssets.tags,
        aiGenerated: marketplaceAssets.aiGenerated,
        aiProvider: marketplaceAssets.aiProvider,
        metadataJson: marketplaceAssets.metadataJson,
        createdAt: marketplaceAssets.createdAt,
        sellerId: marketplaceAssets.sellerId,
        sellerName: sellerProfiles.displayName,
        sellerBio: sellerProfiles.bio,
        sellerPortfolio: sellerProfiles.portfolioUrl,
      })
      .from(marketplaceAssets)
      .leftJoin(sellerProfiles, eq(marketplaceAssets.sellerId, sellerProfiles.userId))
      .where(eq(marketplaceAssets.id, id))
      .limit(1);

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Fetch reviews
    const reviews = await db
      .select({
        id: assetReviews.id,
        rating: assetReviews.rating,
        content: assetReviews.content,
        createdAt: assetReviews.createdAt,
        userName: users.displayName,
        userEmail: users.email,
      })
      .from(assetReviews)
      .leftJoin(users, eq(assetReviews.userId, users.id))
      .where(eq(assetReviews.assetId, id))
      .orderBy(desc(assetReviews.createdAt))
      .limit(10);

    const formattedReviews = reviews.map((r: {
      id: string;
      rating: number;
      content: string | null;
      createdAt: Date;
      userName: string | null;
      userEmail: string | null;
    }) => ({
      id: r.id,
      rating: r.rating,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      userName: r.userName || r.userEmail?.split('@')[0] || 'Anonymous',
    }));

    return NextResponse.json({
      asset: {
        id: asset.id,
        name: asset.name,
        description: asset.description,
        category: asset.category,
        priceTokens: asset.priceTokens,
        license: asset.license,
        previewUrl: asset.previewUrl,
        assetFileSize: asset.assetFileSize,
        downloadCount: asset.downloadCount,
        avgRating: asset.avgRating ? asset.avgRating / 100 : 0,
        ratingCount: asset.ratingCount,
        tags: asset.tags,
        aiGenerated: asset.aiGenerated === 1,
        aiProvider: asset.aiProvider,
        metadata: asset.metadataJson,
        createdAt: asset.createdAt.toISOString(),
        seller: {
          id: asset.sellerId,
          name: asset.sellerName || 'Unknown',
          bio: asset.sellerBio,
          portfolioUrl: asset.sellerPortfolio,
        },
      },
      reviews: formattedReviews,
    });
  } catch (error) {
    console.error('Error fetching asset details:', error);
    return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 });
  }
}
