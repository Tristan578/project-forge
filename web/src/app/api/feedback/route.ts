import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { feedback, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

const VALID_TYPES = ['bug', 'feature', 'general'] as const;

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 10 submissions per minute per user
  const rl = rateLimit(`feedback:${clerkId}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, description, metadata } = body;

  // Validate type
  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: 'Type must be one of: bug, feature, general' },
      { status: 400 }
    );
  }

  // Validate description
  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    return NextResponse.json(
      { error: 'Description must be at least 10 characters' },
      { status: 400 }
    );
  }

  if (description.length > 5000) {
    return NextResponse.json(
      { error: 'Description must be under 5000 characters' },
      { status: 400 }
    );
  }

  try {
    const db = getDb();

    // Look up database user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    const [record] = await db
      .insert(feedback)
      .values({
        userId: user?.id ?? null,
        type,
        description: description.trim(),
        metadata: metadata ?? null,
      })
      .returning({ id: feedback.id });

    return NextResponse.json({ success: true, id: record.id });
  } catch (err) {
    console.error('Feedback submission error:', err);
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
