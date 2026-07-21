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
      // The `error` string is surfaced verbatim to users (generation dialogs
      // toast it via useAIGeneration onError), so it must be actionable, and
      // `code` gives support a stable identifier to search for.
      return NextResponse.json(
        {
          error:
            'We could not verify this request came from your browser. Please refresh the page and try again — if this keeps happening, contact support and mention code BOT_CHECK.',
          code: 'BOT_CHECK',
        },
        { status: 403 },
      );
    }
    return null;
  } catch (err) {
    captureException(err, { route: 'checkBotIdGate' });
    return null;
  }
}
