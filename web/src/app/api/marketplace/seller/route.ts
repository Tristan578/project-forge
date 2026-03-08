import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { sellerProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseJsonBody, requireString, optionalString } from '@/lib/apiValidation';

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

    const parsed = await parseJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const nameResult = requireString(parsed.body.displayName, 'Display name', { minLength: 2, maxLength: 100 });
    if (!nameResult.ok) return nameResult.response;

    const bioResult = optionalString(parsed.body.bio, 'Bio', { maxLength: 1000 });
    if (!bioResult.ok) return bioResult.response;

    const urlResult = optionalString(parsed.body.portfolioUrl, 'Portfolio URL', { maxLength: 500 });
    if (!urlResult.ok) return urlResult.response;

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
          displayName: nameResult.value,
          bio: bioResult.value ?? null,
          portfolioUrl: urlResult.value ?? null,
        })
        .where(eq(sellerProfiles.userId, user.id));
    } else {
      // Create
      await db.insert(sellerProfiles).values({
        userId: user.id,
        displayName: nameResult.value,
        bio: bioResult.value ?? null,
        portfolioUrl: urlResult.value ?? null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving seller profile:', error);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
