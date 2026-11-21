import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { waitlistSignups } from '@/lib/db/schema';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * POST /api/waitlist — public waitlist lead capture (#8730).
 *
 * Backs the /sign-up waitlist form. Sign-ups stay disabled while SpawnForge
 * is in development (product decision); this route only stores an email so
 * the marketing CTAs ("Join the Waitlist" / "Request Early Access") deliver
 * what they promise.
 *
 * Anti-abuse properties:
 * - IP rate limited (awaited — rateLimitPublicRoute is async).
 * - Honeypot field ("website"): a non-empty value gets the SAME success
 *   response without inserting, so bots are not tipped off.
 * - Idempotent: the email is normalized (trim + toLowerCase) before insert
 *   and duplicates hit onConflictDoNothing on uq_waitlist_signups_email; the
 *   response is byte-identical to a fresh signup, so the endpoint is not an
 *   email-enumeration oracle.
 */

export const dynamic = 'force-dynamic';

const WAITLIST_RATE_LIMIT_MAX = 10;
const WAITLIST_RATE_LIMIT_WINDOW_MS = 60_000;

/** RFC 5321 upper bound on a full address. */
const EMAIL_MAX_LENGTH = 254;

/**
 * Strict shape check: one non-whitespace local part, an @, and a dotted
 * domain with a TLD. Deliberately simple — normalization + the unique index
 * carry correctness; this only rejects obvious garbage early.
 */
const EMAIL_REGEX = /^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** Single source for the success body so all success paths are indistinguishable. */
function successResponse(): NextResponse {
  return NextResponse.json(
    { ok: true, message: "You're on the list. We'll email you when early access opens." },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const rateLimited = await rateLimitPublicRoute(
    request,
    'waitlist',
    WAITLIST_RATE_LIMIT_MAX,
    WAITLIST_RATE_LIMIT_WINDOW_MS
  );
  if (rateLimited) return rateLimited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Allowlist: read ONLY these two fields. The body is never spread.
  const { email: rawEmail, website } = raw as { email?: unknown; website?: unknown };

  // Honeypot tripped (any non-empty value, string or not): pretend success.
  const honeypotTripped =
    typeof website === 'string' ? website.trim().length > 0 : website !== undefined && website !== null;
  if (honeypotTripped) {
    return successResponse();
  }

  if (typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }

  try {
    await queryWithResilience(() =>
      getDb()
        .insert(waitlistSignups)
        .values({ email })
        .onConflictDoNothing({ target: waitlistSignups.email })
    );
  } catch (error) {
    captureException(error, { route: '/api/waitlist', method: 'POST' });
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }

  return successResponse();
}
