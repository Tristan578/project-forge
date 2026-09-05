/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { AudioInspector } from '../AudioInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

// Capability gate (#9117): default "available"; the music-gated case flips it.
vi.mock('@/hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false })),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    navigateDocs: vi.fn(),
  })),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

vi.mock('../GenerateSoundDialog', () => ({ GenerateSoundDialog: () => null }));
vi.mock('../GenerateMusicDialog', () => ({ GenerateMusicDialog: () => null }));
vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';
import { useUserStore } from '@/stores/userStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: 'ent-1',
    entityAudio: {},
    assetRegistry: {},
    audioBuses: [{ name: 'master', volume: 1 }, { name: 'sfx', volume: 1 }],
    setAudio: vi.fn(),
    removeAudio: vi.fn(),
    playAudio: vi.fn(),
    stopAudio: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('AudioInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows Add Audio button when no audio is attached', () => {
    mockEditorStore();
    render(<AudioInspector />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Add Audio')).toBeInTheDocument();
  });

  it('shows audio controls when audio data exists', () => {
    mockEditorStore({
      entityAudio: {
        'ent-1': {
          assetId: null,
          volume: 1.0,
          pitch: 1.0,
          loopAudio: false,
          spatial: false,
          maxDistance: 50,
          refDistance: 1,
          rolloffFactor: 1,
          autoplay: false,
        },
      },
    });
    render(<AudioInspector />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Pitch')).toBeInTheDocument();
    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Remove Audio')).toBeInTheDocument();
  });

  it('reads the selected entity, not whichever entity reported audio last', () => {
    // The store used to keep one component for the whole scene, so selecting a
    // silent entity showed the other entity's sound and editing it wrote to the
    // wrong entity. Here only 'ent-2' has audio and 'ent-1' is selected.
    mockEditorStore({
      entityAudio: {
        'ent-2': {
          assetId: 'audio-2',
          volume: 0.5,
          pitch: 1.0,
          loopAudio: false,
          spatial: false,
          maxDistance: 50,
          refDistance: 1,
          rolloffFactor: 1,
          autoplay: false,
        },
      },
    });
    render(<AudioInspector />);
    expect(screen.getByText('Add Audio')).toBeInTheDocument();
    expect(screen.queryByText('Remove Audio')).not.toBeInTheDocument();
  });

  it('shows spatial audio settings when spatial is enabled', () => {
    mockEditorStore({
      entityAudio: {
        'ent-1': {
          assetId: null,
          volume: 1.0,
          pitch: 1.0,
          loopAudio: false,
          spatial: true,
          maxDistance: 50,
          refDistance: 1,
          rolloffFactor: 1,
          autoplay: false,
        },
      },
    });
    render(<AudioInspector />);
    expect(screen.getByText('Max Distance')).toBeInTheDocument();
    expect(screen.getByText('Ref Distance')).toBeInTheDocument();
    expect(screen.getByText('Rolloff')).toBeInTheDocument();
  });

  it('names the tier a locked generate button needs, not just in the tooltip', () => {
    // The buttons stay focusable when locked (aria-disabled, not disabled) so
    // they can still make their pitch — but `title` is unreachable by keyboard,
    // so the requirement has to be in the accessible name.
    mockEditorStore();
    useUserStore.setState({ tier: 'starter' });
    render(<AudioInspector />);
    expect(
      screen.getByRole('button', { name: 'Generate sound with AI — requires Starter tier' })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('button', { name: 'Generate music with AI — requires Starter tier' })
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('drops the tier clause once the tier actually allows it', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    render(<AudioInspector />);
    expect(
      screen.getByRole('button', { name: 'Generate sound with AI' })
    ).not.toHaveAttribute('aria-disabled');
  });
});
