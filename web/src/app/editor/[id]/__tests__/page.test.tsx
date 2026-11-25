/**
 * The editor page's cold open and the scene load it defers (#10192).
 *
 * The page calls `loadScene` from its project fetch, before `EditorLayout`
 * has mounted the engine, so the load is HELD until the dispatcher attaches.
 * That held load belongs to this mount: leaving the page (another project,
 * `/dev`) before the engine attached must drop it, or the next editor to
 * attach replays project A's scene and its first save writes it over
 * project B's. Measured through the real store and the real deferral, with
 * only the page's heavy children and Next's navigation stubbed.
 *
 * Reopening a saved project also restores its completion mode (#9998): the
 * page adopts it straight from `sceneData` at once, because the scene load it
 * defers only reaches `SCENE_LOADED` after the engine attaches.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, screen } from '@testing-library/react';
import EditorPage from '../page';
import { useEditorStore } from '@/stores/editorStore';
import { hasDeferredSceneLoad, setSceneDispatcher } from '@/stores/slices/sceneSlice';

const routerPush = vi.fn();
// One router object for the page's lifetime, as Next's is: a fresh object per
// render would re-run the page's effect (the router is among its deps) after
// every state change and load the scene again.
const router = { push: routerPush };
let currentProjectId = 'project-a';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: currentProjectId }),
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

// The editor shell mounts the engine; this test is about what happens BEFORE
// it does, so it renders nothing and never installs a dispatcher.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/lib/wasm/preloadHint', () => ({ injectWasmPreloadHint: vi.fn() }));
vi.mock('@/lib/workspace/recentProjects', () => ({ trackProjectOpen: vi.fn() }));
vi.mock('@/components/editor/EditorErrorBoundary', () => ({
  EditorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/editor/WasmErrorBoundary', () => ({
  WasmErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/editor/EngineCrashOverlay', () => ({ EngineCrashOverlay: () => null }));
vi.mock('@/components/editor/RemixQuarantineNotice', () => ({ RemixQuarantineNotice: () => null }));
vi.mock('@/components/editor/SceneLoadErrorNotice', () => ({ SceneLoadErrorNotice: () => null }));

const SCENE_A = { entities: [{ entityId: 'a1', name: 'CubeA', parentId: null, visible: true }], metadata: { name: 'A' } };

/**
 * A project fetch the test settles by hand, in two steps — the response and
 * then its body — so an unmount can land before either.
 */
function deferredFetch(status = 200) {
  let settleResponse!: () => void;
  let settleBody!: () => void;
  const body = new Promise<unknown>((resolve) => {
    settleBody = () => resolve({ name: 'Project A', sceneData: SCENE_A });
  });
  const response = new Promise<Response>((resolve) => {
    settleResponse = () => resolve({ ok: status === 200, status, json: () => body } as unknown as Response);
  });
  const fetchMock = vi.fn(() => response);
  return { fetchMock, settleResponse, settleBody, settle: () => { settleResponse(); settleBody(); } };
}

describe('EditorPage cold open (#10192, deferred scene load ownership)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentProjectId = 'project-a';
    // No engine: every load in these tests is a cold-open deferral.
    setSceneDispatcher(null);
    // The store is a singleton: a previous test's project must not leak in.
    useEditorStore.setState({ projectId: null });
  });

  afterEach(() => {
    cleanup();
    setSceneDispatcher(null);
  });

  it('defers the project scene until the engine attaches, then replays exactly that scene', async () => {
    const { fetchMock, settle } = deferredFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<EditorPage />);
    expect(hasDeferredSceneLoad()).toBe(false);

    await act(async () => { settle(); });
    expect(hasDeferredSceneLoad()).toBe(true);
    expect(useEditorStore.getState().projectId).toBe('project-a');

    const engine = vi.fn((_command: string, _payload: unknown) => ({ success: true }));
    setSceneDispatcher(engine);
    const loads = engine.mock.calls.filter(([command]) => command === 'load_scene');
    // `SCENE_A` states no project type, so the project open states the
    // fresh-engine type for it (#10374); everything else is exactly that scene.
    expect(loads).toEqual([
      ['load_scene', { json: JSON.stringify({ ...SCENE_A, metadata: { name: 'A', projectType: '3d' } }) }],
    ]);
  });

  it('drops the deferred load when the page unmounts before the engine attaches', async () => {
    const { fetchMock, settle } = deferredFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { unmount } = render(<EditorPage />);
    await act(async () => { settle(); });
    expect(hasDeferredSceneLoad()).toBe(true);

    // Navigating to another project or to /dev before WASM attached.
    unmount();
    expect(hasDeferredSceneLoad()).toBe(false);

    const engine = vi.fn((_command: string, _payload: unknown) => ({ success: true }));
    setSceneDispatcher(engine);
    expect(engine.mock.calls.filter(([command]) => command === 'load_scene')).toEqual([]);
  });

  it('ignores a 404 that arrives after the page has gone: no redirect out of wherever the user went', async () => {
    const { fetchMock, settle } = deferredFetch(404);
    global.fetch = fetchMock as unknown as typeof fetch;
    const { unmount } = render(<EditorPage />);
    unmount();

    await act(async () => { settle(); });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('ignores a body that arrives after the page has gone, so nothing is deferred for it', async () => {
    const { fetchMock, settleResponse, settleBody } = deferredFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { unmount } = render(<EditorPage />);
    // The response headers landed while the page was up; the body did not.
    await act(async () => { settleResponse(); });
    unmount();

    await act(async () => { settleBody(); });
    expect(hasDeferredSceneLoad()).toBe(false);
    expect(useEditorStore.getState().projectId).toBeNull();
  });
});

const BASE_SCENE = { formatVersion: 3, metadata: { name: 'My game' }, entities: [] };

function serveProject(sceneData: Record<string, unknown>) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ name: 'My game', sceneData }), { status: 200 })) as unknown as typeof fetch;
}

describe('EditorPage reopen restores the completion mode (#9998)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentProjectId = 'project-a';
    setSceneDispatcher(null);
    useEditorStore.setState({ projectId: null });
    // A previous project's mode, which the reopened one must not inherit.
    useEditorStore.getState().hydrateCompletionMode('narrative');
  });

  afterEach(() => {
    cleanup();
    setSceneDispatcher(null);
  });

  it.each(['win', 'endless', 'sandbox', 'narrative'] as const)(
    'restores a saved %s mode on a cold open',
    async (mode) => {
      useEditorStore.getState().hydrateCompletionMode(undefined);
      serveProject({ ...BASE_SCENE, completionMode: mode });

      render(<EditorPage />);

      await waitFor(() => expect(useEditorStore.getState().sceneGraph.completionMode).toBe(mode));
      // Restoring what was saved is not an unsaved edit or an undo step.
      expect(useEditorStore.getState().completionModeHistory).toEqual({ past: [], future: [] });
      expect(useEditorStore.getState().sceneModified).toBe(false);
    },
  );

  it('opens a legacy project (no field) in the legacy win mode, not the previous project mode', async () => {
    serveProject(BASE_SCENE);

    render(<EditorPage />);

    await waitFor(() => expect(useEditorStore.getState().projectId).toBe('project-a'));
    expect(useEditorStore.getState().sceneGraph.completionMode).toBeUndefined();
  });
});

/**
 * A WARM open: the page's effect runs for a project while the engine
 * dispatcher is already attached (the Welcome modal's recent projects, a
 * remix landing in an open editor), so `loadScene` dispatches at once rather
 * than deferring. An engine throw then raises `EngineDispatchThrewError`
 * synchronously from the call (#10202). The page must keep the editor up —
 * the slice has locked saving and `SceneLoadErrorNotice` explains it there —
 * and finish hydrating, not replace everything with the generic error screen.
 */
describe('EditorPage warm open: the engine throws on load_scene (#10202 review)', () => {
  const originalLoadScene = useEditorStore.getState().loadScene;

  beforeEach(() => {
    vi.clearAllMocks();
    currentProjectId = 'project-a';
    useEditorStore.setState({ projectId: null, sceneLoadError: null, loadScene: originalLoadScene });
    useEditorStore.getState().hydrateCompletionMode(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    setSceneDispatcher(null);
    useEditorStore.setState({ sceneLoadError: null, loadScene: originalLoadScene });
    vi.restoreAllMocks();
  });

  it('keeps the editor up with the lockout recorded, and still hydrates the completion mode', async () => {
    // The dispatcher the editor registers reports an engine throw this way.
    const engine = vi.fn((command: string, _payload: unknown) =>
      command === 'load_scene' ? { success: false, error: 'wasm panic in load_scene', threw: true as const } : { success: true });
    setSceneDispatcher(engine);
    serveProject({ ...BASE_SCENE, completionMode: 'endless' });

    render(<EditorPage />);

    await waitFor(() => expect(useEditorStore.getState().projectId).toBe('project-a'));
    expect(engine.mock.calls.filter(([command]) => command === 'load_scene')).toHaveLength(1);
    // The slice locked saving with the engine-threw reason: that is what the
    // in-editor notice shows, and why the page must not throw the editor away.
    expect(useEditorStore.getState().sceneLoadError?.reason).toContain('the engine failed while loading it');
    // Not the generic error screen, and no longer loading: the editor branch rendered.
    await waitFor(() => expect(screen.queryByText('Loading project...')).toBeNull());
    expect(screen.queryByText('Back to Dashboard')).toBeNull();
    expect(screen.queryByText(/wasm panic/)).toBeNull();
    // The hydration after the load still ran.
    expect(useEditorStore.getState().sceneGraph.completionMode).toBe('endless');
  });

  it('still shows the generic error screen for a throw that is NOT the engine (no lockout exists for it)', async () => {
    useEditorStore.setState({
      loadScene: () => {
        throw new Error('storage quota exceeded');
      },
    });
    serveProject(BASE_SCENE);

    render(<EditorPage />);

    await waitFor(() => expect(screen.queryByText('Back to Dashboard')).not.toBeNull());
    expect(screen.queryByText('storage quota exceeded')).not.toBeNull();
    expect(useEditorStore.getState().sceneLoadError).toBeNull();
  });
});

/**
 * #10374: the engine is a page singleton, so a client-side hop from one
 * project to another keeps the same Bevy app and its project type. A scene
 * with no `metadata.projectType` leaves that type alone on load, so before
 * this a key-less project opened after a 2D one came up 2D (and its next
 * autosave stored `"2d"`). The page now opens a key-less project as the type
 * a fresh engine starts in.
 *
 * The fake engine models the one rule that matters here, the engine's
 * absent-aware load (`ProjectType::apply_request` in
 * `engine/src/core/project_type.rs`): a stated type replaces the current one,
 * an absent key keeps it. It survives every navigation, as the real one does.
 */
describe('EditorPage project open states a project type (#10374)', () => {
  const SCENE_2D = { formatVersion: 3, metadata: { name: 'Platformer', projectType: '2d' }, entities: [] };
  const SCENE_KEYLESS = { formatVersion: 3, metadata: { name: 'Legacy' }, entities: [] };

  function fakeEngine() {
    const state = { projectType: '3d' as string, loads: [] as Record<string, unknown>[] };
    const dispatch = vi.fn((command: string, payload: unknown) => {
      if (command === 'load_scene') {
        const scene = JSON.parse((payload as { json: string }).json) as { metadata?: { projectType?: string | null } };
        state.loads.push(scene as Record<string, unknown>);
        const stated = scene.metadata?.projectType;
        if (stated === '2d' || stated === '3d') state.projectType = stated;
      }
      return { success: true };
    });
    return { state, dispatch };
  }

  function serveProjects(byId: Record<string, Record<string, unknown>>) {
    global.fetch = vi.fn(async (url: string) => {
      const id = String(url).split('/').pop() ?? '';
      return new Response(JSON.stringify({ name: id, sceneData: byId[id] }), { status: 200 });
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    currentProjectId = 'project-2d';
    useEditorStore.setState({ projectId: null });
  });

  afterEach(() => {
    cleanup();
    setSceneDispatcher(null);
  });

  it('opens a key-less project as 3D after a 2D project in the same tab', async () => {
    const engine = fakeEngine();
    setSceneDispatcher(engine.dispatch);
    serveProjects({ 'project-2d': SCENE_2D, 'project-legacy': SCENE_KEYLESS });

    const { rerender } = render(<EditorPage />);
    await waitFor(() => expect(useEditorStore.getState().projectId).toBe('project-2d'));
    expect(engine.state.projectType).toBe('2d');

    // Client-side navigation to another project: same engine, same page tree.
    currentProjectId = 'project-legacy';
    rerender(<EditorPage />);
    await waitFor(() => expect(useEditorStore.getState().projectId).toBe('project-legacy'));

    expect(engine.state.loads).toHaveLength(2);
    expect(engine.state.projectType).toBe('3d');
  });

  it('leaves a scene that states its type exactly as stored', async () => {
    const engine = fakeEngine();
    setSceneDispatcher(engine.dispatch);
    serveProjects({ 'project-2d': SCENE_2D });

    render(<EditorPage />);
    await waitFor(() => expect(useEditorStore.getState().projectId).toBe('project-2d'));

    const loads = engine.dispatch.mock.calls.filter(([command]) => command === 'load_scene');
    expect(loads).toEqual([['load_scene', { json: JSON.stringify(SCENE_2D) }]]);
  });
});
