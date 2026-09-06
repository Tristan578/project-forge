/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { AudioInspector } from '../AudioInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

// Capability gate (#9117): default "available"; the gate describe at the end flips it.
vi.mock('@/hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false })),
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

vi.mock('../GenerateSoundDialog', () => ({
  GenerateSoundDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="sound-dialog-stub" /> : null,
}));
// Renders a marker only when opened, so a test can prove a gated click did NOT
// open it (a `() => null` stub would make that assertion vacuous).
vi.mock('../GenerateMusicDialog', () => ({
  GenerateMusicDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="music-dialog-stub" /> : null,
}));
vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';
import { useUserStore } from '@/stores/userStore';
import { useGenerationGate } from '@/hooks/useGenerationGate';

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

describe('AudioInspector music gate (#9117)', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useGenerationGate).mockImplementation(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false }));
  });

  it('gates the Sound button by its own capability too', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation'
        ? { blocked: true, reason: 'Sound effect generation is not available yet.', loading: false, unprovisionable: true }
        : { blocked: false, reason: undefined, loading: false, unprovisionable: false },
    );
    render(<AudioInspector />);
    const sound = screen.getByRole('button', { name: 'Generate sound with AI — Sound effect generation is not available yet.' });
    expect(sound).toHaveAttribute('aria-disabled', 'true');
    expect(sound).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Generate music with AI' })).not.toHaveAttribute('aria-disabled');
  });

  it('disables the Music button with the reason in its name and a distinct Unavailable badge, and never opens the dialog', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    // Both buttons ask the gate for their own capability; only music is blocked here.
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'music-generation'
        ? { blocked: true, reason: 'Music generation is not available yet.', loading: false, unprovisionable: true }
        : { blocked: false, reason: undefined, loading: false, unprovisionable: false },
    );
    render(<AudioInspector />);
    const btn = screen.getByRole('button', { name: 'Generate music with AI — Music generation is not available yet.' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveTextContent('Unavailable');
    expect(btn).not.toHaveTextContent(/tier/);
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The sibling Sound button is untouched by the music gate.
    expect(screen.getByRole('button', { name: 'Generate sound with AI' })).not.toHaveAttribute('aria-disabled');
  });

  // Same reasoning as the Asset panel: a missing key is fixable, so the button
  // opens the dialog whose notice names the provider and links to Settings.
  it('keeps a merely unconfigured capability clickable and opens its dialog', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation'
        ? {
            blocked: true,
            reason: 'Configure ElevenLabs API key in Settings to enable Sound Effect Generation.',
            loading: false,
            unprovisionable: false,
          }
        : { blocked: false, reason: undefined, loading: false, unprovisionable: false },
    );
    render(<AudioInspector />);
    const sound = screen.getByRole('button', { name: 'Generate sound with AI' });
    expect(sound).not.toHaveAttribute('aria-disabled');
    expect(sound).not.toHaveTextContent('Unavailable');
    fireEvent.click(sound);
    expect(screen.getByRole('dialog', { name: 'sound-dialog-stub' })).toBeInTheDocument();
  });
});
