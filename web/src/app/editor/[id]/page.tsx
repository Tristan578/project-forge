'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const EditorLayout = dynamic(
  () => import('@/components/editor/EditorLayout').then((m) => m.EditorLayout),
  { ssr: false, loading: () => (<div className="flex h-screen items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading editor...</div></div>) }
);
import { useEditorStore } from '@/stores/editorStore';
import { trackProjectOpen } from '@/lib/workspace/recentProjects';
import { EditorErrorBoundary } from '@/components/editor/EditorErrorBoundary';
import { WasmErrorBoundary } from '@/components/editor/WasmErrorBoundary';
import { EngineCrashOverlay } from '@/components/editor/EngineCrashOverlay';
import { EnginePanicRecovery } from '@/components/editor/EnginePanicRecovery';

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setProjectId = useEditorStore((s) => s.setProjectId);
  const loadScene = useEditorStore((s) => s.loadScene);
  const setSceneName = useEditorStore((s) => s.setSceneName);
  const setLastCloudSave = useEditorStore((s) => s.setLastCloudSave);

  // Prefetch Monaco editor chunks so the script panel opens instantly
  useEffect(() => {
    void import('@monaco-editor/react');
  }, []);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) { if (res.status === 404) { router.push('/dashboard'); return; } throw new Error('Failed to load project'); }
        const project = await res.json() as { name: string; sceneData: unknown; updatedAt?: string };
        setProjectId(projectId);
        setSceneName(project.name);
        trackProjectOpen(projectId, project.name);
        // Populate lastCloudSave from the project's server-side timestamp so
        // AutoSaveRecovery can correctly compare auto-save age against the last
        // known cloud save (fixes PF-540: lastCloudSave was always null).
        if (project.updatedAt) {
          setLastCloudSave(project.updatedAt);
        }
        loadScene(JSON.stringify(project.sceneData));
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch project:', err);
        setError((err as Error).message);
        setLoading(false);
      }
    };
    fetchProject();
  }, [projectId, router, setProjectId, loadScene, setSceneName, setLastCloudSave]);

  if (loading) return (<div className="flex h-screen items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading project...</div></div>);
  if (error) return (<div className="flex h-screen items-center justify-center bg-zinc-950"><div className="text-center"><div className="mb-2 text-red-400">{error}</div><button onClick={() => router.push('/dashboard')} className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90">Back to Dashboard</button></div></div>);

  return (
    <EditorErrorBoundary>
      <WasmErrorBoundary>
        <EngineCrashOverlay />
        <EnginePanicRecovery />
        <EditorLayout />
      </WasmErrorBoundary>
    </EditorErrorBoundary>
  );
}
