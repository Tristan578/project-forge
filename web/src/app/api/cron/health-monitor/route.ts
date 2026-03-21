import { NextRequest, NextResponse } from 'next/server';
import {
  checkDatabase,
  checkRateLimiting,
  type ServiceHealth,
} from '@/lib/monitoring/healthChecks';
import { captureException } from '@/lib/monitoring/sentry-server';
import { logger } from '@/lib/logging/logger';

/**
 * GET /api/cron/health-monitor
 *
 * Synthetic monitoring endpoint invoked every 5 minutes by Vercel Cron.
 * Checks the three services that must be healthy for SpawnForge to function:
 *   1. /api/health — application layer (HTTP reachability)
 *   2. Database (Neon) — direct ping
 *   3. Rate Limiting (Upstash Redis) — config + connectivity
 *
 * On any failure, captures a structured exception to Sentry so on-call
 * engineers receive an alert without polling the endpoint manually.
 *
 * Auth: Vercel Cron sets the `Authorization: Bearer <CRON_SECRET>` header
 * on every invocation. Requests without a valid secret are rejected 401.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Verify CRON_SECRET to prevent unauthenticated invocations.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const startedAt = new Date().toISOString();
  const checks: Array<{ name: string; status: ServiceHealth['status']; error?: string }> = [];
  const failures: string[] = [];

  // --- 1. /api/health reachability ---
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
    if (appUrl) {
      const base = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      const res = await fetch(`${base}/api/health`, {
        method: 'GET',
        headers: { 'x-synthetic-monitor': '1' },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        checks.push({ name: '/api/health', status: 'healthy' });
      } else {
        const msg = `HTTP ${res.status}`;
        checks.push({ name: '/api/health', status: 'down', error: msg });
        failures.push(`/api/health: ${msg}`);
      }
    } else {
      // URL not configured — skip without flagging as failure (local/test environments)
      checks.push({ name: '/api/health', status: 'healthy' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: '/api/health', status: 'down', error: msg });
    failures.push(`/api/health: ${msg}`);
  }

  // --- 2. Database (Neon) ping ---
  try {
    const dbHealth = await checkDatabase();
    checks.push({ name: dbHealth.name, status: dbHealth.status, error: dbHealth.error });
    if (dbHealth.status === 'down') {
      failures.push(`${dbHealth.name}: ${dbHealth.error ?? 'down'}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: 'Database (Neon)', status: 'down', error: msg });
    failures.push(`Database (Neon): ${msg}`);
  }

  // --- 3. Redis ping (Upstash) ---
  try {
    const redisHealth = await checkRateLimiting();
    checks.push({ name: redisHealth.name, status: redisHealth.status, error: redisHealth.error });
    if (redisHealth.status === 'down') {
      failures.push(`${redisHealth.name}: ${redisHealth.error ?? 'down'}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: 'Rate Limiting (Upstash)', status: 'down', error: msg });
    failures.push(`Rate Limiting (Upstash): ${msg}`);
  }

  // --- Report failures to Sentry ---
  if (failures.length > 0) {
    const error = new Error(`Synthetic monitor detected failures: ${failures.join('; ')}`);
    captureException(error, {
      source: 'cron/health-monitor',
      checks,
      failures,
      startedAt,
    });
    logger.error('Synthetic health monitor failure', {
      endpoint: 'GET /api/cron/health-monitor',
      failures,
      checks,
    });
  } else {
    logger.info('Synthetic health monitor passed', {
      endpoint: 'GET /api/cron/health-monitor',
      checkCount: checks.length,
    });
  }

  const overallStatus = failures.length === 0 ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status: overallStatus,
      startedAt,
      checks,
      failureCount: failures.length,
    },
    { status: failures.length === 0 ? 200 : 503 },
  );
}

export const dynamic = 'force-dynamic';
