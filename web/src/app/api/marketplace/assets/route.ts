import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets, sellerProfiles } from '@/lib/db/schema';
import { desc, asc, eq, ilike, and, or, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const category = searchParams.get('category');
    const sort = (searchParams.get('sort') || 'popular') as 'newest' | 'popular' | 'top_rated' | 'price_low' | 'price_high' | 'free';
    const priceFilter = (searchParams.get('price') || 'all') as 'all' | 'free' | 'paid';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Build base query
    const conditions = [eq(marketplaceAssets.status, 'published')];

    if (category) {
      conditions.push(eq(marketplaceAssets.category, category as 'model_3d' | 'sprite' | 'texture' | 'audio' | 'script' | 'prefab' | 'template' | 'shader' | 'animation'));
    }

    if (query) {
      conditions.push(
        or(
          ilike(marketplaceAssets.name, `%${query}%`),
          ilike(marketplaceAssets.description, `%${query}%`),
          sql`${query} = ANY(${marketplaceAssets.tags})`
        )!
      );
    }

    if (priceFilter === 'free') {
      conditions.push(eq(marketplaceAssets.priceTokens, 0));
    } else if (priceFilter === 'paid') {
      conditions.push(sql`${marketplaceAssets.priceTokens} > 0`);
    }

    // Sorting
    let orderBy;
    switch (sort) {
      case 'newest':
        orderBy = desc(marketplaceAssets.createdAt);
        break;
      case 'popular':
        orderBy = desc(marketplaceAssets.downloadCount);
        break;
      case 'top_rated':
        orderBy = desc(marketplaceAssets.avgRating);
        break;
      case 'price_low':
        orderBy = asc(marketplaceAssets.priceTokens);
        break;
      case 'price_high':
        orderBy = desc(marketplaceAssets.priceTokens);
        break;
      case 'free':
        orderBy = desc(marketplaceAssets.createdAt);
        conditions.push(eq(marketplaceAssets.priceTokens, 0));
        break;
      default:
        orderBy = desc(marketplaceAssets.downloadCount);
    }

    const offset = (page - 1) * limit;

    // Fetch assets with seller info
    const results = await db
      .select({
        id: marketplaceAssets.id,
        name: marketplaceAssets.name,
        description: marketplaceAssets.description,
        category: marketplaceAssets.category,
        priceTokens: marketplaceAssets.priceTokens,
        license: marketplaceAssets.license,
        previewUrl: marketplaceAssets.previewUrl,
        downloadCount: marketplaceAssets.downloadCount,
        avgRating: marketplaceAssets.avgRating,
        ratingCount: marketplaceAssets.ratingCount,
        tags: marketplaceAssets.tags,
        aiGenerated: marketplaceAssets.aiGenerated,
        createdAt: marketplaceAssets.createdAt,
        sellerId: marketplaceAssets.sellerId,
        sellerName: sellerProfiles.displayName,
      })
      .from(marketplaceAssets)
      .leftJoin(sellerProfiles, eq(marketplaceAssets.sellerId, sellerProfiles.userId))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const assets = results.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      priceTokens: r.priceTokens,
      license: r.license,
      previewUrl: r.previewUrl,
      sellerName: r.sellerName || 'Unknown',
      sellerId: r.sellerId,
      downloadCount: r.downloadCount,
      avgRating: r.avgRating ? r.avgRating / 100 : 0,
      ratingCount: r.ratingCount,
      tags: r.tags,
      aiGenerated: r.aiGenerated === 1,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ assets, hasMore });
  } catch (error) {
    console.error('Error fetching marketplace assets:', error);
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
  }
}
