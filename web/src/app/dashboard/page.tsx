import type { Metadata } from 'next';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import type { Project } from '@/components/dashboard/DashboardLayout';
import { safeAuth } from '@/lib/auth/safe-auth';
import { listProjects } from '@/lib/projects/service';

export const metadata: Metadata = {
  title: 'Dashboard — SpawnForge',
};

/**
 * Server Component wrapper for the dashboard.
 *
 * Pre-fetches the project list on the server so the client receives
 * populated HTML instead of showing a loading spinner. The DashboardLayout
 * client component skips its initial fetch when `initialProjects` is set.
 *
 * Falls back to an empty initial list when auth is not configured (CI/E2E).
 * The client component will then fetch from /api/projects normally.
 */
export default async function DashboardPage() {
  const { userId } = await safeAuth();

  let initialProjects: Project[] = [];
  if (userId) {
    try {
      const rows = await listProjects(userId);
      initialProjects = rows.map((p) => ({
        id: p.id,
        name: p.name,
        thumbnail: p.thumbnail ?? null,
        entityCount: p.entityCount ?? 0,
        updatedAt: p.updatedAt instanceof Date
          ? p.updatedAt.toISOString()
          : String(p.updatedAt),
      }));
    } catch {
      // DB unavailable — fall back to client-side fetch
      initialProjects = [];
    }
  }

  return <DashboardLayout initialProjects={userId ? initialProjects : undefined} />;
}
