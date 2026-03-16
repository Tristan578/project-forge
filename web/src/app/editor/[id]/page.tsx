'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const EditorLayout = dynamic(
  () => import('@/components/editor/EditorLayout').then((m) => m.EditorLayout),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading editor...</div>
      </div>
    ),
  }
);
import { useEditorStore } from '@/stores/editorStore';
import { trackProjectOpen } from '@/lib/workspace/recentProjects';

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setProjectId = useEditorStore((s) => s.setProjectId);
  const loadScene = useEditorStore((s) => s.loadScene);
  const setSceneName = useEditorStore((s) => s.setSceneName);

  // Prefetch Monaco editor chunks so the script panel opens instantly
  useEffect(() => {
    void import('@monaco-editor/react');
  }, []);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) {
          if (res.status === 404) {
            router.push('/dashboard');
            return;
          }
          throw new Error('Failed to load project');
        }

        const project = await res.json();
        setProjectId(projectId);
        setSceneName(project.name);
        trackProjectOpen(projectId, project.name);

        // Load the scene data into the engine
        const sceneJson = JSON.stringify(project.sceneData);
        loadScene(sceneJson);

        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch project:', err);
        setError((err as Error).message);
        setLoading(false);
      }
    };

    fetchProject();
  }, [projectId, router, setProjectId, loadScene, setSceneName]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-zinc-400">Loading project...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="mb-2 text-red-400">{error}</div>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <EditorLayout />;
}
