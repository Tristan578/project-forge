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
import { axe, toHaveNoViolations } from 'jest-axe';
import { InspectorPanel } from '../InspectorPanel';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

expect.extend(toHaveNoViolations);

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
vi.mock('../LightInspector', () => ({ LightInspector: () => null }));
vi.mock('../MaterialInspector', () => ({ MaterialInspector: () => null }));
vi.mock('../SceneSettings', () => ({ SceneSettings: () => null }));
vi.mock('../InputBindingsPanel', () => ({ InputBindingsPanel: () => null }));
vi.mock('../PhysicsInspector', () => ({ PhysicsInspector: () => null }));
vi.mock('../Physics2dInspector', () => ({ Physics2dInspector: () => null }));
vi.mock('../AudioInspector', () => ({ AudioInspector: () => null }));
vi.mock('../ParticleInspector', () => ({ ParticleInspector: () => null }));
vi.mock('../AnimationInspector', () => ({ AnimationInspector: () => null }));
vi.mock('../AnimationClipInspector', () => ({ AnimationClipInspector: () => null }));
vi.mock('../TerrainInspector', () => ({ TerrainInspector: () => null }));
vi.mock('../JointInspector', () => ({ JointInspector: () => null }));
vi.mock('../GameComponentInspector', () => ({ GameComponentInspector: () => null }));
vi.mock('../GameCameraInspector', () => ({ GameCameraInspector: () => null }));
vi.mock('../SpriteInspector', () => ({ SpriteInspector: () => null }));
vi.mock('../SpriteAnimationInspector', () => ({ SpriteAnimationInspector: () => null }));
vi.mock('../SkeletonInspector', () => ({ SkeletonInspector: () => null }));
vi.mock('../Camera2dInspector', () => ({ Camera2dInspector: () => null }));
vi.mock('../TilemapInspector', () => ({ TilemapInspector: () => null }));
vi.mock('../ReverbZoneInspector', () => ({ ReverbZoneInspector: () => null }));
vi.mock('../EditModeInspector', () => ({ EditModeInspector: () => null }));
vi.mock('../AdaptiveMusicInspector', () => ({ __esModule: true, default: () => null }));
vi.mock('../LodInspector', () => ({ LodInspector: () => null }));
vi.mock('@/lib/transformClipboard', () => ({
  copyTransformProperty: vi.fn(),
  copyFullTransform: vi.fn(),
  getPropertyFromClipboard: vi.fn(),
  readTransformFromClipboard: vi.fn(),
}));

const mockRenameEntity = vi.fn();

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'ent-1',
      primaryName: 'MyCube',
      primaryTransform: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      primaryLight: null,
      updateTransform: vi.fn(),
      renameEntity: mockRenameEntity,
      allScripts: {},
      projectType: '3d',
      sceneGraph: { nodes: { 'ent-1': { components: [] } }, rootIds: ['ent-1'] },
      skeletons2d: {},
    };
    return selector(state);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useChatStore).mockImplementation((selector: any) =>
    selector({ setRightPanelTab: vi.fn() }),
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
    expect(results).toHaveNoViolations();
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
  });
});
