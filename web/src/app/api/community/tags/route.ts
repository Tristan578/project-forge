import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameTags } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    // Get top 20 tags by frequency
    const tags = await db
      .select({
        tag: gameTags.tag,
        count: sql<number>`COUNT(*)`,
      })
      .from(gameTags)
      .groupBy(gameTags.tag)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(20);

    return NextResponse.json({
      tags: tags.map((t: { tag: string; count: number }) => ({
        tag: t.tag,
        count: Number(t.count),
      })),
    });
  } catch (error) {
    console.error('Failed to fetch tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}
