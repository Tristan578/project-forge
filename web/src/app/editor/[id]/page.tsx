'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { injectWasmPreloadHint } from '@/lib/wasm/preloadHint';
import dynamic from 'next/dynamic';

const EditorLayout = dynamic(
  () => import('@/components/editor/EditorLayout').then((m) => m.EditorLayout),
  { ssr: false, loading: () => (<div className="flex h-full items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading editor...</div></div>) }
);
import { useEditorStore } from '@/stores/editorStore';
import { cancelDeferredSceneLoad } from '@/stores/slices/sceneSlice';
import { useMusicArrangementStore, readArrangementFromSceneData } from '@/lib/music/arrangementStore';
import { trackProjectOpen } from '@/lib/workspace/recentProjects';
import { EditorErrorBoundary } from '@/components/editor/EditorErrorBoundary';
import { WasmErrorBoundary } from '@/components/editor/WasmErrorBoundary';
import { EngineCrashOverlay } from '@/components/editor/EngineCrashOverlay';
import { RemixQuarantineNotice } from '@/components/editor/RemixQuarantineNotice';
import { SceneLoadErrorNotice } from '@/components/editor/SceneLoadErrorNotice';

function EditorPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const quarantinedScripts = Number.parseInt(searchParams.get('quarantinedScripts') ?? '0', 10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setProjectId = useEditorStore((s) => s.setProjectId);
  const loadScene = useEditorStore((s) => s.loadScene);
  const setSceneName = useEditorStore((s) => s.setSceneName);
  const setLastCloudSave = useEditorStore((s) => s.setLastCloudSave);

  // Inject <link rel="preload"> for the WASM JS glue file as early as possible
  // so the browser can start fetching it while the page is still loading.
  // Called once on first mount — safe to call before GPU detection completes.
  useEffect(() => {
    injectWasmPreloadHint();
  }, []);

  // Prefetch Monaco editor chunks so the script panel opens instantly
  useEffect(() => {
    // A failed prefetch is not fatal — the script panel imports Monaco again on open.
    import('@monaco-editor/react').catch((err: unknown) => {
      console.warn('Failed to prefetch the Monaco editor chunk:', err);
    });
  }, []);

  useEffect(() => {
    // Set by the cleanup: a fetch that settles after this mount is gone (or
    // after the project changed) must not touch the store, and above all must
    // not defer a scene load that the next editor to attach would replay.
    let cancelled = false;
    const fetchProject = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (cancelled) return;
        if (!res.ok) { if (res.status === 404) { router.push('/dashboard'); return; } throw new Error('Failed to load project'); }
        const project = await res.json() as { name: string; sceneData: unknown; updatedAt?: string };
        if (cancelled) return;
        setProjectId(projectId);
        setSceneName(project.name);
        trackProjectOpen(projectId, project.name);
        // Populate lastCloudSave from the project's server-side timestamp so
        // AutoSaveRecovery can correctly compare auto-save age against the last
        // known cloud save (fixes PF-540: lastCloudSave was always null).
        if (project.updatedAt) {
          setLastCloudSave(project.updatedAt);
        }
        // The cold open is the ONE caller allowed to defer: `EditorLayout`
        // (and so the engine dispatcher) mounts after this effect, and the
        // held load replays once it attaches (#10192). The cleanup below
        // cancels it if this page goes away first.
        loadScene(JSON.stringify(project.sceneData), { deferUntilEngineAttaches: true });
        // Restore the music arrangement persisted alongside the scene (#9854).
        // `loadScene` itself now does this too (#10058, for every OTHER
        // caller of loadScene/newScene) — this direct call stays as a
        // guarantee for the initial mount specifically, since it must still
        // run even if `loadScene` bails out early on a dispatch that isn't
        // ready yet.
        useMusicArrangementStore.getState().hydrate(readArrangementFromSceneData(project.sceneData));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch project:', err);
        setError((err as Error).message);
        setLoading(false);
      }
    };
    void fetchProject();
    return () => {
      cancelled = true;
      // A load deferred for THIS project belongs to this mount. Without this,
      // opening project A and navigating away before WASM attached replayed
      // A's scene into whichever editor attached next (a different project,
      // or /dev), where the next save wrote it over that project's scene.
      cancelDeferredSceneLoad();
    };
  }, [projectId, router, setProjectId, loadScene, setSceneName, setLastCloudSave]);

  if (loading) return (<div className="flex h-full items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading project...</div></div>);
  if (error) return (<div className="flex h-full items-center justify-center bg-zinc-950"><div className="text-center"><div className="mb-2 text-red-400">{error}</div><button onClick={() => router.push('/dashboard')} className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:opacity-90">Back to Dashboard</button></div></div>);

  return (
    <EditorErrorBoundary>
      <WasmErrorBoundary>
        <EngineCrashOverlay />
        <RemixQuarantineNotice count={quarantinedScripts} />
        {/* Renders only when a scene load was REJECTED. `loadScene`'s boolean is
            deliberately still discarded above: it is also false on a healthy
            cold open (no engine dispatcher yet), so the store's
            `sceneLoadError` — set only on the rejection branches — is the one
            fact that can be shown to the user without false positives
            (#10056). */}
        <SceneLoadErrorNotice />
        <EditorLayout />
      </WasmErrorBoundary>
    </EditorErrorBoundary>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-zinc-950"><div className="text-zinc-400">Loading editor...</div></div>}>
      <EditorPageContent />
    </Suspense>
  );
}
