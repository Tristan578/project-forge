/**
 * @vitest-environment jsdom
 *
 * Reopening a saved project restores its completion mode (#9998).
 *
 * The editor page calls `loadScene` before the engine has mounted, so on a
 * cold open that call defers and never reaches the `SCENE_LOADED` handoff that
 * normally carries the mode across. The page therefore adopts the mode straight
 * from the project's `sceneData` — the same guarantee it already gives the music
 * arrangement — so a sandbox project does not reopen as a win game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'project-1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const EditorLayoutStub = () => <div data-testid="editor-layout" />;
    return EditorLayoutStub;
  },
}));

// Chrome around the layout; irrelevant to what the page restores.
vi.mock('@/components/editor/EditorErrorBoundary', () => ({ EditorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/editor/WasmErrorBoundary', () => ({ WasmErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/editor/EngineCrashOverlay', () => ({ EngineCrashOverlay: () => null }));
vi.mock('@/components/editor/RemixQuarantineNotice', () => ({ RemixQuarantineNotice: () => null }));
vi.mock('@/components/editor/SceneLoadErrorNotice', () => ({ SceneLoadErrorNotice: () => null }));
vi.mock('@/lib/wasm/preloadHint', () => ({ injectWasmPreloadHint: vi.fn() }));
vi.mock('@/lib/workspace/recentProjects', () => ({ trackProjectOpen: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({}));

import EditorPage from '../page';
import { useEditorStore } from '@/stores/editorStore';

function serveProject(sceneData: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'My game', sceneData }), { status: 200 })));
}

const BASE_SCENE = { formatVersion: 3, metadata: { name: 'My game' }, entities: [] };

describe('editor page reopen (#9998)', () => {
  beforeEach(() => {
    useEditorStore.getState().hydrateCompletionMode('narrative');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['win', 'endless', 'sandbox', 'narrative'] as const)(
    'restores a saved %s mode on a cold open',
    async (mode) => {
      useEditorStore.getState().hydrateCompletionMode(undefined);
      serveProject({ ...BASE_SCENE, completionMode: mode });

      const { findByTestId } = render(<EditorPage />);
      await findByTestId('editor-layout');

      expect(useEditorStore.getState().sceneGraph.completionMode).toBe(mode);
      // Restoring what was saved is not an unsaved edit or an undo step.
      expect(useEditorStore.getState().completionModeHistory).toEqual({ past: [], future: [] });
    },
  );

  it('opens a legacy project (no field) in the legacy win mode, not the previous project\'s mode', async () => {
    serveProject(BASE_SCENE);

    const { findByTestId } = render(<EditorPage />);
    await findByTestId('editor-layout');

    await waitFor(() => expect(useEditorStore.getState().sceneGraph.completionMode).toBeUndefined());
  });
});
