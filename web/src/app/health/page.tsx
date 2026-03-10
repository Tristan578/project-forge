import { runAllHealthChecks } from '@/lib/monitoring/healthChecks';
import { HealthDashboard } from '@/components/health/HealthDashboard';

/**
 * /health — Public service health dashboard.
 * No authentication required. Runs health checks server-side on load.
 */
export default async function HealthPage() {
  const report = await runAllHealthChecks();
  return <HealthDashboard initialReport={report} />;
}

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Service Health — SpawnForge',
  description: 'Real-time status of all SpawnForge services.',
};
