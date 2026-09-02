/**
 * POST /api/auth/webhook — Clerk webhook handler.
 *
 * Processes user.created, user.updated, and user.deleted events.
 * On user.created/updated, upserts the user row in the database.
 * On user.deleted, removes user data and cancels any active subscriptions.
 *
 * Signature verification is Clerk's own `verifyWebhook()` (#9629): it reads
 * the `svix-*` headers and the raw body itself, verifies through
 * `standardwebhooks` (already a transitive of @clerk/backend), and returns a
 * typed, discriminated `WebhookEvent`. The hand-rolled header extraction and
 * `svix` dependency it replaces shipped svix 2.0.0 — deprecated on npm for an
 * incorrect `verify()` signature — and 2.2.0 changed `verify()` to return
 * `undefined`, so any future bump would have been a type error.
 */

import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { NextResponse, type NextRequest } from 'next/server';
import { syncUserFromClerk, getUserByClerkId, deleteUserAccount } from '@/lib/auth/user-service';
import {
  enqueueRetry,
  isTransientError,
  processRetryQueue,
} from '@/lib/auth/webhookRetry';
import { captureException } from '@/lib/monitoring/sentry-server';

/** Process a verified webhook event. Extracted so it can be used by the retry queue. */
async function handleWebhookEvent(
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  switch (eventType) {
    case 'user.created':
    case 'user.updated': {
      await syncUserFromClerk(data as Parameters<typeof syncUserFromClerk>[0]);
      break;
    }
    case 'user.deleted': {
      const clerkId = data.id;
      if (typeof clerkId !== 'string' || !clerkId) {
        throw new Error('user.deleted event missing id field');
      }
      const user = await getUserByClerkId(clerkId);
      if (!user) {
        // User never synced to our DB — nothing to delete
        break;
      }
      try {
        await deleteUserAccount(user.id);
      } catch (err) {
        captureException(err, { context: 'user.deleted webhook', clerkId });
        throw err;
      }
      break;
    }
  }
}

export async function POST(req: NextRequest) {
  // Passed explicitly: verifyWebhook's own env fallback is
  // CLERK_WEBHOOK_SIGNING_SECRET, while this deployment's variable is
  // CLERK_WEBHOOK_SECRET (web/.env.example). Relying on the fallback would
  // verify nothing and 400 every delivery.
  const signingSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Process any pending retries opportunistically
  processRetryQueue(handleWebhookEvent).catch(() => {
    // Fire-and-forget — failures are re-enqueued internally
  });

  let event: { type: string; data: Record<string, unknown> };
  try {
    // Missing svix-* headers, a bad signature and a stale timestamp all
    // reject here; none of them is distinguishable to a caller and none
    // should be, so one 400 covers them.
    const verified = await verifyWebhook(req, { signingSecret });
    event = { type: verified.type, data: verified.data as unknown as Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    await handleWebhookEvent(event.type, event.data);
  } catch (error) {
    if (isTransientError(error)) {
      enqueueRetry(event.type, event.data, error);
      // Return 200 so Clerk doesn't retry its own delivery (we handle retries internally)
      return NextResponse.json({ received: true, queued: true });
    }
    // Permanent error — log, capture in Sentry, and return error status
    console.error('[Webhook] Permanent error processing event:', event.type, error);
    captureException(error, { context: 'clerk webhook permanent error', eventType: event.type });
    return NextResponse.json({ error: 'Failed to process event' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
