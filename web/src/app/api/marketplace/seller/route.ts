import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { users, sellerProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const db = getDb();
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

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
    const db = getDb();
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
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
