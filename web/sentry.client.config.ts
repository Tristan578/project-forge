import * as Sentry from '@sentry/nextjs';
import { configureSentryFingerprinting } from '@/lib/monitoring/sentryConfig';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const IS_PROD = process.env.NODE_ENV === 'production';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local',
    tracesSampleRate: IS_PROD ? 0.1 : 1.0,

    // Tunnel to bypass ad-blockers
    tunnel: '/api/sentry',

    integrations: [
      Sentry.browserTracingIntegration(),
      // maskAllText: true prevents BYOK API keys and other sensitive input
      // values from being visible in Sentry session replays (#8001).
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: false }),
    ],

    // Replay sampling
    replaysSessionSampleRate: IS_PROD ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });

  // Apply consistent fingerprinting rules so similar AI module errors are
  // grouped into single Sentry issues rather than creating hundreds of separate
  // noise issues.
  configureSentryFingerprinting();
}
