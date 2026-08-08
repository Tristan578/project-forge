import { getCachedHealthReport, sanitizeForPublic } from '@/lib/monitoring/healthChecks';
import { HealthDashboard } from '@/components/health/HealthDashboard';

/**
 * /health — Public service health dashboard.
 * No authentication required. Runs health checks server-side on load.
 */
export default async function HealthPage() {
  // Cached fan-out, not a raw one: this page is public (PF-1038) and a Server
  // Component cannot rate-limit itself. See getCachedHealthReport().
  const report = await getCachedHealthReport();
  // Sanitize before sending to client to avoid leaking internal error details
  const sanitizedReport = {
    ...report,
    services: sanitizeForPublic(report.services),
  };
  return <HealthDashboard initialReport={sanitizedReport} />;
}

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Service Health — SpawnForge',
  description: 'Real-time status of all SpawnForge services.',
};
