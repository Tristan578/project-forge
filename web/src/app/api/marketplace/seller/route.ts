import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { sellerProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

    const db = getDb();

    const [profile] = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, user.id))
      .limit(1);

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
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
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
    const { displayName, bio, portfolioUrl } = body;

    if (!displayName || displayName.length < 2) {
      return NextResponse.json({ error: 'Display name required' }, { status: 400 });
    }

    // Check if profile exists
    const [existing] = await db
      .select()
      .from(sellerProfiles)
      .where(eq(sellerProfiles.userId, user.id))
      .limit(1);

    if (existing) {
      // Update
      await db
        .update(sellerProfiles)
        .set({
          displayName,
          bio: bio || null,
          portfolioUrl: portfolioUrl || null,
        })
        .where(eq(sellerProfiles.userId, user.id));
    } else {
      // Create
      await db.insert(sellerProfiles).values({
        userId: user.id,
        displayName,
        bio: bio || null,
        portfolioUrl: portfolioUrl || null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving seller profile:', error);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
