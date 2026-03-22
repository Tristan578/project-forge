import { NextRequest, NextResponse } from 'next/server';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/client';
import { feedback } from '@/lib/db/schema';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { parseJsonBody, requireString, requireOneOf } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

const VALID_TYPES = ['bug', 'feature', 'general'] as const;

export async function POST(req: NextRequest) {
  const session = await authenticateClerkSession();
  if (!session.ok) return session.response;
  const clerkId = session.clerkId;

  const user = await getUserByClerkId(clerkId);

  // Rate limit: 10 submissions per minute per user (distributed)
  const rl = await distributedRateLimit(`feedback:${clerkId}`, 10, 60);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const parsed = await parseJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const typeResult = requireOneOf(parsed.body.type, 'Type', VALID_TYPES);
  if (!typeResult.ok) return typeResult.response;

  const descResult = requireString(parsed.body.description, 'Description', { minLength: 10, maxLength: 5000 });
  if (!descResult.ok) return descResult.response;

  try {
    const db = getDb();

    const [record] = await db
      .insert(feedback)
      .values({
        userId: user?.id ?? null,
        type: typeResult.value,
        description: descResult.value,
        metadata: parsed.body.metadata ?? null,
      })
      .returning({ id: feedback.id });

    return NextResponse.json({ success: true, id: record.id });
  } catch (err) {
    captureException(err, { route: '/api/feedback' });
    console.error('Feedback submission error:', err);
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
