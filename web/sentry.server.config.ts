import * as Sentry from '@sentry/nextjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import {
  configureSentryFingerprinting,
  scrubSentryEvent,
  scrubSentryLog,
  scrubSentryMetric,
} from '@/lib/monitoring/sentryConfig';

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

    // PROFILING (PF-1053) — CPU profiles for the Node runtime, captured by
    // `nodeProfilingIntegration` below.
    //
    // `profileLifecycle: 'trace'` ties profiling to the sampling decisions the
    // `tracesSampler` above already makes: the profiler runs only while a
    // sampled transaction is in flight, so profile volume tracks trace volume
    // instead of becoming an independent cost axis. `profileSessionSampleRate`
    // then decides what fraction of *processes* are eligible to profile at all;
    // it is evaluated ONCE at `Sentry.init()`, not per transaction.
    //
    // This rate MUST be non-zero: it defaults to 0, which silently disables
    // profiling entirely while every other setting still looks correct. That
    // silent-zero default is pinned by sentry-regressions.test.ts.
    profileSessionSampleRate: IS_PROD ? 0.1 : 1.0,
    profileLifecycle: 'trace',

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
    // 10.61 flipped `streamGenAiSpans` ON by default (gen_ai prompt/completion spans
    // streamed as separate untruncated v2 envelope items). Pin it OFF to preserve the
    // pre-bump behavior and keep span volume/cost flat — opting in is a deliberate
    // observability decision to make alongside the dedicated LLM-observability work,
    // not a silently-inherited upstream default.
    streamGenAiSpans: false,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryEvent,
    // `enableLogs` routes Sentry.logger.* through a SEPARATE pipeline that
    // beforeSend/beforeSendTransaction (and thus scrubSentryEvent) never touch.
    // scrubSentryLog closes that channel so a stray log call can't ship a
    // prompt/BYOK key/PII unredacted. `enableLogs` defaults to false on the
    // installed @sentry/core 10.70.0 but flips to TRUE from 10.71.0 onward
    // (client.js `?? true`), and web/package.json's `^10.70.0` range will pull
    // that in — so this pin is unconditional for every init, exactly like
    // beforeSendMetric below. Keep it wired regardless of whether this file
    // still carries an explicit `enableLogs: true` line.
    beforeSendLog: scrubSentryLog,
    // Metrics (PF-1053) are a THIRD pipeline, touched by neither beforeSend nor
    // beforeSendLog — and unlike logs they are ON BY DEFAULT (`enableMetrics`
    // defaults to true), so there is no opt-in line gating them.
    //
    // The SDK copies the active scope's user.id / user.email / user.name onto
    // EVERY metric's attributes, unconditionally, BEFORE this hook runs
    // (@sentry/core `_enrichMetricAttributes`, called from
    // `_INTERNAL_captureMetric`). `dataCollection.userInfo: false` above does
    // NOT gate that: it is read later, at envelope time, and only controls
    // server-side IP INFERENCE. So beforeSendMetric is the only place that
    // stamping can be removed.
    //
    // Today nothing populates it — there is no `Sentry.setUser()` call anywhere
    // in web/src — so the hook is defense-in-depth against the first one, which
    // would otherwise silently start shipping identity on every metric with no
    // other control in the path. Pinned by sentry-regressions.test.ts.
    beforeSendMetric: scrubSentryMetric,

    integrations: [
      // CPU profiling via the native V8 CpuProfiler addon (@sentry/profiling-node).
      // NODE RUNTIME ONLY — this must never be added to sentry.edge.config.ts:
      // the Edge runtime cannot load a native .node addon, so importing it there
      // breaks the whole Edge bundle rather than degrading gracefully.
      // The addon also has to be listed in `serverExternalPackages` (next.config.ts)
      // so Turbopack leaves it external instead of trying to bundle the binary.
      // Both constraints are pinned by sentry-regressions.test.ts.
      nodeProfilingIntegration(),
      // Captures AI token usage, model IDs, latency, and errors for every
      // Anthropic SDK call made from server-side route handlers. Input/output
      // recording is disabled in production to avoid capturing PII.
      Sentry.anthropicAIIntegration({
        recordInputs: !IS_PROD,
        recordOutputs: !IS_PROD,
        // 10.61 flipped the truncation default OFF; restore it so the dev/preview
        // spans (where recordInputs/Outputs are on) stay size-capped as before.
        enableTruncation: true,
      }),
      // Captures AI SDK (Vercel AI) spans: model name, token usage, latency,
      // and tool call traces for every streamText/generateText call.
      // Requires experimental_telemetry: { isEnabled: true } on each call.
      Sentry.vercelAIIntegration({ enableTruncation: true }),
      // Auto-collects runtime health metrics: RSS, heap, CPU, event loop.
      // Enabled on Vercel production + preview only.
      ...(process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview'
        ? [Sentry.nodeRuntimeMetricsIntegration()]
        : []),
    ],
  });

  configureSentryFingerprinting();
}
