import * as Sentry from '@sentry/nextjs';
import {
  configureSentryFingerprinting,
  scrubSentryEvent,
  scrubSentryLog,
  scrubSentryMetric,
  setSentryDeepRedactor,
} from '@/lib/monitoring/sentryConfig';
import { redactSecrets } from '@/lib/security/redactSecrets';

// Install the DEEP redactor for this runtime, before any Sentry pipeline can
// run. `sentryConfig` defaults to a shape-only pass, because it is also in the
// browser bundle and `redactSecrets` — environment enumeration, tree traversal,
// index-mapped decoders — has nothing to do there and pushed total client JS
// past its hard limit. Server-side that exact-value match is the half the shape
// list cannot have, so it is installed here rather than imported there.
// `sentry-regressions.test.ts` pins this call: without it the shallow default
// stays, every event still scrubs, and nothing fails.
setSentryDeepRedactor((input: string) => redactSecrets(input) as string);

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
    // Sentry Logs bypass beforeSend/scrubSentryEvent — scrub them on their own
    // pipeline so a stray Sentry.logger.* call can't leak secrets/PII (see
    // sentry.server.config.ts for the full rationale).
    beforeSendLog: scrubSentryLog,
    // Metrics are a THIRD pipeline, and `enableMetrics` defaults to ON — the SDK
    // stamps user.id/email/name onto every metric, so this hook is what keeps
    // them inside the F03/F04 posture (see sentry.server.config.ts for the full
    // rationale).
    beforeSendMetric: scrubSentryMetric,
  });

  configureSentryFingerprinting();
}
