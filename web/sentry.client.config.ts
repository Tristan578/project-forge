import * as Sentry from '@sentry/nextjs';

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
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],

    // Replay sampling
    replaysSessionSampleRate: IS_PROD ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
  });
}
