import 'server-only';
import { NextResponse } from 'next/server';
import { checkBotId } from 'botid/server';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Vercel BotID gate (PF-975 / #8948) — shared by every /api/generate/* route
 * (via createGenerationHandler) and /api/billing/checkout. Call BEFORE any
 * rate-limit consumption or token deduction so a blocked bot never spends
 * either budget.
 *
 * checkLevel is pinned to 'basic': this batch is code-only. Enabling Deep
 * Analysis is a separate Vercel Dashboard step (Firewall tab) — pinning here
 * keeps that toggle from silently changing this gate's behavior.
 *
 * FAIL OPEN: any error from checkBotId() (BotID outage, missing dashboard
 * config, network hiccup) resolves to `null` (pass-through) rather than
 * blocking the request — bot detection must never become a new single point
 * of failure for generation or checkout.
 */
export async function checkBotIdGate(): Promise<NextResponse | null> {
  try {
    const verdict = await checkBotId({ advancedOptions: { checkLevel: 'basic' } });
    if (verdict.isBot) {
      return NextResponse.json({ error: 'Request blocked' }, { status: 403 });
    }
    return null;
  } catch (err) {
    captureException(err, { route: 'checkBotIdGate' });
    return null;
  }
}
