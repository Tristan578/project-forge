import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { sellerProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';
import { z } from 'zod';

const sellerProfileSchema = z.object({
  displayName: z.string().min(2).max(100),
  bio: z.string().max(1000).optional(),
  portfolioUrl: z.string().max(500).optional(),
});

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
      validate: sellerProfileSchema,
    });
    if (mid.error) return mid.error;
    const { user } = mid.authContext!;
    const { displayName, bio, portfolioUrl } = mid.body as z.infer<typeof sellerProfileSchema>;

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
          displayName,
          bio: bio ?? null,
          portfolioUrl: portfolioUrl ?? null,
        })
        .where(eq(sellerProfiles.userId, user.id)));
    } else {
      // Create
      await queryWithResilience(() => getDb().insert(sellerProfiles).values({
        userId: user.id,
        displayName,
        bio: bio ?? null,
        portfolioUrl: portfolioUrl ?? null,
      }));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving seller profile:', error);
    captureException(error, { route: '/api/marketplace/seller', method: 'POST' });
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
