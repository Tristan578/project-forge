import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

    const db = getDb();

    const assets = await db
      .select()
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.sellerId, user.id));

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
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

    const db = getDb();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { name, description, category, priceTokens, license, tags } = body;

    if (!name || !description || !category) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const [asset] = await db
      .insert(marketplaceAssets)
      .values({
        sellerId: user.id,
        name,
        description,
        category,
        priceTokens: priceTokens || 0,
        license: license || 'standard',
        tags: tags || [],
        status: 'draft',
      })
      .returning();

    return NextResponse.json({ asset });
  } catch (error) {
    console.error('Error creating asset:', error);
    return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 });
  }
}
