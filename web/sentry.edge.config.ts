import * as Sentry from '@sentry/nextjs';
import { configureSentryFingerprinting } from '@/lib/monitoring/sentryConfig';

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

    sendDefaultPii: true,
    enableLogs: true,
  });

  configureSentryFingerprinting();
}
