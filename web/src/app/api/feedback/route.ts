import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateClerkSession } from '@/lib/auth/api-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { feedback } from '@/lib/db/schema';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { captureException } from '@/lib/monitoring/sentry-server';

const feedbackSchema = z.object({
  type: z.enum(['bug', 'feature', 'general']),
  description: z.string().trim().min(10).max(5000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const session = await authenticateClerkSession();
  if (!session.ok) return session.response;
  const clerkId = session.clerkId;

  const user = await getUserByClerkId(clerkId);

  // Rate limit: 10 submissions per minute per user (distributed)
  const rl = await distributedRateLimit(`feedback:${clerkId}`, 10, 60);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  let body: z.infer<typeof feedbackSchema>;
  try {
    const raw = await req.json();
    const result = feedbackSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', issues: result.error.issues },
        { status: 422 }
      );
    }
    body = result.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const [record] = await queryWithResilience(() =>
      getDb()
        .insert(feedback)
        .values({
          userId: user?.id ?? null,
          type: body.type,
          description: body.description,
          metadata: body.metadata ?? null,
        })
        .returning({ id: feedback.id })
    );

    return NextResponse.json({ success: true, id: record.id });
  } catch (err) {
    console.error('Feedback submission error:', err);
    captureException(err, { route: '/api/feedback' });
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
