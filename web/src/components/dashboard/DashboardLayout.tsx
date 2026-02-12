'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { Settings, Plus } from 'lucide-react';
import { ProjectCard } from './ProjectCard';
import { NewProjectDialog } from './NewProjectDialog';

interface Project {
  id: string;
  name: string;
  thumbnail: string | null;
  entityCount: number;
  updatedAt: string;
}

export function DashboardLayout() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (name: string) => {
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
      }
    } catch (err) {
      console.error('Failed to create project:', err);
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
      <div className="flex h-screen flex-col bg-[var(--color-bg-primary)]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-6 py-4">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
            Project Forge
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(true)}
              className="rounded p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
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
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
              My Projects
            </h2>
            <button
              onClick={() => setShowNewDialog(true)}
              className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus size={16} />
              New Project
            </button>
          </div>

          {/* Loading state */}
          {loading && (
            <div className="text-center text-[var(--color-text-secondary)]">
              Loading projects...
            </div>
          )}

          {/* Empty state */}
          {!loading && projects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="mb-4 text-lg text-[var(--color-text-secondary)]">
                No projects yet. Create your first game!
              </p>
              <button
                onClick={() => setShowNewDialog(true)}
                className="rounded-lg bg-[var(--color-accent)] px-6 py-3 text-base font-medium text-white hover:opacity-90"
              >
                Create Project
              </button>
            </div>
          )}

          {/* Project grid */}
          {!loading && projects.length > 0 && (
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
