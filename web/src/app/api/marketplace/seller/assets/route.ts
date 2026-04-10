import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

const createAssetSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum(['model_3d', 'sprite', 'texture', 'audio', 'script', 'prefab', 'template', 'shader', 'animation']),
  license: z.enum(['standard', 'extended']).optional().default('standard'),
  priceTokens: z.number().int().nonnegative().optional().default(0),
  tags: z.array(z.string()).max(20).optional().default([]),
});

export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:seller-assets-list:${id}`, max: 30, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    const assets = await queryWithResilience(() => getDb()
      .select()
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.sellerId, user.id)));

    const formatted = assets.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      status: a.status,
      priceTokens: a.priceTokens,
      license: a.license,
      downloadCount: a.downloadCount,
      avgRating: a.avgRating ? a.avgRating / 100 : 0,
      ratingCount: a.ratingCount,
      createdAt: a.createdAt.toISOString(),
    }));

    return NextResponse.json({ assets: formatted });
  } catch (error) {
    console.error('Error fetching seller assets:', error);
    captureException(error, { route: '/api/marketplace/seller/assets', method: 'GET' });
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:seller-assets-create:${id}`, max: 10, windowSeconds: 60, distributed: false },
      validate: createAssetSchema,
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;
    const { name, description, category, license, priceTokens, tags } = mid.body as z.infer<typeof createAssetSchema>;

    const [asset] = await queryWithResilience(() => getDb()
      .insert(marketplaceAssets)
      .values({
        sellerId: user.id,
        name,
        description,
        category,
        priceTokens,
        license,
        tags,
        status: 'draft' as const,
      })
      .returning());

    return NextResponse.json({ asset });
  } catch (error) {
    console.error('Error creating asset:', error);
    captureException(error, { route: '/api/marketplace/seller/assets', method: 'POST' });
    return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 });
  }
}
