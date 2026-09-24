/**
 * Tests for AssetPanel's tier gate against a trial-token starter account
 * (#7715). `AssetPanel.test.tsx` mocks `@/lib/ai/tierAccess` and
 * `@/stores/userStore` at the file level (`canAccessPanel: vi.fn(() => true)`,
 * an identity `effectiveTier` stub), so nothing there exercises the actual
 * lock — this file uses the REAL tierAccess module and the real userStore so
 * `effectiveTier` runs for real, in its own file so the two mock sets never
 * collide with `AssetPanel.test.tsx`'s file-level `vi.mock` calls.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AssetPanel } from '../AssetPanel';
import { useEditorStore } from '@/stores/editorStore';
import { useUserStore } from '@/stores/userStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

// Capability gate (#9117) — always "available" here so only the tier gate
// under test can disable a menu item.
vi.mock('@/hooks/useGenerationGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false })),
}));

vi.mock('../MaterialLibraryPanel', () => ({
  MaterialLibraryPanel: () => <div data-testid="material-library">Material Library</div>,
}));

vi.mock('@/components/editor/PrefabLibraryPanel', () => ({
  PrefabLibraryPanel: () => <div data-testid="prefab-library">Prefab Library</div>,
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

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) =>
    selector({
      assetRegistry: {},
      importGltf: vi.fn(),
      loadTexture: vi.fn(),
      importAudio: vi.fn(),
      placeAsset: vi.fn(),
      deleteAsset: vi.fn(),
      primaryId: 'ent-1',
    })
  );
}

describe('AssetPanel trial access (#7715)', () => {
  const initialUserState = useUserStore.getState();

  afterEach(() => {
    cleanup();
    useUserStore.setState(initialUserState, true);
  });

  // 'generate-texture' is hobbyist-gated (PANEL_TIER_REQUIREMENTS) — a
  // starter account with spendable trial tokens reads as hobbyist through
  // the real `effectiveTier`, so this item must unlock.
  it('unlocks a hobbyist-gated generate item for a starter account with spendable trial tokens', () => {
    useUserStore.setState({ tier: 'starter', spendableTokens: 50, profileLoaded: true });
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));

    const texture = screen.getByRole('menuitem', { name: 'Generate Texture' });
    expect(texture).not.toHaveAttribute('aria-disabled');
    expect(texture).not.toHaveTextContent('Unavailable');
  });

  it('keeps a hobbyist-gated generate item locked for a starter account with no spendable tokens', () => {
    useUserStore.setState({ tier: 'starter', spendableTokens: 0, profileLoaded: true });
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));

    // Locked (but not capability-gated) items get no `aria-label` — the
    // accessible name is the visible text, which includes the lock badge's
    // required-tier label appended after the item's own label.
    const texture = screen.getByRole('menuitem', { name: /^Generate Texture/ });
    expect(texture).toHaveAttribute('aria-disabled', 'true');
    expect(texture).not.toHaveTextContent('Unavailable');
    fireEvent.click(texture);
    expect(screen.queryByTestId('gen-texture-dialog')).toBeNull();
  });

  // #7715 review round 2 — before /api/user/profile resolves, `tier`/
  // `spendableTokens` read their store defaults ('starter'/0), which is
  // indistinguishable from "no trial access". The lock badge must not flash
  // for that one render.
  it('does not lock a hobbyist-gated generate item while the profile is still loading', () => {
    useUserStore.setState({ tier: 'starter', spendableTokens: 0, profileLoaded: false });
    setupStore();
    render(<AssetPanel />);
    fireEvent.click(screen.getByLabelText('AI Generate'));

    const texture = screen.getByRole('menuitem', { name: 'Generate Texture' });
    expect(texture).not.toHaveAttribute('aria-disabled');
    expect(texture).not.toHaveTextContent('Unavailable');
  });
});
