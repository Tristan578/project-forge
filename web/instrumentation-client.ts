import * as Sentry from '@sentry/nextjs';
import { registerBotIdProtection } from '@/lib/security/botIdClient';
import { configureSentryFingerprinting, scrubSentryEvent, scrubSentryLog } from '@/lib/monitoring/sentryConfig';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

// Vercel BotID (PF-975 / #8948) — see botIdClient.ts for the dormancy note and
// why registration lives in its own module: its wildcard path pattern pairs a
// slash with an asterisk, which trips a naive comment-stripping regex in
// sentry-regressions.test.ts.
registerBotIdProtection();

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local',

    // Dynamic sampling: keep AI-related traces at higher rate
    tracesSampler: ({ name }) => {
      if (name?.includes('/api/generate/') || name?.includes('/api/chat')) return 1.0;
      if (name?.includes('/api/')) return IS_PROD ? 0.2 : 1.0;
      return IS_PROD ? 0.1 : 1.0;
    },

    // Tunnel handled by tunnelRoute in next.config.ts (bypasses ad-blockers)

    // SECURITY (audit 2026-05-30, F03/F04): no default PII; scrub residual
    // secrets/PII from every event before transmission. Session-replay text is
    // already masked (maskAllText, #8001). Migrated off the deprecated
    // `sendDefaultPii: false` to the exhaustive `dataCollection` opt-out (any
    // partial object re-enables PII via Sentry's permissive defaults; see
    // sentry.server.config.ts for the full rationale).
    dataCollection: {
      userInfo: false,
      cookies: false,
      queryParams: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    enableLogs: true,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
    // Sentry Logs bypass beforeSend/scrubSentryEvent — scrub them on their own
    // pipeline so a stray Sentry.logger.* call can't leak secrets/PII (see
    // sentry.server.config.ts for the full rationale).
    beforeSendLog: scrubSentryLog,

    integrations: [
      Sentry.browserTracingIntegration(),
      // maskAllText: true prevents BYOK API keys and other sensitive input
      // values from being visible in Sentry session replays (#8001).
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false }),
      // User feedback widget (PF-967 / #8956) — floating "Report a Bug" button
      // that lets users attach a screenshot + description to a Sentry report.
      // colorScheme: 'system' follows the OS theme rather than forcing light/dark.
      // `id` is pinned so the #sentry-feedback rules in globals.css (z-index +
      // mobile inset, keeping the trigger clear of MobileToolbar/CookieConsent)
      // keep targeting the widget host element.
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        id: 'sentry-feedback',
        showBranding: false,
      }),
    ],

    // Replay sampling
    replaysSessionSampleRate: IS_PROD ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });

  configureSentryFingerprinting();
}

/**
 * Captures App Router navigation spans so client-side navigations appear
 * in Sentry traces. Without this, all SPA navigations are invisible.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#react-router-instrumentation
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
