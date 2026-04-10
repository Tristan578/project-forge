/**
 * Tests for AssetPanel — tabs, asset cards, AI generate dropdown,
 * import buttons, drag-and-drop, empty state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AssetPanel } from '../AssetPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn((selector: (s: { tier: string }) => unknown) =>
    selector({ tier: 'pro' }),
  ),
}));

vi.mock('@/lib/ai/tierAccess', () => ({
  canAccessPanel: vi.fn(() => true),
  getRequiredTier: vi.fn(() => null),
  TIER_LABELS: { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' },
}));

vi.mock('../MaterialLibraryPanel', () => ({
  MaterialLibraryPanel: () => <div data-testid="material-library">Material Library</div>,
}));

vi.mock('../GenerateModelDialog', () => ({
  GenerateModelDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="gen-model-dialog">GenModel</div> : null,
}));

vi.mock('../GenerateTextureDialog', () => ({
  GenerateTextureDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="gen-texture-dialog">GenTexture</div> : null,
}));

vi.mock('../GenerateSoundDialog', () => ({
  GenerateSoundDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="gen-sound-dialog">GenSound</div> : null,
}));

vi.mock('../GenerateMusicDialog', () => ({
  GenerateMusicDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="gen-music-dialog">GenMusic</div> : null,
}));

vi.mock('../GenerateSkyboxDialog', () => ({
  GenerateSkyboxDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="gen-skybox-dialog">GenSkybox</div> : null,
}));

const mockImportGltf = vi.fn();
const mockLoadTexture = vi.fn();
const mockImportAudio = vi.fn();
const mockPlaceAsset = vi.fn();
const mockDeleteAsset = vi.fn();

function setupStore(overrides: {
  assets?: Record<string, { id: string; name: string; kind: string; fileSize: number }>;
  primaryId?: string | null;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      assetRegistry: overrides.assets ?? {},
      importGltf: mockImportGltf,
      loadTexture: mockLoadTexture,
      importAudio: mockImportAudio,
      placeAsset: mockPlaceAsset,
      deleteAsset: mockDeleteAsset,
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
    };
    return selector(state);
  });
}

describe('AssetPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders Assets and Materials tabs', () => {
    setupStore();
    render(<AssetPanel />);
    expect(screen.getByText('Assets').textContent).toBe('Assets');
    expect(screen.getByText('Materials').textContent).toBe('Materials');
  });

  it('shows empty state when no assets', () => {
    setupStore();
    render(<AssetPanel />);
    expect(screen.getByText(/No assets imported/)).toBeInTheDocument();
  });

  it('renders import buttons on assets tab', () => {
    setupStore();
    render(<AssetPanel />);
    expect(screen.getByLabelText('Import 3D model')).toBeInTheDocument();
    expect(screen.getByLabelText('Import texture')).toBeInTheDocument();
    expect(screen.getByLabelText('Import audio')).toBeInTheDocument();
  });

  it('renders AI generate button', () => {
    setupStore();
    render(<AssetPanel />);
    expect(screen.getByLabelText('AI Generate')).toBeInTheDocument();
  });

  // ── Tab switching ─────────────────────────────────────────────────────

  it('switches to Materials tab', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByText('Materials'));
    expect(screen.getByTestId('material-library')).toBeInTheDocument();
  });

  it('hides import buttons on materials tab', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByText('Materials'));
    expect(screen.queryByLabelText('Import 3D model')).toBeNull();
  });

  it('switches back to Assets tab', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByText('Materials'));
    fireEvent.click(screen.getByText('Assets'));
    expect(screen.getByText(/No assets imported/)).toBeInTheDocument();
  });

  // ── Asset cards ───────────────────────────────────────────────────────

  it('renders asset cards when assets exist', () => {
    setupStore({
      assets: {
        'asset-1': { id: 'asset-1', name: 'hero.glb', kind: 'gltf_model', fileSize: 1024 },
        'asset-2': { id: 'asset-2', name: 'floor.png', kind: 'texture', fileSize: 2048 },
      },
    });
    render(<AssetPanel />);
    expect(screen.getByText('hero.glb').textContent).toBe('hero.glb');
    expect(screen.getByText('floor.png').textContent).toBe('floor.png');
    expect(screen.getByText('1.0 KB').textContent).toBe('1.0 KB');
    expect(screen.getByText('2.0 KB').textContent).toBe('2.0 KB');
  });

  it('places gltf asset on click', () => {
    setupStore({
      assets: {
        'asset-1': { id: 'asset-1', name: 'hero.glb', kind: 'gltf_model', fileSize: 1024 },
      },
    });
    render(<AssetPanel />);
    fireEvent.click(screen.getByText('hero.glb'));
    expect(mockPlaceAsset).toHaveBeenCalledWith('asset-1');
  });

  it('delete button calls deleteAsset', () => {
    setupStore({
      assets: {
        'asset-1': { id: 'asset-1', name: 'hero.glb', kind: 'gltf_model', fileSize: 1024 },
      },
    });
    render(<AssetPanel />);
    const deleteBtn = screen.getByLabelText('Delete asset hero.glb');
    fireEvent.click(deleteBtn);
    expect(mockDeleteAsset).toHaveBeenCalledWith('asset-1');
  });

  // ── AI Generate dropdown ──────────────────────────────────────────────

  it('opens AI dropdown and shows generation options', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    expect(screen.getByText('Generate 3D Model').textContent).toBe('Generate 3D Model');
    expect(screen.getByText('Generate Texture').textContent).toBe('Generate Texture');
    expect(screen.getByText('Generate Sound').textContent).toBe('Generate Sound');
    expect(screen.getByText('Generate Music').textContent).toBe('Generate Music');
    expect(screen.getByText('Generate Skybox').textContent).toBe('Generate Skybox');
  });

  it('opens Generate 3D Model dialog', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    fireEvent.click(screen.getByText('Generate 3D Model'));
    expect(screen.getByTestId('gen-model-dialog')).toBeInTheDocument();
  });

  it('opens Generate Skybox dialog', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    fireEvent.click(screen.getByText('Generate Skybox'));
    expect(screen.getByTestId('gen-skybox-dialog')).toBeInTheDocument();
  });

  it('closes AI dropdown after selecting an option', () => {
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    fireEvent.click(screen.getByText('Generate 3D Model'));
    // Dropdown should be closed
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // ── Drag and drop ─────────────────────────────────────────────────────

  it('shows drag overlay on dragEnter', () => {
    setupStore();
    const { container } = render(<AssetPanel />);
    const panel = container.firstElementChild!;
    fireEvent.dragEnter(panel, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(screen.getByText('Drop to import').textContent).toBe('Drop to import');
  });

  it('hides drag overlay on dragLeave', () => {
    setupStore();
    const { container } = render(<AssetPanel />);
    const panel = container.firstElementChild!;
    fireEvent.dragEnter(panel, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
    fireEvent.dragLeave(panel, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(screen.queryByText('Drop to import')).toBeNull();
  });

  // ── File size formatting ──────────────────────────────────────────────

  it('formats bytes correctly', () => {
    setupStore({
      assets: {
        'a': { id: 'a', name: 'tiny.png', kind: 'texture', fileSize: 500 },
        'b': { id: 'b', name: 'medium.glb', kind: 'gltf_model', fileSize: 1500000 },
      },
    });
    render(<AssetPanel />);
    expect(screen.getByText('500 B').textContent).toBe('500 B');
    expect(screen.getByText('1.4 MB').textContent).toBe('1.4 MB');
  });
});
