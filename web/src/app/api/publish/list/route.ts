import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return NextResponse.json({ publications: [] });

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
