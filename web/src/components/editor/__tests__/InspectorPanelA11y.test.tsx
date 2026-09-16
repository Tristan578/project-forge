/**
 * Accessibility + keyboard tests for the Inspector panel.
 *
 * Covers operation localization.FR-2.OP-01 (name/focus audit) and OP-04
 * (custom inspector markup regression gate):
 *   - jest-axe assertion over the rendered inspector, including an
 *     icon-only control (the Copy/Paste transform buttons)
 *   - every icon-only control exposes an accessible name
 *   - the name field is programmatically labelled
 *   - Escape in the inline name field discards the unconfirmed edit
 *     (no rename dispatched) and leaves the field's value restored
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { InspectorPanel } from '@/components/editor/InspectorPanel';
import type { EditorState } from '@/stores/editorStore';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

function summarize(violations: { id: string; impact?: string | null; help?: string }[]): string {
  return violations.map((v) => `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help ?? ''}`).join('\n');
}

vi.mock('@/stores/editorStore', () => ({ useEditorStore: vi.fn(() => ({})) }));
vi.mock('@/stores/chatStore', () => ({ useChatStore: vi.fn(() => ({})) }));

// Only Transform + Script + name render (Transform is gated by primaryTransform,
// Script is always on). Everything else is switched off so the axe surface is
// the inspector's own custom markup with real Vec3Input/CollapsibleSection.
vi.mock('@/stores/complexitySlice', () => ({
  useComplexityStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ isInspectorSectionVisible: () => false }),
  ),
}));

// Sub-inspectors are separate concerns — stub them so the render stays scoped
// to the inspector chrome. Vec3Input, InfoTooltip, CollapsibleSection and
// InspectorErrorBoundary are kept REAL so axe audits the actual markup.
vi.mock('@/components/editor/LightInspector', () => ({ LightInspector: () => null }));
vi.mock('@/components/editor/MaterialInspector', () => ({ MaterialInspector: () => null }));
vi.mock('@/components/editor/SceneSettings', () => ({ SceneSettings: () => null }));
vi.mock('@/components/editor/InputBindingsPanel', () => ({ InputBindingsPanel: () => null }));
vi.mock('@/components/editor/PhysicsInspector', () => ({ PhysicsInspector: () => null }));
vi.mock('@/components/editor/Physics2dInspector', () => ({ Physics2dInspector: () => null }));
vi.mock('@/components/editor/AudioInspector', () => ({ AudioInspector: () => null }));
vi.mock('@/components/editor/ParticleInspector', () => ({ ParticleInspector: () => null }));
vi.mock('@/components/editor/AnimationInspector', () => ({ AnimationInspector: () => null }));
vi.mock('@/components/editor/AnimationClipInspector', () => ({ AnimationClipInspector: () => null }));
vi.mock('@/components/editor/TerrainInspector', () => ({ TerrainInspector: () => null }));
vi.mock('@/components/editor/JointInspector', () => ({ JointInspector: () => null }));
vi.mock('@/components/editor/GameComponentInspector', () => ({ GameComponentInspector: () => null }));
vi.mock('@/components/editor/GameCameraInspector', () => ({ GameCameraInspector: () => null }));
vi.mock('@/components/editor/SpriteInspector', () => ({ SpriteInspector: () => null }));
vi.mock('@/components/editor/SpriteAnimationInspector', () => ({ SpriteAnimationInspector: () => null }));
vi.mock('@/components/editor/SkeletonInspector', () => ({ SkeletonInspector: () => null }));
vi.mock('@/components/editor/Camera2dInspector', () => ({ Camera2dInspector: () => null }));
vi.mock('@/components/editor/TilemapInspector', () => ({ TilemapInspector: () => null }));
vi.mock('@/components/editor/ReverbZoneInspector', () => ({ ReverbZoneInspector: () => null }));
vi.mock('@/components/editor/EditModeInspector', () => ({ EditModeInspector: () => null }));
vi.mock('@/components/editor/AdaptiveMusicInspector', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/editor/LodInspector', () => ({ LodInspector: () => null }));
vi.mock('@/lib/transformClipboard', () => ({
  copyTransformProperty: vi.fn(),
  copyFullTransform: vi.fn(),
  getPropertyFromClipboard: vi.fn(),
  readTransformFromClipboard: vi.fn(),
}));

const { useEditorStore: actualEditorStore } = await vi.importActual<typeof import('@/stores/editorStore')>('@/stores/editorStore');
const { useChatStore: actualChatStore } = await vi.importActual<typeof import('@/stores/chatStore')>('@/stores/chatStore');
type ChatState = ReturnType<typeof actualChatStore.getInitialState>;
const mockRenameEntity = vi.fn();

function setupStore() {
  vi.mocked(useEditorStore).mockImplementation(<T,>(selector: (state: EditorState) => T) => {
    const state: EditorState = {
      ...actualEditorStore.getInitialState(),
      primaryId: 'ent-1',
      primaryName: 'MyCube',
      primaryTransform: {
        entityId: 'ent-1',
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      primaryLight: null,
      updateTransform: vi.fn(),
      renameEntity: mockRenameEntity,
      allScripts: {},
      projectType: '3d',
      sceneGraph: { nodes: { 'ent-1': { entityId: 'ent-1', name: 'MyCube', visible: true, parentId: null, children: [], components: [] } }, rootIds: ['ent-1'] },
      skeletons2d: {},
    };
    return selector(state);
  });
  vi.mocked(useChatStore).mockImplementation(<T,>(selector: (state: ChatState) => T) =>
    selector({ ...actualChatStore.getInitialState(), setRightPanelTab: vi.fn() }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setupStore();
});

afterEach(() => cleanup());

describe('InspectorPanel accessibility (localization.FR-2.OP-01 / OP-04)', () => {
  it('has zero axe violations with an icon-only control focused', async () => {
    const user = userEvent.setup();
    const { container } = render(<InspectorPanel />);
    // Focus an icon-only control so the audited state includes it.
    const copyBtn = screen.getByRole('button', { name: 'Copy transform' });
    await user.click(copyBtn);
    const results = await axe(container);
    expect(results.violations, summarize(results.violations)).toHaveLength(0);
  });

  it('gives every icon-only transform control an accessible name', () => {
    render(<InspectorPanel />);
    expect(screen.getByRole('button', { name: 'Copy transform' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste transform' })).toBeInTheDocument();
  });

  it('programmatically labels the entity name field', () => {
    render(<InspectorPanel />);
    const nameInput = screen.getByLabelText(/name/i);
    expect(nameInput).toHaveValue('MyCube');
  });

  it('Escape discards an unconfirmed name edit without dispatching a rename', async () => {
    const user = userEvent.setup();
    render(<InspectorPanel />);
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;

    await user.click(nameInput);
    await user.clear(nameInput);
    await user.type(nameInput, 'Temp Unsaved Name');
    await user.keyboard('{Escape}');

    // The unconfirmed edit must not be applied through the blur path.
    expect(mockRenameEntity).not.toHaveBeenCalled();
    // The field is restored to the entity's committed name.
    expect(nameInput.value).toBe('MyCube');

    // Cancellation is consumed once; a later edit in the same session commits.
    await user.click(nameInput);
    await user.clear(nameInput);
    await user.type(nameInput, 'Second edit');
    await user.tab();
    expect(mockRenameEntity).toHaveBeenCalledExactlyOnceWith('ent-1', 'Second edit');
  });
});
