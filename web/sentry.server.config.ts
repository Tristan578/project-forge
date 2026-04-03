import * as Sentry from '@sentry/nextjs';
import { configureSentryFingerprinting } from '@/lib/monitoring/sentryConfig';

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local',
    tracesSampleRate: IS_PROD ? 0.1 : 1.0,

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
      // Enabled on Vercel production + preview only. Excludes 'development'
      // (local vercel dev) and non-Vercel local dev (no VERCEL_ENV).
      ...(process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview'
        ? [Sentry.nodeRuntimeMetricsIntegration()]
        : []),
    ],
  });

  configureSentryFingerprinting();
}
