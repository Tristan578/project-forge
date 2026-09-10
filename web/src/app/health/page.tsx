import { headers } from 'next/headers';
import {
  getCachedHealthReport,
  peekCachedHealthReport,
  sanitizeForPublic,
} from '@/lib/monitoring/healthChecks';
import { checkHealthFanoutBudget } from '@/lib/monitoring/healthFanoutBudget';
import { getClientIpFromHeaders } from '@/lib/rateLimit';
import { HealthDashboard } from '@/components/health/HealthDashboard';

/**
 * /health — Public service health dashboard.
 * No authentication required (#9060). Runs health checks server-side on load.
 */

/**
 * Rendering this page costs six outbound probes (Neon, Stripe, the engine CDN, Clerk,
 * the chat backend, Upstash) — see `getCachedHealthReport()`. That cache collapses bursts, but
 * its state is per-lambda-instance, so it bounds one instance rather than the
 * aggregate: under a distributed burst Vercel scales instances and the fan-out
 * scales with them. The Clerk probe is the one that matters most, since it
 * sends `CLERK_SECRET_KEY` to Clerk's API — letting anonymous traffic drive
 * that risks Clerk rate-limiting the key our real auth depends on.
 *
 * So the shared, Upstash-backed fan-out budget is the actual bound, and the
 * cache is the fast path in front of it: a warm cache is served without
 * spending budget at all, because a report we already hold costs no outbound
 * calls. `GET /api/health` consumes the SAME budget for the same client, so
 * hopping between the two surfaces buys an attacker nothing.
 *
 * Out of budget we do NOT 429: a status page that goes dark under load has
 * failed at its one job. We hand the client a null report and it renders the
 * shell, then polls `/api/health` — which will serve a cached report if one is
 * live, and is itself bounded by both this budget and its own endpoint limit.
 */
async function resolveHealthReport() {
  const clientIp = getClientIpFromHeaders(await headers());

  // Free path: a live cached report costs nothing to serve, so it must not
  // spend fan-out budget (or a Upstash round-trip) to be handed out.
  const cached = peekCachedHealthReport();
  if (cached) return cached;

  const { allowed } = await checkHealthFanoutBudget(clientIp);
  return allowed ? await getCachedHealthReport() : null;
}

export default async function HealthPage() {
  const report = await resolveHealthReport();

  // Sanitize before sending to client to avoid leaking internal error details.
  // A cached report is shared across every anonymous visitor, so skipping this
  // would leak internal detail more widely, not less.
  const sanitizedReport = report
    ? { ...report, services: sanitizeForPublic(report.services) }
    : null;

  return <HealthDashboard initialReport={sanitizedReport} />;
}

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Service Health — SpawnForge',
  description: 'Real-time status of all SpawnForge services.',
};
