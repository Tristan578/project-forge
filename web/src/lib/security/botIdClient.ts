import { initBotId } from 'botid/client/core';

/**
 * Vercel BotID client registration (PF-975 / #8948) — attaches an invisible
 * proof-of-work header to matching fetch/XHR calls made from the browser.
 * Dormant by design: without the Vercel dashboard toggle for this project,
 * the server-side checkBotId() call (createGenerationHandler.ts,
 * billing/checkout/route.ts) always resolves isBot: false and every route
 * behaves exactly as before. No env var needed — safe to call unconditionally
 * in every environment.
 *
 * Kept in its own module (rather than inlined in instrumentation-client.ts)
 * because the wildcard path pattern below pairs a slash with an asterisk,
 * which a naive text-based comment stripper (see sentry-regressions.test.ts's
 * `stripComments()`) misreads as a block-comment opener, silently deleting
 * everything up to the next block-comment close in whatever file it lives in.
 */
export function registerBotIdProtection(): void {
  initBotId({
    protect: [
      { path: '/api/generate/*', method: 'POST' },
      { path: '/api/billing/checkout', method: 'POST' },
    ],
  });
}
