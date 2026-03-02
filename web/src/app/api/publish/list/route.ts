import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { user, clerkId } = authResult.ctx;

  const db = getDb();

  const publications = await db.select()
    .from(publishedGames)
    .where(eq(publishedGames.userId, user.id))
    .orderBy(desc(publishedGames.updatedAt));

  return NextResponse.json({
    publications: publications.map(p => ({
      ...p,
      url: p.cdnUrl || `/play/${clerkId}/${p.slug}`,
    })),
  });
}
