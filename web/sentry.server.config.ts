import * as Sentry from '@sentry/nextjs';
import { configureSentryFingerprinting, scrubSentryEvent } from '@/lib/monitoring/sentryConfig';

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local',

    // Dynamic sampling: 100% for AI traces, lower for other API routes
    tracesSampler: ({ name }) => {
      if (name?.includes('/api/generate/') || name?.includes('/api/chat')) return 1.0;
      if (name?.includes('/api/')) return IS_PROD ? 0.2 : 1.0;
      return IS_PROD ? 0.1 : 1.0;
    },

    // SECURITY (audit 2026-05-30, F03/F04): do NOT capture stack-frame locals
    // (they can hold decrypted BYOK provider keys and prompts) and do NOT send
    // default PII (IPs, cookies, headers, user data). scrubSentryEvent provides
    // defence-in-depth, redacting any residual secrets/PII before transmission.
    //
    // Migrated off the deprecated `sendDefaultPii: false` (removed in @sentry v11)
    // to the `dataCollection` framework. This object MUST stay exhaustive: as soon
    // as ANY `dataCollection` key is present, every OMITTED field falls back to
    // Sentry's permissive DEFAULTS (cookies/queryParams/headers/genAI all on), so a
    // partial object would silently re-enable PII. Every field below is opted out —
    // equivalent-or-stricter than the legacy false path, notably
    // `stackFrameVariables: false`, which the legacy path resolved to `true`.
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

    integrations: [
      // Captures AI token usage, model IDs, latency, and errors for every
      // Anthropic SDK call made from server-side route handlers. Input/output
      // recording is disabled in production to avoid capturing PII.
      Sentry.anthropicAIIntegration({
        recordInputs: !IS_PROD,
        recordOutputs: !IS_PROD,
      }),
      // Captures AI SDK (Vercel AI) spans: model name, token usage, latency,
      // and tool call traces for every streamText/generateText call.
      // Requires experimental_telemetry: { isEnabled: true } on each call.
      Sentry.vercelAIIntegration(),
      // Auto-collects runtime health metrics: RSS, heap, CPU, event loop.
      // Enabled on Vercel production + preview only.
      ...(process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview'
        ? [Sentry.nodeRuntimeMetricsIntegration()]
        : []),
    ],
  });

  configureSentryFingerprinting();
}
