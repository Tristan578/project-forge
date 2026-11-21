/**
 * Manual arrangement authoring through the real store, including recovery of
 * destructive edits and keyboard isolation from scene-wide shortcuts.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, cleanup, within } from '@/test/utils/componentTestUtils';
import { MusicArrangementPanel } from '../MusicArrangementPanel';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';
import { createEmptyArrangement, type MusicArrangement } from '@/lib/music/arrangementTypes';

const fixtures = vi.hoisted(() => ({
  assets: {
    a1: { id: 'a1', name: 'music-intro', kind: 'audio' },
    a2: { id: 'a2', name: 'sfx-jump', kind: 'audio' },
    g1: { id: 'g1', name: 'mesh', kind: 'gltf_model' },
  } as Record<string, { id: string; name: string; kind: string }>,
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ assetRegistry: fixtures.assets }),
  ),
}));

const state = () => useMusicArrangementStore.getState();
beforeEach(() => { state().hydrate(null); });
afterEach(() => cleanup());

function addTrackAndClip(sourceLength = '30') {
  fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
  fireEvent.change(screen.getByLabelText('Source length for Track 1'), { target: { value: sourceLength } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
  return state().arrangement.clips[0];
}

describe('MusicArrangementPanel authoring', () => {
  it('states the playback limitation beside the empty state', () => {
    render(<MusicArrangementPanel />);
    expect(screen.getByText('No tracks yet')).toBeInTheDocument();
    expect(screen.getByText(/These settings do not change preview, game or exported playback yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo arrangement edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo arrangement edit' })).toBeDisabled();
  });

  it('requires an explicitly entered positive source duration before adding a clip', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    const duration = screen.getByLabelText('Source length for Track 1');
    const add = screen.getByRole('button', { name: 'Add Clip' });
    expect(duration).toHaveValue(null);
    expect(add).toBeDisabled();
    for (const value of ['0', '-1', '86401']) {
      fireEvent.change(duration, { target: { value } });
      expect(duration).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText(/Enter a duration greater than 0/)).toBeInTheDocument();
      expect(add).toBeDisabled();
      fireEvent.click(add);
      expect(state().arrangement.clips).toHaveLength(0);
    }
    fireEvent.change(duration, { target: { value: '12.5' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(state().arrangement.clips[0]).toMatchObject({ sourceDurationSeconds: 12.5, trimEnd: 12.5 });
  });

  it('offers only audio assets and clears a duration when the source changes', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    const source = screen.getByLabelText('Clip source for Track 1');
    const options = within(source).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Select audio', 'music-intro', 'sfx-jump']);
    fireEvent.change(screen.getByLabelText('Source length for Track 1'), { target: { value: '30' } });
    fireEvent.change(source, { target: { value: 'a2' } });
    expect(screen.getByRole('button', { name: 'Add Clip' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Source length for Track 1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    expect(state().arrangement.clips[0]).toMatchObject({ sourceUrl: 'sfx-jump', sourceDurationSeconds: 2 });
  });

  it('shows an actionable empty source state', () => {
    const original = fixtures.assets;
    fixtures.assets = {};
    try {
      render(<MusicArrangementPanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
      expect(screen.getByLabelText('Clip source for Track 1')).toBeDisabled();
      expect(screen.getByText('Import or generate audio to add a clip.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Clip' })).toBeDisabled();
    } finally {
      fixtures.assets = original;
    }
  });

  it('moves and trims a clip and displays its numeric timing at a distant offset', () => {
    render(<MusicArrangementPanel />);
    const clip = addTrackAndClip();
    fireEvent.change(screen.getByLabelText(`Start offset for ${clip.name}`), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(`Trim start for ${clip.name}`), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(`Trim end for ${clip.name}`), { target: { value: '20' } });
    expect(state().arrangement.clips[0]).toMatchObject({ startOffset: 1000, trimStart: 5, trimEnd: 20 });
    expect(screen.getByText(/Start: 1000.00 s · End: 1015.00 s · Trimmed length: 15.00 s/)).toBeInTheDocument();
  });

  it('clamps trim to the entered source duration', () => {
    render(<MusicArrangementPanel />);
    const clip = addTrackAndClip('18');
    fireEvent.change(screen.getByLabelText(`Trim end for ${clip.name}`), { target: { value: '500' } });
    expect(state().arrangement.clips[0].trimEnd).toBe(18);
  });

  it('toggles loop and mute metadata with accessible pressed states', async () => {
    const user = userEvent.setup();
    render(<MusicArrangementPanel />);
    const clip = addTrackAndClip();
    const loop = screen.getByRole('button', { name: `Loop ${clip.name}` });
    loop.focus();
    await user.keyboard(' ');
    expect(loop).toHaveAttribute('aria-pressed', 'true');
    expect(state().arrangement.clips[0].loopEnabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(loop).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Mute Track 1' }));
    expect(state().arrangement.tracks[0].muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Mute Track 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores a deleted track and its clips together with Undo, then Redo removes them', () => {
    render(<MusicArrangementPanel />);
    addTrackAndClip();
    const original = structuredClone(state().arrangement);
    fireEvent.click(screen.getByRole('button', { name: 'Delete track Track 1' }));
    expect(state().arrangement.tracks).toHaveLength(0);
    expect(state().arrangement.clips).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent(/Deleted Track 1 and its clips/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo arrangement edit' }));
    expect(state().arrangement).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'Redo arrangement edit' }));
    expect(state().arrangement.tracks).toHaveLength(0);
    expect(state().arrangement.clips).toHaveLength(0);
  });

  it('deletes and restores a clip without deleting its track', () => {
    render(<MusicArrangementPanel />);
    const clip = addTrackAndClip();
    fireEvent.click(screen.getByRole('button', { name: `Delete clip ${clip.name}` }));
    expect(state().arrangement.clips).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo arrangement edit' }));
    expect(state().arrangement.clips).toEqual([clip]);
    expect(state().arrangement.tracks).toHaveLength(1);
  });

  it('supports keyboard Add, Undo and Redo without invoking global editor shortcuts', async () => {
    const user = userEvent.setup();
    const globalShortcut = vi.fn();
    window.addEventListener('keydown', globalShortcut);
    try {
      render(<MusicArrangementPanel />);
      await user.tab();
      expect(screen.getByRole('button', { name: 'Add Track' })).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(state().arrangement.tracks).toHaveLength(1);
      await user.keyboard('{Control>}z{/Control}');
      expect(state().arrangement.tracks).toHaveLength(0);
      await user.keyboard('{Control>}{Shift>}Z{/Shift}{/Control}');
      expect(state().arrangement.tracks).toHaveLength(1);
      globalShortcut.mockClear();
      const mute = screen.getByRole('button', { name: 'Mute Track 1' });
      mute.focus();
      await user.keyboard('{Delete}');
      expect(globalShortcut).not.toHaveBeenCalled();
      expect(state().arrangement.tracks).toHaveLength(1);
    } finally {
      window.removeEventListener('keydown', globalShortcut);
    }
  });

  it('groups prototype-like track IDs without dropping clips or crashing', () => {
    const arrangement: MusicArrangement = {
      ...createEmptyArrangement(),
      tracks: [{ id: '__proto__', name: 'Imported track', muted: false }],
      clips: [{
        id: 'constructor', trackId: '__proto__', name: 'Imported clip', sourceUrl: 'music-intro',
        sourceDurationSeconds: 10, trimStart: 0, trimEnd: 10, startOffset: 0, loopEnabled: false,
      }],
    };
    state().hydrate(arrangement);
    render(<MusicArrangementPanel />);
    const track = screen.getByTestId('track-__proto__');
    expect(within(track).getByText('Imported clip')).toBeInTheDocument();
    fireEvent.change(within(track).getByLabelText('Source length for Imported track'), { target: { value: '2' } });
    fireEvent.click(within(track).getByRole('button', { name: 'Add Clip' }));
    expect(state().arrangement.clips).toHaveLength(2);
  });

  it('flags overlapping clips on the same track', () => {
    render(<MusicArrangementPanel />);
    addTrackAndClip();
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    expect(screen.getAllByText('Overlaps another clip on this track.')).toHaveLength(2);
  });

  it('paginates long clip lists while preserving access to later clips', () => {
    const trackId = state().addTrack('Long arrangement')!;
    for (let index = 0; index < 26; index += 1) {
      state().addClip({ trackId, sourceUrl: 'music-intro', sourceDurationSeconds: 1, name: `Clip ${index + 1}` });
    }
    render(<MusicArrangementPanel />);
    expect(screen.getByText('Clip 1')).toBeInTheDocument();
    expect(screen.queryByText('Clip 26')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next clips' }));
    expect(screen.getByText('Clip 26')).toBeInTheDocument();
    expect(screen.queryByText('Clip 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous clips' }));
    expect(screen.getByText('Clip 1')).toBeInTheDocument();
  });
});
