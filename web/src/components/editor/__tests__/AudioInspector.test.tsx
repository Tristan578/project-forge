/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { AudioInspector } from '../AudioInspector';
import { ClipEditor } from '../ClipEditor';
import { StrictMode } from 'react';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

// Capability gate (#9117): default "available"; the gate describe at the end
// flips it. Only `useGenerationGate` is stubbed — `combineGenerationGates` is
// pure and comes through as the REAL implementation, because stubbing it would
// make the Sound button's sfx-OR-voice rule untestable.
vi.mock('@/hooks/useGenerationGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false })),
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

/** The default "nothing is blocked" gate result. */
const OPEN = { blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false } as const;

describe('AudioInspector music gate (#9117)', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(useGenerationGate).mockImplementation(() => OPEN);
  });

  it('gates the Sound button when NEITHER sfx nor voice can run', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation' || featureId === 'voice-generation'
        ? { blocked: true, reason: 'Sound effect generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
    );
    render(<AudioInspector />);
    const sound = screen.getByRole('button', { name: 'Generate sound with AI — Sound effect generation is not available yet.' });
    expect(sound).toHaveAttribute('aria-disabled', 'true');
    expect(sound).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Generate music with AI' })).not.toHaveAttribute('aria-disabled');
  });

  // The Sound dialog covers sfx AND voice and deliberately keeps its type
  // radios enabled so the user can switch to whichever still works. Gating the
  // entry on sfx alone would make voice generation unreachable from the UI the
  // moment sfx were declared unavailable, and the in-dialog escape hatch
  // impossible to exercise (#9725 p8).
  it('keeps the Sound button open while voice is still available', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation'
        ? { blocked: true, reason: 'Sound effect generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
    );
    render(<AudioInspector />);
    const sound = screen.getByRole('button', { name: 'Generate sound with AI' });
    expect(sound).not.toHaveAttribute('aria-disabled');
    expect(sound).not.toHaveTextContent('Unavailable');
    fireEvent.click(sound);
    expect(screen.getByRole('dialog', { name: 'sound-dialog-stub' })).toBeInTheDocument();
  });

  // The first paint of a fresh session must not show a ready affordance that
  // then contradicts itself: while /api/capabilities is in flight `blocked` is
  // false, so both buttons used to paint enabled with a Sparkles icon and flip
  // to a disabled amber badge when the body landed (#9725 p8).
  it('does not present a ready button while the gate is still loading', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation(() => ({
      blocked: false, reason: undefined, loading: true, unprovisionable: false, byokConfigurable: false,
    }));
    render(<AudioInspector />);
    const music = screen.getByRole('button', { name: 'Generate music with AI — checking availability' });
    expect(music).toHaveAttribute('aria-disabled', 'true');
    expect(music).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(music);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the Music button with the reason in its name and a distinct Unavailable badge, and never opens the dialog', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    // Both buttons ask the gate for their own capability; only music is blocked here.
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'music-generation'
        ? { blocked: true, reason: 'Music generation is not available yet.', loading: false, unprovisionable: true, byokConfigurable: false }
        : OPEN,
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
  //
  // BOTH capabilities behind the entry are blocked here, and that is the point.
  // The Sound button reads `combineGenerationGates([sfx, voice])`, which returns
  // the first UNBLOCKED gate — so a fixture blocking only sfx leaves voice open,
  // the combiner hands back an open gate, and the button is clickable whichever
  // field the component reads. That version of this test could not fail: the
  // mutation it exists to catch (`!gate.unprovisionable` -> `!gate.blocked`)
  // broke zero tests here, while the same mutation in `AssetPanel` was caught.
  // It was asserting the combiner, which the case above already covers, and
  // pinning nothing of its own (lessons-learned #11).
  const UNCONFIGURED = {
    blocked: true,
    reason: 'Configure ElevenLabs API key in Settings to enable Sound Effect Generation.',
    loading: false,
    unprovisionable: false,
    byokConfigurable: true,
  };

  it('keeps a merely unconfigured capability clickable and opens its dialog', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'sfx-generation' || featureId === 'voice-generation' ? UNCONFIGURED : OPEN,
    );
    render(<AudioInspector />);
    const sound = screen.getByRole('button', { name: 'Generate sound with AI' });
    expect(sound).not.toHaveAttribute('aria-disabled');
    expect(sound).not.toHaveTextContent('Unavailable');
    fireEvent.click(sound);
    expect(screen.getByRole('dialog', { name: 'sound-dialog-stub' })).toBeInTheDocument();
  });

  // The Music button had no case for this state at all, and it is the one where
  // it matters most: music reaches ONE capability, so nothing masks a wrong
  // read. Regressing it strands a BYOK-fixable capability behind a closed
  // button, and that dialog's notice is the only place the provider is named
  // and Settings is offered — #9725 p7, reintroduced silently.
  it('keeps a merely unconfigured MUSIC capability clickable and opens its dialog', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'creator' });
    vi.mocked(useGenerationGate).mockImplementation((featureId) =>
      featureId === 'music-generation'
        ? { ...UNCONFIGURED, reason: 'Configure an ElevenLabs API key in Settings to enable Music Generation.' }
        : OPEN,
    );
    render(<AudioInspector />);
    const music = screen.getByRole('button', { name: 'Generate music with AI' });
    expect(music).not.toHaveAttribute('aria-disabled');
    expect(music).not.toHaveTextContent('Unavailable');
    fireEvent.click(music);
    expect(screen.getByRole('dialog', { name: 'music-dialog-stub' })).toBeInTheDocument();
  });

  // The default state for every free-tier user in production today: the tier
  // locks the button AND the capability has no platform key, so `blocked` is
  // true while `unprovisionable` is false. Keying the badge on `blocked` and
  // the accessible name on `unprovisionable` made the two contradict each
  // other — an amber "Unavailable" (we do not offer this) beside a name
  // saying "requires Starter tier" (buy a plan), with the Lock + tier chip
  // every other locked control shows gone, and the visible word "Unavailable"
  // absent from the accessible name (WCAG 2.5.3). Both must read from
  // `unprovisionable`, as AssetPanel already does (#9725 p8).
  it.each(['sound', 'music'] as const)(
    'shows the tier lock, not an Unavailable badge, when a tier-locked %s capability is merely unconfigured',
    (which) => {
      mockEditorStore();
      useUserStore.setState({ tier: 'starter' });
      vi.mocked(useGenerationGate).mockImplementation(() => ({
        blocked: true,
        reason: 'Configure ElevenLabs API key in Settings to enable Sound Effect Generation.',
        loading: false,
        unprovisionable: false,
        byokConfigurable: true,
      }));
      render(<AudioInspector />);
      const label = which === 'sound' ? 'sound' : 'music';
      const btn = screen.getByRole('button', {
        name: `Generate ${label} with AI — requires Starter tier`,
      });
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn).not.toHaveTextContent('Unavailable');
      expect(btn).toHaveTextContent('Starter');
    },
  );
});

// ---------------------------------------------------------------------------
// Clip editing (#9903, operation audio.FR-1.OP-02): manual trim/fade/gain/loop
// with validation and undo. `source.type: 'upload'` so no Web Audio decode runs
// under jsdom — the numeric controls are exercised directly.
// ---------------------------------------------------------------------------

const AUDIO_ASSET = {
  id: 'aud-1',
  name: 'Beep',
  kind: 'audio' as const,
  fileSize: 1024,
  source: { type: 'upload' as const, filename: 'beep.wav' },
};

function mockWithClip() {
  mockEditorStore({
    entityAudio: {
      'ent-1': {
        assetId: 'aud-1',
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
    assetRegistry: { 'aud-1': AUDIO_ASSET },
    audioBuses: [{ name: 'master', volume: 1 }, { name: 'sfx', volume: 1 }],
  });
}

describe('Standalone clip editing prototype (audio.FR-1.OP-02)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('does not offer clip edits in the inspector before persistence and playback are connected (#9936)', () => {
    mockWithClip();
    render(<AudioInspector />);
    expect(screen.queryByLabelText('Trim start')).not.toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('renders accessible clip controls and a labelled waveform when a source asset is attached', () => {
    mockWithClip();
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    expect(screen.getByText('Clip Editing')).toBeInTheDocument();
    expect(screen.getByLabelText('Trim start')).toBeInTheDocument();
    expect(screen.getByLabelText('Trim end')).toBeInTheDocument();
    expect(screen.getByLabelText('Gain')).toBeInTheDocument();
    expect(screen.getByLabelText('Fade in')).toBeInTheDocument();
    expect(screen.getByLabelText('Fade out')).toBeInTheDocument();
    expect(screen.getByLabelText('Loop start')).toBeInTheDocument();
    expect(screen.getByLabelText('Loop end')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Waveform, trim/ })).toBeInTheDocument();
  });

  // A clip field commits on blur or Enter, not on every keystroke, so drive the
  // real commit gesture: type, then blur.
  function commitField(el: HTMLInputElement, value: string) {
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
  }

  it('applies a valid manual trim to the clip document', () => {
    mockWithClip();
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const end = screen.getByLabelText('Trim end') as HTMLInputElement;
    commitField(end, '0.5');
    expect(end.value).toBe('0.5');
    // No validation error surfaced for a valid edit, and the commit was recorded.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo clip edit' })).toBeEnabled();
  });

  it('does not commit a clip edit until blur or Enter, keeping keystrokes out of history and validation', () => {
    mockWithClip();
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const gain = screen.getByLabelText('Gain') as HTMLInputElement;
    const undo = screen.getByRole('button', { name: 'Undo clip edit' });
    // Transiently invalid keystrokes — a lone "-", then a value below MIN_GAIN_DB
    // (-60) — must neither push an undo entry nor raise the assertive alert while
    // still being typed. (Under the old per-keystroke commit both would fire.)
    fireEvent.change(gain, { target: { value: '-' } });
    fireEvent.change(gain, { target: { value: '-70' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(undo).toBeDisabled();
    expect(gain.value).toBe('-70'); // shown as typed, but not yet committed

    // Correcting to a valid value and blurring records exactly one entry.
    commitField(gain, '-6');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(gain.value).toBe('-6');
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(gain.value).toBe('0');
    expect(undo).toBeDisabled();
  });

  it('commits a clip edit on Enter', () => {
    mockWithClip();
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const end = screen.getByLabelText('Trim end') as HTMLInputElement;
    const undo = screen.getByRole('button', { name: 'Undo clip edit' });
    fireEvent.change(end, { target: { value: '0.5' } });
    expect(undo).toBeDisabled(); // typing alone does not commit
    fireEvent.keyDown(end, { key: 'Enter' });
    expect(end.value).toBe('0.5');
    expect(undo).toBeEnabled();
  });

  it('rejects trim end <= start, showing a validation error and leaving the prior clip', () => {
    mockWithClip();
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const start = screen.getByLabelText('Trim start') as HTMLInputElement;
    const end = screen.getByLabelText('Trim end') as HTMLInputElement;
    // Establish a valid window 0.6–1.0.
    commitField(start, '0.6');
    expect(start.value).toBe('0.6');
    // Now push trim end before start → invalid.
    commitField(end, '0.3');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Trim end must be after trim start/);
    // The prior clip is intact: end reverts to the last valid value, start held.
    expect(end.value).toBe('1');
    expect(start.value).toBe('0.6');
    expect(end).toHaveAttribute('aria-invalid', 'true');
  });

  it('undo restores the prior gain without touching trim', () => {
    mockWithClip();
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const gain = screen.getByLabelText('Gain') as HTMLInputElement;
    const end = screen.getByLabelText('Trim end') as HTMLInputElement;
    commitField(end, '0.5');
    commitField(gain, '-6');
    expect(gain.value).toBe('-6');

    fireEvent.click(screen.getByRole('button', { name: 'Undo clip edit' }));
    // The gain edit is undone; the earlier trim survives.
    expect(gain.value).toBe('0');
    expect(end.value).toBe('0.5');
  });

  it('records one undo entry per edit under StrictMode', () => {
    mockWithClip();
    render(<StrictMode><ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} /></StrictMode>);
    const gain = screen.getByLabelText('Gain') as HTMLInputElement;
    commitField(gain, '-6');
    commitField(gain, '-12');
    fireEvent.click(screen.getByRole('button', { name: 'Undo clip edit' }));
    expect(gain.value).toBe('-6');
    fireEvent.click(screen.getByRole('button', { name: 'Undo clip edit' }));
    expect(gain.value).toBe('0');
    expect(screen.getByRole('button', { name: 'Undo clip edit' })).toBeDisabled();
  });
});
