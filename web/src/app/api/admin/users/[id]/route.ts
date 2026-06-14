import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import type { Tier } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { applyAdminTierChange } from '@/lib/billing/admin-tier-grant';

const patchUserSchema = z
  .object({
    tier: z.enum(['starter', 'hobbyist', 'creator', 'pro']).optional(),
    banned: z.boolean().optional(),
  })
  .refine((v) => v.tier !== undefined || v.banned !== undefined, {
    message: 'No valid fields to update',
  });

// `users.id` is a Postgres `uuid` column. A non-UUID `[id]` path segment would be
// forwarded into the `eq(users.id, id)` query and raise an "invalid input syntax
// for type uuid" cast error — caught by the generic 500 handler and surfaced to
// Sentry as avoidable noise. Reject malformed ids early with a 404 (not 400, so
// we don't confirm the expected id format to an enumerator).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

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
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // An admin must not modify their OWN account through the user-admin endpoint:
  // self-targeting here is a privilege-escalation vector (an admin could comp
  // themselves a higher tier + full token allocation, or self-unban). Tier and
  // ban state for one's own account go through billing/Stripe, never this route.
  // `mid.userId` is the acting admin's `users.id`; `id` is the target's — both
  // live in the same id space, so an exact match means self-targeting.
  if (id === mid.userId) {
    return NextResponse.json(
      { error: 'Admins cannot modify their own account here', code: 'SELF_MODIFICATION_FORBIDDEN' },
      { status: 403 }
    );
  }

  const body = mid.body as z.infer<typeof patchUserSchema>;

  try {
    // Load the current row first: it backs the 404, supplies the previous tier
    // for the audit trail, and decides whether the tier actually changed.
    const [current] = await queryWithResilience(() =>
      getDb().select().from(users).where(eq(users.id, id))
    );

    if (!current) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const previousTier = current.tier as Tier;
    const tierChanged = body.tier !== undefined && body.tier !== previousTier;

    if (tierChanged) {
      // A real tier change must ALSO grant the new tier's monthly token
      // allotment + write a credit_transactions audit row, atomically — else a
      // comped paid user holds 0 tokens and is blocked at every /api/generate/*
      // route, so the 5-10 min core journey never starts (#8744). Any `banned`
      // change is folded into the same transaction.
      await applyAdminTierChange(id, body.tier as Tier, {
        previousTier,
        grantedByClerkId: clerkId,
        banned: body.banned,
      });

      // Re-read so the admin UI sees the granted balance + new tier/ban state.
      const [granted] = await queryWithResilience(() =>
        getDb().select().from(users).where(eq(users.id, id))
      );
      // The grant committed but the row is gone on re-read (concurrent hard
      // delete, or a partition between statements) — signal an error rather than
      // returning { user: undefined } with a 200, matching every other read path.
      if (!granted) {
        return NextResponse.json(
          { error: 'Grant succeeded but user row not found on re-read' },
          { status: 500 }
        );
      }
      return NextResponse.json({ user: granted });
    }

    // Banned-only edit (or tier set to its current value): a plain update with
    // NO token grant. Re-granting on a no-op tier change would zero accrued
    // spend, so the grant path is reserved for genuine tier changes.
    const updates: Partial<{ tier: Tier; banned: number }> = {};
    if (body.tier !== undefined) updates.tier = body.tier;
    if (body.banned !== undefined) updates.banned = body.banned ? 1 : 0;

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
