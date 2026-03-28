import { NextRequest, NextResponse } from 'next/server';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET(request: NextRequest) {
  const session = await authenticateClerkSession();
  if (!session.ok) return session.response;

  const rl = await rateLimit(`user:publish-check-slug:${session.clerkId}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const slug = request.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const user = await getUserByClerkId(session.clerkId);
  if (!user) return NextResponse.json({ available: true });

  const db = getDb();

  const existing = await db.select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.slug, slug)))
    .limit(1);

  return NextResponse.json({ available: existing.length === 0 });
}
