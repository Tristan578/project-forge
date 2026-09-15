/**
 * Render + interaction tests for MusicArrangementPanel (music.FR-2.OP-01 /
 * OP-02, #9854). Exercises the manual controls end-to-end through the real
 * arrangement store: add track, add clip, move, trim, loop toggle, delete.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@/test/utils/componentTestUtils';
import { MusicArrangementPanel } from '../MusicArrangementPanel';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';
import { createEmptyArrangement } from '@/lib/music/arrangementTypes';

// The panel reads audio assets from the editor store; supply two.
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      assetRegistry: {
        a1: { id: 'a1', name: 'music-intro', kind: 'audio', fileSize: 10, source: { type: 'upload', filename: 'intro.mp3' } },
        a2: { id: 'a2', name: 'sfx-jump', kind: 'audio', fileSize: 5, source: { type: 'upload', filename: 'jump.wav' } },
        g1: { id: 'g1', name: 'mesh', kind: 'gltf_model', fileSize: 99, source: { type: 'upload', filename: 'm.glb' } },
      },
    }),
  ),
}));

beforeEach(() => {
  // Reset the real store to empty (including undo history) before each test.
  useMusicArrangementStore.setState({ arrangement: createEmptyArrangement(), past: [], future: [] });
});
afterEach(() => cleanup());

const state = () => useMusicArrangementStore.getState();

describe('MusicArrangementPanel — OP-01 arrangement', () => {
  it('shows the empty state with no tracks', () => {
    render(<MusicArrangementPanel />);
    expect(screen.getByText('No tracks yet')).toBeTruthy();
  });

  it('adds a track via the Add Track button', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    expect(state().arrangement.tracks).toHaveLength(1);
    expect(screen.getByText('Track 1')).toBeTruthy();
  });

  it('adds a clip from an audio asset onto a track', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    // Select source, then Add Clip.
    const select = screen.getByLabelText('Clip source for Track 1') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'sfx-jump' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    expect(state().arrangement.clips).toHaveLength(1);
    expect(state().arrangement.clips[0].sourceUrl).toBe('sfx-jump');
  });

  it('only offers audio assets as clip sources (not the gltf model)', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    const options = within(screen.getByLabelText('Clip source for Track 1')).getAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['music-intro', 'sfx-jump']);
  });

  it('moves a clip by editing its start offset', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    const clip = state().arrangement.clips[0];
    fireEvent.change(screen.getByLabelText(`Start offset for ${clip.name}`), { target: { value: '8' } });
    expect(state().arrangement.clips[0].startOffset).toBe(8);
  });

  // #9854 F2 parity: the AI exposes `arrangement_set_tempo`, so the panel must
  // offer the same field manually. This is the test that would have failed while
  // the tempo control was missing from the panel.
  it('sets the arrangement tempo through the BPM input (manual parity with arrangement_set_tempo)', () => {
    render(<MusicArrangementPanel />);
    const tempo = screen.getByLabelText('Arrangement tempo (BPM)') as HTMLInputElement;
    expect(tempo.valueAsNumber).toBe(120); // default
    fireEvent.change(tempo, { target: { value: '140' } });
    expect(state().arrangement.tempoBpm).toBe(140);
  });

  it('clamps a tempo above the 400 BPM ceiling', () => {
    render(<MusicArrangementPanel />);
    fireEvent.change(screen.getByLabelText('Arrangement tempo (BPM)'), { target: { value: '999' } });
    expect(state().arrangement.tempoBpm).toBe(400);
  });

  it('deletes a track (and its clips)', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    expect(state().arrangement.clips).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete track Track 1' }));
    expect(state().arrangement.tracks).toHaveLength(0);
    expect(state().arrangement.clips).toHaveLength(0);
  });

  // The Mute checkbox is wired to setTrackMuted; this is the test that would
  // have failed had the checkbox been unbound or the store action a no-op.
  it('toggles a track mute through the Mute checkbox', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    const mute = screen.getByLabelText('Mute Track 1') as HTMLInputElement;
    expect(mute.checked).toBe(false);
    expect(state().arrangement.tracks[0].muted).toBe(false);
    fireEvent.click(mute);
    expect(state().arrangement.tracks[0].muted).toBe(true);
    fireEvent.click(mute);
    expect(state().arrangement.tracks[0].muted).toBe(false);
  });
});

describe('MusicArrangementPanel — OP-02 trim, loop, delete clip', () => {
  const seedClip = () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    return state().arrangement.clips[0];
  };

  it('trims a clip within bounds', () => {
    const clip = seedClip();
    fireEvent.change(screen.getByLabelText(`Trim start for ${clip.name}`), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(`Trim end for ${clip.name}`), { target: { value: '20' } });
    expect(state().arrangement.clips[0]).toMatchObject({ trimStart: 5, trimEnd: 20 });
  });

  it('clamps a trim end past the source length (default 30s source)', () => {
    const clip = seedClip();
    fireEvent.change(screen.getByLabelText(`Trim end for ${clip.name}`), { target: { value: '500' } });
    expect(state().arrangement.clips[0].trimEnd).toBe(30);
  });

  it('toggles loop on and off', () => {
    const clip = seedClip();
    const loop = screen.getByLabelText(`Loop ${clip.name}`) as HTMLInputElement;
    expect(loop.checked).toBe(false);
    fireEvent.click(loop);
    expect(state().arrangement.clips[0].loopEnabled).toBe(true);
    fireEvent.click(loop);
    expect(state().arrangement.clips[0].loopEnabled).toBe(false);
  });

  it('deletes a clip', () => {
    const clip = seedClip();
    fireEvent.click(screen.getByRole('button', { name: `Delete clip ${clip.name}` }));
    expect(state().arrangement.clips).toHaveLength(0);
  });

  it('flags overlapping clips on the same track', () => {
    render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    // Both clips at offset 0 over a 30s source -> overlap surfaced in the UI.
    expect(screen.getAllByText('(overlap)').length).toBeGreaterThan(0);
  });
});

describe('MusicArrangementPanel — undo/redo', () => {
  it('undo and redo buttons reverse and re-apply a delete', () => {
    render(<MusicArrangementPanel />);
    // Undo/redo start disabled with no history.
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Clip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete track Track 1' }));
    expect(state().arrangement.tracks).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(state().arrangement.tracks).toHaveLength(1);
    expect(state().arrangement.clips).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(state().arrangement.tracks).toHaveLength(0);
    expect(state().arrangement.clips).toHaveLength(0);
  });

  it('Ctrl+Z undoes the last mutation from inside the panel', () => {
    const { container } = render(<MusicArrangementPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }));
    expect(state().arrangement.tracks).toHaveLength(1);
    fireEvent.keyDown(container.firstChild as Element, { key: 'z', ctrlKey: true });
    expect(state().arrangement.tracks).toHaveLength(0);
  });
});
