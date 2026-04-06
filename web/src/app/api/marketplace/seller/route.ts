import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { sellerProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseJsonBody, requireString, optionalString } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:seller-profile-get:${id}`, max: 30, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    const [profile] = await queryWithResilience(() => getDb()
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, user.id))
      .limit(1));

    if (!profile) {
      return NextResponse.json({ profile: null });
    }

    return NextResponse.json({
      profile: {
        displayName: profile.displayName,
        bio: profile.bio,
        portfolioUrl: profile.portfolioUrl,
        totalEarnings: profile.totalEarnings,
        totalSales: profile.totalSales,
        approved: profile.approved === 1,
      },
    });
  } catch (error) {
    console.error('Error fetching seller profile:', error);
    captureException(error, { route: '/api/marketplace/seller', method: 'GET' });
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:seller-profile-post:${id}`, max: 10, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;

    const parsed = await parseJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const nameResult = requireString(parsed.body.displayName, 'Display name', { minLength: 2, maxLength: 100 });
    if (!nameResult.ok) return nameResult.response;

    const bioResult = optionalString(parsed.body.bio, 'Bio', { maxLength: 1000 });
    if (!bioResult.ok) return bioResult.response;

    const urlResult = optionalString(parsed.body.portfolioUrl, 'Portfolio URL', { maxLength: 500 });
    if (!urlResult.ok) return urlResult.response;

    // Check if profile exists
    const [existing] = await queryWithResilience(() => getDb()
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, user.id))
      .limit(1));

    if (existing) {
      // Update
      await queryWithResilience(() => getDb()
        .update(sellerProfiles)
        .set({
          displayName: nameResult.value,
          bio: bioResult.value ?? null,
          portfolioUrl: urlResult.value ?? null,
        })
        .where(eq(sellerProfiles.userId, user.id)));
    } else {
      // Create
      await queryWithResilience(() => getDb().insert(sellerProfiles).values({
        userId: user.id,
        displayName: nameResult.value,
        bio: bioResult.value ?? null,
        portfolioUrl: urlResult.value ?? null,
      }));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving seller profile:', error);
    captureException(error, { route: '/api/marketplace/seller', method: 'POST' });
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
