/**
 * Tests for InspectorPanel — no selection, entity selected with transform,
 * name editing, script section, 2D vs 3D conditional rendering, loading skeleton.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { InspectorPanel } from '../InspectorPanel';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

// Mock all sub-inspectors to avoid deep dependency chains
vi.mock('../Vec3Input', () => ({
  Vec3Input: ({ label }: { label: string }) => <div data-testid={`vec3-${label}`}>{label}</div>,
}));
vi.mock('../LightInspector', () => ({ LightInspector: () => <div>LightInspector</div> }));
vi.mock('../MaterialInspector', () => ({ MaterialInspector: () => <div>MaterialInspector</div> }));
vi.mock('../SceneSettings', () => ({ SceneSettings: () => <div>SceneSettings</div> }));
vi.mock('../InputBindingsPanel', () => ({ InputBindingsPanel: () => <div>InputBindingsPanel</div> }));
vi.mock('../PhysicsInspector', () => ({ PhysicsInspector: () => <div>PhysicsInspector</div> }));
vi.mock('../Physics2dInspector', () => ({ Physics2dInspector: () => <div>Physics2dInspector</div> }));
vi.mock('../AudioInspector', () => ({ AudioInspector: () => <div>AudioInspector</div> }));
vi.mock('../ParticleInspector', () => ({ ParticleInspector: () => <div>ParticleInspector</div> }));
vi.mock('../AnimationInspector', () => ({ AnimationInspector: () => <div>AnimationInspector</div> }));
vi.mock('../AnimationClipInspector', () => ({ AnimationClipInspector: () => <div>AnimationClipInspector</div> }));
vi.mock('../TerrainInspector', () => ({ TerrainInspector: () => <div>TerrainInspector</div> }));
vi.mock('../JointInspector', () => ({ JointInspector: () => <div>JointInspector</div> }));
vi.mock('../GameComponentInspector', () => ({ GameComponentInspector: () => <div>GameComponentInspector</div> }));
vi.mock('../GameCameraInspector', () => ({ GameCameraInspector: () => <div>GameCameraInspector</div> }));
vi.mock('../SpriteInspector', () => ({ SpriteInspector: () => <div>SpriteInspector</div> }));
vi.mock('../SpriteAnimationInspector', () => ({ SpriteAnimationInspector: () => <div>SpriteAnimationInspector</div> }));
vi.mock('../SkeletonInspector', () => ({ SkeletonInspector: () => <div>SkeletonInspector</div> }));
vi.mock('../Camera2dInspector', () => ({ Camera2dInspector: () => <div>Camera2dInspector</div> }));
vi.mock('../TilemapInspector', () => ({ TilemapInspector: () => <div>TilemapInspector</div> }));
vi.mock('../ReverbZoneInspector', () => ({ ReverbZoneInspector: () => <div>ReverbZoneInspector</div> }));
vi.mock('../EditModeInspector', () => ({ EditModeInspector: () => <div>EditModeInspector</div> }));
vi.mock('../AdaptiveMusicInspector', () => ({ __esModule: true, default: () => <div>AdaptiveMusicInspector</div> }));
vi.mock('../LodInspector', () => ({ LodInspector: () => <div>LodInspector</div> }));
vi.mock('../InspectorErrorBoundary', () => ({
  InspectorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../CollapsibleSection', () => ({
  CollapsibleSection: ({ title, children, headerRight }: { title: string; children: React.ReactNode; headerRight?: React.ReactNode }) => (
    <div data-testid={`section-${title}`}>
      <div>{title}{headerRight}</div>
      {children}
    </div>
  ),
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

const mockUpdateTransform = vi.fn();
const mockRenameEntity = vi.fn();
const mockSetRightPanelTab = vi.fn();

function setupStore(overrides: {
  primaryId?: string | null;
  primaryName?: string | null;
  primaryTransform?: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null;
  primaryLight?: unknown;
  allScripts?: Record<string, { source: string; enabled: boolean } | undefined>;
  projectType?: '2d' | '3d';
  sceneGraph?: { nodes: Record<string, { components: string[] }> };
  skeletons2d?: Record<string, unknown>;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryName: overrides.primaryName ?? 'MyCube',
      primaryTransform: 'primaryTransform' in overrides ? overrides.primaryTransform : {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      primaryLight: overrides.primaryLight ?? null,
      updateTransform: mockUpdateTransform,
      renameEntity: mockRenameEntity,
      allScripts: overrides.allScripts ?? {},
      projectType: overrides.projectType ?? '3d',
      sceneGraph: overrides.sceneGraph ?? { nodes: { 'ent-1': { components: [] } } },
      skeletons2d: overrides.skeletons2d ?? {},
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useChatStore).mockImplementation((selector: any) => {
    const state = { setRightPanelTab: mockSetRightPanelTab };
    return selector(state);
  });
}

describe('InspectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── No entity selected ────────────────────────────────────────────────

  it('shows empty state hint when no entity selected', () => {
    setupStore({ primaryId: null });
    render(<InspectorPanel />);
    expect(screen.getByText(/Select an entity/)).toBeDefined();
  });

  it('shows Scene Settings when no entity selected', () => {
    setupStore({ primaryId: null });
    render(<InspectorPanel />);
    expect(screen.getByText('Scene Settings')).toBeDefined();
    expect(screen.getByText('SceneSettings')).toBeDefined();
  });

  it('shows InputBindingsPanel when no entity selected', () => {
    setupStore({ primaryId: null });
    render(<InspectorPanel />);
    expect(screen.getByText('InputBindingsPanel')).toBeDefined();
  });

  // ── Entity selected ───────────────────────────────────────────────────

  it('renders Inspector heading', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('Inspector')).toBeDefined();
  });

  it('renders entity name input', () => {
    setupStore();
    render(<InspectorPanel />);
    const nameInput = screen.getByDisplayValue('MyCube');
    expect(nameInput).toBeDefined();
  });

  it('renames entity on blur', () => {
    setupStore();
    render(<InspectorPanel />);
    const nameInput = screen.getByDisplayValue('MyCube');
    fireEvent.change(nameInput, { target: { value: 'MySphere' } });
    fireEvent.blur(nameInput);
    expect(mockRenameEntity).toHaveBeenCalledWith('ent-1', 'MySphere');
  });

  it('renames entity on Enter key', () => {
    setupStore();
    render(<InspectorPanel />);
    const nameInput = screen.getByDisplayValue('MyCube');
    fireEvent.change(nameInput, { target: { value: 'NewName' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    // Enter triggers blur() which calls handleNameBlur -> renameEntity
    fireEvent.blur(nameInput);
    expect(mockRenameEntity).toHaveBeenCalledWith('ent-1', 'NewName');
  });

  it('reverts name on Escape key', () => {
    setupStore();
    render(<InspectorPanel />);
    const nameInput = screen.getByDisplayValue('MyCube') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'TempName' } });
    fireEvent.keyDown(nameInput, { key: 'Escape' });
    expect(nameInput.value).toBe('MyCube');
  });

  // ── Transform section ─────────────────────────────────────────────────

  it('renders Transform collapsible section with Vec3 inputs', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('Transform')).toBeDefined();
    expect(screen.getByTestId('vec3-Position')).toBeDefined();
    expect(screen.getByTestId('vec3-Rotation')).toBeDefined();
    expect(screen.getByTestId('vec3-Scale')).toBeDefined();
  });

  // ── Loading skeleton ──────────────────────────────────────────────────

  it('shows loading skeleton when no transform yet', () => {
    setupStore({ primaryTransform: null });
    render(<InspectorPanel />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ── 3D project sections ───────────────────────────────────────────────

  it('renders Material section for non-light 3D entity', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('MaterialInspector')).toBeDefined();
  });

  it('renders Light section instead of Material for light entity', () => {
    setupStore({ primaryLight: { type: 'point', color: '#fff', intensity: 1 } });
    render(<InspectorPanel />);
    expect(screen.getByText('LightInspector')).toBeDefined();
    expect(screen.queryByText('MaterialInspector')).toBeNull();
  });

  it('renders Physics section in 3D', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('PhysicsInspector')).toBeDefined();
  });

  it('renders Audio section', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('AudioInspector')).toBeDefined();
  });

  it('renders Particle section', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('ParticleInspector')).toBeDefined();
  });

  it('renders Animation sections', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('AnimationInspector')).toBeDefined();
    expect(screen.getByText('AnimationClipInspector')).toBeDefined();
  });

  it('renders Game Components and Camera sections', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('GameComponentInspector')).toBeDefined();
    expect(screen.getByText('GameCameraInspector')).toBeDefined();
  });

  // ── 2D project sections ───────────────────────────────────────────────

  it('renders Sprite section for 2D sprite entity', () => {
    setupStore({
      projectType: '2d',
      sceneGraph: { nodes: { 'ent-1': { components: ['Sprite'] } } },
    });
    render(<InspectorPanel />);
    expect(screen.getByText('SpriteInspector')).toBeDefined();
    expect(screen.getByText('SpriteAnimationInspector')).toBeDefined();
  });

  it('renders Physics2d in 2D project', () => {
    setupStore({ projectType: '2d' });
    render(<InspectorPanel />);
    expect(screen.getByText('Physics2dInspector')).toBeDefined();
  });

  it('renders Tilemap section in 2D', () => {
    setupStore({ projectType: '2d' });
    render(<InspectorPanel />);
    expect(screen.getByText('TilemapInspector')).toBeDefined();
  });

  it('does not render Light/Material in 2D', () => {
    setupStore({ projectType: '2d' });
    render(<InspectorPanel />);
    expect(screen.queryByText('LightInspector')).toBeNull();
    expect(screen.queryByText('MaterialInspector')).toBeNull();
  });

  // ── Script section ────────────────────────────────────────────────────

  it('renders Script section with Add Script button', () => {
    setupStore();
    render(<InspectorPanel />);
    expect(screen.getByText('Add Script')).toBeDefined();
  });

  it('renders Edit Script when entity has script', () => {
    setupStore({ allScripts: { 'ent-1': { source: 'code', enabled: true } } });
    render(<InspectorPanel />);
    expect(screen.getByText('Edit Script')).toBeDefined();
  });

  it('shows Active badge when entity has script', () => {
    setupStore({ allScripts: { 'ent-1': { source: 'code', enabled: true } } });
    render(<InspectorPanel />);
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('switches to script tab on Edit Script click', () => {
    setupStore({ allScripts: { 'ent-1': { source: 'code', enabled: true } } });
    render(<InspectorPanel />);
    fireEvent.click(screen.getByText('Edit Script'));
    expect(mockSetRightPanelTab).toHaveBeenCalledWith('script');
  });
});
