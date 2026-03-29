'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { Settings, Plus } from 'lucide-react';
import { ProjectCard } from './ProjectCard';
import { NewProjectDialog } from './NewProjectDialog';

export interface Project {
  id: string;
  name: string;
  thumbnail: string | null;
  entityCount: number;
  updatedAt: string;
}

interface DashboardLayoutProps {
  /** Server-prefetched projects. When provided, skips the initial client fetch. */
  initialProjects?: Project[];
}

export function DashboardLayout({ initialProjects }: DashboardLayoutProps = {}) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects ?? []);
  const [loading, setLoading] = useState(initialProjects === undefined);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  // Settings page is at /settings (full page, not modal)

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        setFetchError(null);
      } else if (res.status === 401) {
        router.push('/sign-in');
        return;
      } else {
        setFetchError('Failed to load projects. Please try refreshing the page.');
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      setFetchError('Unable to connect. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Only fetch on mount if the server did not pre-populate the list.
  useEffect(() => {
    if (initialProjects !== undefined) return;
    fetchProjects();
  // initialProjects is a stable server prop — omitting from deps is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchProjects]);

  const handleCreate = async (name: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sceneData: {
            formatVersion: 1,
            sceneName: name,
            entities: [],
            ambientLight: { color: [1, 1, 1], brightness: 0.3 },
            environment: {
              skyboxBrightness: 1.0,
              iblIntensity: 0.5,
              iblRotationDegrees: 0,
              clearColor: [0.1, 0.1, 0.15],
              fogEnabled: false,
              fogColor: [0.5, 0.5, 0.5],
              fogStart: 10.0,
              fogEnd: 100.0,
            },
          },
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        router.push(`/editor/${id}`);
        return null;
      }
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push('/sign-in');
        return 'Session expired. Redirecting to sign in...';
      }
      if (res.status === 403 && body?.error === 'PROJECT_LIMIT') {
        return body.message ?? 'Project limit reached. Upgrade your plan to create more.';
      }
      return body?.message ?? 'Failed to create project. Please try again.';
    } catch (err) {
      console.error('Failed to create project:', err);
      return 'Unable to connect. Please check your connection and try again.';
    }
  };

  const handleOpen = (id: string) => {
    router.push(`/editor/${id}`);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (res.ok) {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, name: newName } : p))
        );
      }
    } catch (err) {
      console.error('Failed to rename project:', err);
    }
  };

  return (
    <>
      <div className="flex h-screen flex-col bg-zinc-950">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-700 bg-zinc-900 px-6 py-4">
          <h1 className="text-2xl font-bold text-zinc-200">
            SpawnForge
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/settings')}
              className="rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title="Account settings"
            >
              <Settings size={20} />
            </button>
            <UserButton />
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-8">
          {/* New Project Button */}
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-zinc-200">
              My Projects
            </h2>
            <button
              onClick={() => setShowNewDialog(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus size={16} />
              New Project
            </button>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="text-center text-zinc-400">
              Loading projects...
            </div>
          )}

          {/* Fetch error state */}
          {!loading && fetchError && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="mb-4 text-lg text-red-400">
                {fetchError}
              </p>
              <button
                onClick={() => { setLoading(true); setFetchError(null); fetchProjects(); }}
                className="rounded-lg bg-zinc-800 px-6 py-3 text-base font-medium text-white hover:bg-zinc-700"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !fetchError && projects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="mb-4 text-lg text-zinc-400">
                No projects yet. Create your first game!
              </p>
              <button
                onClick={() => setShowNewDialog(true)}
                className="rounded-lg bg-blue-600 px-6 py-3 text-base font-medium text-white hover:opacity-90"
              >
                Create Project
              </button>
            </div>
          )}

          {/* Project grid */}
          {!loading && !fetchError && projects.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Dialogs */}
      {showNewDialog && (
        <NewProjectDialog
          isOpen={showNewDialog}
          onClose={() => setShowNewDialog(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  );
}
