import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const VALID_TIERS = ['starter', 'hobbyist', 'creator', 'pro'] as const;
type Tier = (typeof VALID_TIERS)[number];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const { id } = await params;
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id));

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const updates: Partial<{ tier: Tier; banned: number }> = {};

  const record = body as Record<string, unknown>;

  if ('tier' in record) {
    const tier = record['tier'];
    if (typeof tier !== 'string' || !VALID_TIERS.includes(tier as Tier)) {
      return NextResponse.json(
        { error: `tier must be one of: ${VALID_TIERS.join(', ')}` },
        { status: 400 }
      );
    }
    updates.tier = tier as Tier;
  }

  if ('banned' in record) {
    const banned = record['banned'];
    if (typeof banned !== 'boolean') {
      return NextResponse.json({ error: 'banned must be a boolean' }, { status: 400 });
    }
    updates.banned = banned ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const db = getDb();
  const [updated] = await db
    .update(users)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user: updated });
}
