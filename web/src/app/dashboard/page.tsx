import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import type { Project } from '@/components/dashboard/DashboardLayout';
import { safeAuth } from '@/lib/auth/safe-auth';
import { listProjects } from '@/lib/projects/service';

export const dynamic = 'force-dynamic';

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

  // Defense-in-depth: middleware should redirect unauthenticated users,
  // but bot crawlers sometimes bypass it. Without this guard, SSR renders
  // <UserButton> without ClerkProvider context (SPAWNFORGE-AI-1).
  if (!userId) {
    redirect('/sign-in');
  }

  let initialProjects: Project[] | undefined;
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
      // DB unavailable — leave undefined so DashboardLayout falls back to client-side fetch
    }
  }

  return <DashboardLayout initialProjects={initialProjects} />;
}
