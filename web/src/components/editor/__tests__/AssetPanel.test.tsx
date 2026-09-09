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

// Capability gate (#9117): default "available"; the gate describe below flips
// it. Only `useGenerationGate` is stubbed — `combineGenerationGates` is pure
// and comes through real, because stubbing it would make the Sound item's
// sfx-OR-voice rule untestable.
vi.mock('@/hooks/useGenerationGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false })),
}));
import { useGenerationGate } from '@/hooks/useGenerationGate';

/** The default "nothing is blocked" gate result. */
const OPEN = { blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false } as const;

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

describe('AssetPanel generation gate (#9117)', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useGenerationGate).mockImplementation(() => OPEN);
  });

  it('disables only the Generate Music item, with an Unavailable badge and the reason in its accessible name', () => {
    // Every menu item asks the gate for its own capability; only music is blocked here.
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'music-generation'
        ? { blocked: true, reason: 'Music generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
    );
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    const music = screen.getByRole('menuitem', { name: /Generate Music — Music generation is not available yet\./ });
    expect(music).toHaveAttribute('aria-disabled', 'true');
    expect(music).toHaveTextContent('Unavailable');
    expect(music).not.toHaveTextContent(/Hobbyist|Creator|Pro/);
    expect(screen.getByRole('menuitem', { name: 'Generate 3D Model' })).not.toHaveAttribute('aria-disabled');
  });

  it('gates every item by its own capability — a texture gate disables Texture AND Skybox, nothing else', () => {
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'texture-generation'
        ? { blocked: true, reason: 'Texture generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
    );
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    expect(screen.getByRole('menuitem', { name: /Generate Texture — Texture generation is not available yet\./ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /Generate Skybox — Texture generation is not available yet\./ })).toHaveAttribute('aria-disabled', 'true');
    for (const name of ['Generate 3D Model', 'Generate Sound', 'Generate Music']) {
      expect(screen.getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled');
    }
    vi.mocked(useGenerationGate).mockImplementation(() => OPEN);
  });

  // A missing platform key is not a dead end: the user can add their own key.
  // Disabling the entry point put the ONLY copy of that instruction inside a
  // dialog the click could no longer open, and made "not offered (#9522)" and
  // "add your own key" read identically (#9725 p7).
  it('keeps a merely unconfigured capability clickable so the dialog notice stays reachable', () => {
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'model-generation'
        ? {
            blocked: true,
            reason: 'Configure Meshy API key in Settings to enable 3D Model Generation.',
            loading: false,
            unprovisionable: false,
            byokConfigurable: true,
          }
        : OPEN,
    );
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    const model = screen.getByRole('menuitem', { name: 'Generate 3D Model' });
    expect(model).not.toHaveAttribute('aria-disabled');
    expect(model).not.toHaveTextContent('Unavailable');
    fireEvent.click(model);
    expect(screen.getByTestId('gen-model-dialog')).toBeInTheDocument();
  });

  // The Sound dialog covers sfx AND voice, so this item closes only when
  // NEITHER can run — otherwise declaring sfx unavailable would take voice
  // generation off the UI with it (#9725 p8).
  it('keeps Generate Sound clickable while voice is still available', () => {
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation'
        ? { blocked: true, reason: 'Sound effect generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
    );
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    const sound = screen.getByRole('menuitem', { name: 'Generate Sound' });
    expect(sound).not.toHaveAttribute('aria-disabled');
    expect(sound).not.toHaveTextContent('Unavailable');
    fireEvent.click(sound);
    expect(screen.getByTestId('gen-sound-dialog')).toBeInTheDocument();
  });

  it('disables Generate Sound once neither sfx nor voice can run', () => {
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation' || featureId === 'voice-generation'
        ? { blocked: true, reason: 'Sound effect generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
    );
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    const sound = screen.getByRole('menuitem', { name: /Generate Sound — Sound effect generation is not available yet\./ });
    expect(sound).toHaveAttribute('aria-disabled', 'true');
    expect(sound).toHaveTextContent('Unavailable');
  });

  // First paint of a fresh session: `blocked` is false until the body lands, so
  // the item used to look ready and then flip to a disabled amber badge.
  it('does not present a ready menu item while the gate is still loading', () => {
    vi.mocked(useGenerationGate).mockImplementation(() => ({
      blocked: false, reason: undefined, loading: true, unprovisionable: false, byokConfigurable: false,
    }));
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));
    const music = screen.getByRole('menuitem', { name: 'Generate Music — checking availability' });
    expect(music).toHaveAttribute('aria-disabled', 'true');
    expect(music).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(music);
    expect(screen.queryByTestId('gen-music-dialog')).toBeNull();
  });
});

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
