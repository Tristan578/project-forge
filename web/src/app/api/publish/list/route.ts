import { NextResponse } from 'next/server';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

export async function GET() {
  const session = await authenticateClerkSession();
  if (!session.ok) return session.response;
  const clerkId = session.clerkId;

  const rl = await rateLimit(`user:publish-list:${clerkId}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ publications: [] });

  const publications = await queryWithResilience(() => getDb().select()
    .from(publishedGames)
    .where(eq(publishedGames.userId, user.id))
    .orderBy(desc(publishedGames.updatedAt)));

  return NextResponse.json({
    publications: publications.map(p => ({
      ...p,
      url: p.cdnUrl || `/play/${clerkId}/${p.slug}`,
    })),
  });
}
