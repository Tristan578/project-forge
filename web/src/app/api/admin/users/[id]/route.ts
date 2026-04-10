import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

const patchUserSchema = z
  .object({
    tier: z.enum(['starter', 'hobbyist', 'creator', 'pro']).optional(),
    banned: z.boolean().optional(),
  })
  .refine((v) => v.tier !== undefined || v.banned !== undefined, {
    message: 'No valid fields to update',
  });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const limited = await rateLimitAdminRoute(mid.userId!, 'admin-users-get');
  if (limited) return limited;

  const { id } = await params;

  try {
    const [user] = await queryWithResilience(() =>
      getDb().select().from(users).where(eq(users.id, id))
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    captureException(error, { route: '/api/admin/users/[id]', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const mid = await withApiMiddleware(req, { requireAuth: true, validate: patchUserSchema });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const limited = await rateLimitAdminRoute(mid.userId!, 'admin-users-patch');
  if (limited) return limited;

  const { id } = await params;
  const body = mid.body as z.infer<typeof patchUserSchema>;

  const updates: Partial<{ tier: 'starter' | 'hobbyist' | 'creator' | 'pro'; banned: number }> = {};
  if (body.tier !== undefined) updates.tier = body.tier;
  if (body.banned !== undefined) updates.banned = body.banned ? 1 : 0;

  try {
    const [updated] = await queryWithResilience(() =>
      getDb()
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning()
    );

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user: updated });
  } catch (error) {
    captureException(error, { route: '/api/admin/users/[id]', method: 'PATCH' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
