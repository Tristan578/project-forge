import * as Sentry from '@sentry/nextjs';
import { configureSentryFingerprinting, scrubSentryEvent } from '@/lib/monitoring/sentryConfig';

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local',

    // Dynamic sampling: 100% for AI traces, lower for other routes
    tracesSampler: ({ name }) => {
      if (name?.includes('/api/generate/') || name?.includes('/api/chat')) return 1.0;
      if (name?.includes('/api/')) return IS_PROD ? 0.2 : 1.0;
      return IS_PROD ? 0.1 : 1.0;
    },

    // SECURITY (audit 2026-05-30, F03/F04): no default PII; scrub residual
    // secrets/PII from every event before transmission. Migrated off the
    // deprecated `sendDefaultPii: false` to the `dataCollection` framework — the
    // object MUST stay exhaustive (any partial object re-enables PII via Sentry's
    // permissive defaults). Every field is opted out (see sentry.server.config.ts
    // for the full rationale).
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
  });

  configureSentryFingerprinting();
}
