import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { syncUserFromClerk } from '@/lib/auth/user-service';
import {
  enqueueRetry,
  isTransientError,
  processRetryQueue,
} from '@/lib/auth/webhookRetry';

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
    // user.deleted could be handled to soft-delete
  }
}

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Process any pending retries opportunistically
  processRetryQueue(handleWebhookEvent).catch(() => {
    // Fire-and-forget — failures are re-enqueued internally
  });

  const headerPayload = await headers();
  const svixId = headerPayload.get('svix-id');
  const svixTimestamp = headerPayload.get('svix-timestamp');
  const svixSignature = headerPayload.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let event: { type: string; data: Record<string, unknown> };

  try {
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as { type: string; data: Record<string, unknown> };
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
    // Permanent error — log and return error status
    console.error('[Webhook] Permanent error processing event:', event.type, error);
    return NextResponse.json({ error: 'Failed to process event' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
