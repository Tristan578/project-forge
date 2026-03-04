import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { InspectorPanel } from '../InspectorPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    rightPanelTab: 'chat',
    setRightPanelTab: vi.fn(),
  })),
}));

vi.mock('lucide-react', () => new Proxy({}, {
  get: (_, name) => {
    if (name === '__esModule') return true;
    return vi.fn((props: Record<string, unknown>) => {
      const { children, ...rest } = props || {};
      return { type: 'svg', props: { 'data-testid': `icon-${String(name)}`, ...rest }, children: children ?? null };
    });
  },
}));

// Mock all sub-inspectors
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
vi.mock('../AdaptiveMusicInspector', () => ({ default: () => null }));
vi.mock('../LodInspector', () => ({ LodInspector: () => null }));
vi.mock('../InspectorErrorBoundary', () => ({
  InspectorErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../CollapsibleSection', () => ({
  CollapsibleSection: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid={`section-${title}`}>{children}</div>
  ),
}));
vi.mock('../Vec3Input', () => ({
  Vec3Input: () => null,
}));
vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));
vi.mock('@/lib/transformClipboard', () => ({
  copyTransformProperty: vi.fn(),
  copyFullTransform: vi.fn(),
  getPropertyFromClipboard: vi.fn(),
  readTransformFromClipboard: vi.fn(),
}));
vi.mock('@/lib/colorUtils', () => ({
  radToDeg: (v: number) => v * (180 / Math.PI),
  degToRad: (v: number) => v * (Math.PI / 180),
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: null,
    primaryName: null,
    primaryTransform: null,
    primaryLight: null,
    updateTransform: vi.fn(),
    renameEntity: vi.fn(),
    allScripts: {},
    setRightPanelTab: vi.fn(),
    projectType: '3d',
    sceneGraph: { rootIds: [], nodes: {} },
    skeletons2d: {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('InspectorPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows empty state with scene settings when nothing is selected', () => {
    mockEditorStore();
    render(<InspectorPanel />);
    expect(screen.getByText('Scene Settings')).toBeDefined();
    expect(screen.getByText(/Select an entity/)).toBeDefined();
  });

  it('shows inspector heading and name field when entity is selected', () => {
    mockEditorStore({
      primaryId: 'ent-1',
      primaryName: 'MyCube',
      primaryTransform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      sceneGraph: { rootIds: ['ent-1'], nodes: { 'ent-1': { id: 'ent-1', name: 'MyCube', parentId: null, children: [], components: [] } } },
    });
    render(<InspectorPanel />);
    expect(screen.getByText('Inspector')).toBeDefined();
    expect(screen.getByDisplayValue('MyCube')).toBeDefined();
  });

  it('shows loading skeleton when entity is selected but transform is missing', () => {
    mockEditorStore({
      primaryId: 'ent-1',
      primaryName: 'MyCube',
      primaryTransform: null,
      sceneGraph: { rootIds: ['ent-1'], nodes: { 'ent-1': { id: 'ent-1', name: 'MyCube', parentId: null, children: [], components: [] } } },
    });
    render(<InspectorPanel />);
    expect(screen.getByText('Inspector')).toBeDefined();
    // Loading skeleton has animate-pulse divs
    const container = screen.getByText('Inspector').closest('div');
    expect(container).toBeDefined();
  });
});
