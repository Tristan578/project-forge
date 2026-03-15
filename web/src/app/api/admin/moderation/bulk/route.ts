import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameComments } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/moderation/bulk
 * Perform a bulk moderation action on multiple comments in a single transaction.
 * Body: { action: 'approve' | 'delete', commentIds: string[] }
 * Returns: { processed: number, errors: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const adminError = assertAdmin(authResult.ctx.clerkId);
    if (adminError) return adminError;

    const body = await req.json() as unknown;

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { action, commentIds } = body as Record<string, unknown>;

    if (action !== 'approve' && action !== 'delete') {
      return NextResponse.json(
        { error: 'Action must be "approve" or "delete"' },
        { status: 400 }
      );
    }

    if (!Array.isArray(commentIds) || commentIds.length === 0) {
      return NextResponse.json(
        { error: 'commentIds must be a non-empty array' },
        { status: 400 }
      );
    }

    // Validate all IDs are strings
    const invalidIds = (commentIds as unknown[]).filter((id) => typeof id !== 'string');
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: 'All commentIds must be strings' },
        { status: 400 }
      );
    }

    const ids = commentIds as string[];
    const errors: string[] = [];
    let processed = 0;

    const db = getDb();

    // Process all comments in a single database operation
    try {
      if (action === 'approve') {
        await db
          .update(gameComments)
          .set({ flagged: 0 })
          .where(inArray(gameComments.id, ids));
      } else {
        await db
          .delete(gameComments)
          .where(inArray(gameComments.id, ids));
      }
      processed = ids.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Bulk operation failed: ${message}`);
    }

    return NextResponse.json({ processed, errors });
  } catch (error) {
    console.error('Failed to perform bulk moderation:', error);
    return NextResponse.json(
      { error: 'Failed to perform bulk moderation' },
      { status: 500 }
    );
  }
}
