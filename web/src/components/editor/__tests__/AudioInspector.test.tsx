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
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Remove Audio')).toBeInTheDocument();
    // The three checkbox controls carry an associated accessible name (useId +
    // htmlFor/id), so getByLabelText — which resolves ONLY through that pairing —
    // finds each real checkbox. getByText would pass on a visual label sitting
    // beside an unassociated input, which is the exact PF-1182/PF-1183 drift.
    for (const name of ['Loop', 'Spatial', 'Autoplay']) {
      expect(screen.getByLabelText(name)).toHaveAttribute('type', 'checkbox');
    }
  });

  it('gives the migrated Volume and Pitch sliders their own accessible names', () => {
    // Both sliders now come from the shared @spawnforge/ui SliderInput composite,
    // which renders its own <label htmlFor>. getByLabelText resolves only through
    // that association, so it fails if the composite ever stops wiring the label
    // to the range input (the drift this dedupe removes). Each also carries its
    // range role and value, proving the migrated control is the real slider.
    mockEditorStore({
      entityAudio: {
        'ent-1': {
          assetId: null,
          volume: 0.5,
          pitch: 1.5,
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
    const volume = screen.getByLabelText('Volume');
    const pitch = screen.getByLabelText('Pitch');
    expect(volume).toHaveAttribute('type', 'range');
    expect(volume).toHaveValue('0.5');
    expect(pitch).toHaveAttribute('type', 'range');
    expect(pitch).toHaveValue('1.5');
  });

  it('forwards a slider change to setAudio for the migrated Volume and Pitch sliders', () => {
    // The migration routes onChange through the shared SliderInput composite
    // (onChange={(e) => onChange(Number(e.target.value))}) and SliderRowWithTerm's
    // onChange={onChange} pass-through. Firing a real change event proves that
    // path still reaches setAudio with the parsed numeric value — a regression
    // that dropped/mis-wired the forwarding (e.g. to formatValue) would leave the
    // accessible-name test above green while breaking every edit.
    const setAudio = vi.fn();
    mockEditorStore({
      setAudio,
      entityAudio: {
        'ent-1': {
          assetId: null,
          volume: 0.5,
          pitch: 1.5,
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
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '0.75' } });
    expect(setAudio).toHaveBeenCalledWith('ent-1', { volume: 0.75 });
    fireEvent.change(screen.getByLabelText('Pitch'), { target: { value: '2' } });
    expect(setAudio).toHaveBeenCalledWith('ent-1', { pitch: 2 });
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
    // These come from the shared @spawnforge/ui NumberField composite, which
    // renders its own <label htmlFor>. getByLabelText resolves only through that
    // association, so it fails if the composite ever stops wiring the label to the
    // number input — the drift PF-1183 removed by deleting the bespoke local copy.
    for (const name of ['Max Distance', 'Ref Distance', 'Rolloff']) {
      expect(screen.getByLabelText(name)).toHaveAttribute('type', 'number');
    }
  });

  it.each([
    { label: 'Max Distance', raw: '-5', field: 'maxDistance', expected: 1 },
    { label: 'Ref Distance', raw: '-5', field: 'refDistance', expected: 0.1 },
    { label: 'Rolloff', raw: '-5', field: 'rolloffFactor', expected: 0 },
    { label: 'Rolloff', raw: '20', field: 'rolloffFactor', expected: 10 },
  ])('bounds $label before sending it to setAudio', ({ label, raw, field, expected }) => {
    const setAudio = vi.fn();
    mockEditorStore({
      setAudio,
      entityAudio: { 'ent-1': {
        assetId: null, volume: 1, pitch: 1, loopAudio: false, spatial: true,
        maxDistance: 50, refDistance: 1, rolloffFactor: 1, autoplay: false,
      } },
    });
    render(<AudioInspector />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: raw } });
    expect(setAudio).toHaveBeenCalledExactlyOnceWith('ent-1', { [field]: expected });
  });

  it('forwards a spatial number-field edit to setAudio through the shared composite', () => {
    // Proves the NumberField onChange path (parseFloat -> onChange) still reaches
    // setAudio with the parsed numeric value, so the accessible-name test above
    // cannot pass while the edit wiring is broken (lessons-learned #11).
    const setAudio = vi.fn();
    mockEditorStore({
      setAudio,
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
    fireEvent.change(screen.getByLabelText('Max Distance'), { target: { value: '80' } });
    expect(setAudio).toHaveBeenCalledWith('ent-1', { maxDistance: 80 });
  });

  it('names the tier a locked generate button needs, not just in the tooltip', () => {
    // The buttons stay focusable when locked (aria-disabled, not disabled) so
    // they can still make their pitch — but `title` is unreachable by keyboard,
    // so the requirement has to be in the accessible name.
    mockEditorStore();
    useUserStore.setState({ tier: 'starter' , profileLoaded: true });
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
    render(<AudioInspector />);
    expect(
      screen.getByRole('button', { name: 'Generate sound with AI' })
    ).not.toHaveAttribute('aria-disabled');
  });

  // #7715 — a starter account holding spendable trial tokens reads as
  // hobbyist through `effectiveTier`, which is exactly the tier both
  // generate buttons require, so the tier clause must drop for it too.
  it('drops the tier clause for a starter account with spendable trial tokens', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'starter', spendableTokens: 50 , profileLoaded: true });
    render(<AudioInspector />);
    const sound = screen.getByRole('button', { name: 'Generate sound with AI' });
    const music = screen.getByRole('button', { name: 'Generate music with AI' });
    expect(sound).not.toHaveAttribute('aria-disabled');
    expect(music).not.toHaveAttribute('aria-disabled');
    expect(sound).not.toHaveAccessibleName(/requires/);
    expect(music).not.toHaveAccessibleName(/requires/);
  });

  // Companion case: once the trial balance is spent, the same account is
  // gated exactly as any other starter account.
  it('keeps the tier clause for a starter account with no spendable tokens', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'starter', spendableTokens: 0 , profileLoaded: true });
    render(<AudioInspector />);
    expect(
      screen.getByRole('button', { name: 'Generate sound with AI — requires Starter tier' })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('button', { name: 'Generate music with AI — requires Starter tier' })
    ).toHaveAttribute('aria-disabled', 'true');
  });

  // #7715 review round 2 — before /api/user/profile resolves, `tier`/
  // `spendableTokens` read their store defaults ('starter'/0), which is
  // indistinguishable from "no trial access". The tier clause must not flash
  // for that one render.
  it('does not show the tier clause while the profile is still loading', () => {
    mockEditorStore();
    useUserStore.setState({ tier: 'starter', spendableTokens: 0, profileLoaded: false });
    render(<AudioInspector />);
    expect(screen.getByRole('button', { name: 'Generate sound with AI' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Generate music with AI' })).not.toHaveAttribute('aria-disabled');
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
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
    useUserStore.setState({ tier: 'creator' , profileLoaded: true });
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
      useUserStore.setState({ tier: 'starter' , profileLoaded: true });
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
  it('commits Enter followed by blur once and preserves redo on untouched controls', () => {
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const gain = screen.getByLabelText('Gain');
    const undo = screen.getByRole('button', { name: 'Undo clip edit' });
    const redo = screen.getByRole('button', { name: 'Redo clip edit' });
    fireEvent.change(gain, { target: { value: '-6' } });
    fireEvent.keyDown(gain, { key: 'Enter' });
    fireEvent.keyDown(gain, { key: 'Enter' });
    fireEvent.blur(gain);
    fireEvent.click(undo);
    expect(gain).toHaveValue(0);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();

    fireEvent.focus(gain);
    fireEvent.blur(gain);
    fireEvent.keyDown(screen.getByLabelText('Trim end'), { key: 'Enter' });
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    expect(gain).toHaveValue(-6);
  });

  it('Escape discards a draft and the following blur does not create an undo entry', () => {
    render(<ClipEditor assetId={AUDIO_ASSET.id} asset={AUDIO_ASSET} sourceBounds={{ durationSec: 1, sampleRate: 48000 }} />);
    const gain = screen.getByLabelText('Gain');
    fireEvent.change(gain, { target: { value: '-70' } });
    fireEvent.keyDown(gain, { key: 'Escape' });
    expect(gain).toHaveValue(0);
    fireEvent.blur(gain);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo clip edit' })).toBeDisabled();
  });

});
