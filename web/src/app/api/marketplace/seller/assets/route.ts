import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { marketplaceAssets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseJsonBody, requireString, requireOneOf } from '@/lib/apiValidation';

const VALID_CATEGORIES = ['model_3d', 'sprite', 'texture', 'audio', 'script', 'prefab', 'template', 'shader', 'animation'] as const;
const VALID_LICENSES = ['standard', 'extended'] as const;

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

    const parsed = await parseJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const nameResult = requireString(parsed.body.name, 'Name', { maxLength: 200 });
    if (!nameResult.ok) return nameResult.response;

    const descResult = requireString(parsed.body.description, 'Description', { maxLength: 5000 });
    if (!descResult.ok) return descResult.response;

    const catResult = requireOneOf(parsed.body.category, 'Category', VALID_CATEGORIES);
    if (!catResult.ok) return catResult.response;

    // Optional fields
    const licenseResult = parsed.body.license !== undefined
      ? requireOneOf(parsed.body.license, 'License', VALID_LICENSES)
      : { ok: true as const, value: 'standard' as const };
    if (!licenseResult.ok) return licenseResult.response;

    const priceTokens = parsed.body.priceTokens;
    if (priceTokens !== undefined && priceTokens !== 0) {
      if (typeof priceTokens !== 'number' || !Number.isInteger(priceTokens) || priceTokens < 0) {
        return NextResponse.json({ error: 'priceTokens must be a non-negative integer' }, { status: 400 });
      }
    }

    const tags: string[] = Array.isArray(parsed.body.tags)
      ? (parsed.body.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 20)
      : [];

    const [asset] = await db
      .insert(marketplaceAssets)
      .values({
        sellerId: user.id,
        name: nameResult.value,
        description: descResult.value,
        category: catResult.value,
        priceTokens: (priceTokens as number) || 0,
        license: licenseResult.value,
        tags,
        status: 'draft' as const,
      })
      .returning();

    return NextResponse.json({ asset });
  } catch (error) {
    console.error('Error creating asset:', error);
    return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 });
  }
}
