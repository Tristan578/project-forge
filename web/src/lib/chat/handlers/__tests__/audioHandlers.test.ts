/**
 * Tests for audioHandlers — adaptive music, snapshots, occlusion, and segments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { audioHandlers } from '../audioHandlers';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';
import { createEmptyArrangement } from '@/lib/music/arrangementTypes';

// ---------------------------------------------------------------------------
// Mock audioManager
// ---------------------------------------------------------------------------

const mockSetAdaptiveMusic = vi.fn();
const mockSetMusicIntensity = vi.fn();
const mockGetSnapshot = vi.fn();
const mockSetOcclusion = vi.fn();

vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    setAdaptiveMusic: (...args: unknown[]) => mockSetAdaptiveMusic(...args),
    setMusicIntensity: (...args: unknown[]) => mockSetMusicIntensity(...args),
    getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
    setOcclusion: (...args: unknown[]) => mockSetOcclusion(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSnapshot.mockReturnValue(undefined);
});

// ===========================================================================
// set_adaptive_music
// ===========================================================================

describe('audioHandlers', () => {
  describe('set_adaptive_music', () => {
    it('sets up adaptive music with stems and default trackId', async () => {
      const stems = [
        { name: 'bass', assetId: 'a1' },
        { name: 'drums', assetId: 'a2' },
      ];
      const { result, store } = await invokeHandler(audioHandlers, 'set_adaptive_music', {
        stems,
      });

      expect(result.success).toBe(true);
      expect(mockSetAdaptiveMusic).toHaveBeenCalledWith('default', stems, {
        bus: undefined,
        initialIntensity: undefined,
      });
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0);
      expect(result.result).toContain('bass');
      expect(result.result).toContain('drums');
    });

    it('uses provided trackId and initialIntensity', async () => {
      const stems = [{ name: 'melody', assetId: 'a3' }];
      const { result, store } = await invokeHandler(audioHandlers, 'set_adaptive_music', {
        trackId: 'battle',
        stems,
        bus: 'music',
        initialIntensity: 0.5,
      });

      expect(result.success).toBe(true);
      expect(mockSetAdaptiveMusic).toHaveBeenCalledWith('battle', stems, {
        bus: 'music',
        initialIntensity: 0.5,
      });
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0.5);
    });

    it('returns error when stems is empty', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_adaptive_music', {
        stems: [],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when stems is missing', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_adaptive_music', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when stem is missing required name field', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_adaptive_music', {
        stems: [{ assetId: 'a1' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('catches thrown errors and returns failure', async () => {
      mockSetAdaptiveMusic.mockImplementationOnce(() => {
        throw new Error('AudioContext not ready');
      });
      const { result } = await invokeHandler(audioHandlers, 'set_adaptive_music', {
        stems: [{ name: 'bass', assetId: 'a1' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('AudioContext not ready');
    });

    it('catches non-Error thrown values', async () => {
      mockSetAdaptiveMusic.mockImplementationOnce(() => {
        throw 'string error';
      });
      const { result } = await invokeHandler(audioHandlers, 'set_adaptive_music', {
        stems: [{ name: 'bass', assetId: 'a1' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to set adaptive music');
    });
  });

  // ===========================================================================
  // set_music_intensity
  // ===========================================================================

  describe('set_music_intensity', () => {
    it('sets intensity and clamps to [0,1]', async () => {
      const { result, store } = await invokeHandler(audioHandlers, 'set_music_intensity', {
        intensity: 0.75,
      });

      expect(result.success).toBe(true);
      expect(mockSetMusicIntensity).toHaveBeenCalledWith('default', 0.75, undefined);
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0.75);
    });

    it('clamps intensity above 1 to 1', async () => {
      const { result, store } = await invokeHandler(audioHandlers, 'set_music_intensity', {
        intensity: 5,
      });

      expect(result.success).toBe(true);
      expect(mockSetMusicIntensity).toHaveBeenCalledWith('default', 1, undefined);
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(1);
    });

    it('clamps intensity below 0 to 0', async () => {
      const { result, store } = await invokeHandler(audioHandlers, 'set_music_intensity', {
        intensity: -2,
      });

      expect(result.success).toBe(true);
      expect(mockSetMusicIntensity).toHaveBeenCalledWith('default', 0, undefined);
      expect(store.setAdaptiveMusicIntensity).toHaveBeenCalledWith(0);
    });

    it('uses provided trackId and rampMs', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_music_intensity', {
        trackId: 'ambient',
        intensity: 0.3,
        rampMs: 500,
      });

      expect(result.success).toBe(true);
      expect(mockSetMusicIntensity).toHaveBeenCalledWith('ambient', 0.3, 500);
      expect(result.result).toContain('500ms ramp');
    });

    it('returns error when intensity is missing', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_music_intensity', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when rampMs is negative', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_music_intensity', {
        intensity: 0.5,
        rampMs: -100,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('catches thrown errors', async () => {
      mockSetMusicIntensity.mockImplementationOnce(() => {
        throw new Error('No audio context');
      });
      const { result } = await invokeHandler(audioHandlers, 'set_music_intensity', {
        intensity: 0.5,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('No audio context');
    });
  });

  // ===========================================================================
  // transition_music_segment
  // ===========================================================================

  describe('transition_music_segment', () => {
    it('transitions to the named segment', async () => {
      const { result, store } = await invokeHandler(audioHandlers, 'transition_music_segment', {
        segment: 'verse',
      });

      expect(result.success).toBe(true);
      expect(store.setCurrentMusicSegment).toHaveBeenCalledWith('verse');
      expect(result.result).toContain('verse');
    });

    it('includes crossfade info in result when provided', async () => {
      const { result } = await invokeHandler(audioHandlers, 'transition_music_segment', {
        segment: 'chorus',
        crossfadeDurationMs: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.result).toContain('1000ms crossfade');
    });

    it('returns error when segment is missing', async () => {
      const { result } = await invokeHandler(audioHandlers, 'transition_music_segment', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when segment is empty string', async () => {
      const { result } = await invokeHandler(audioHandlers, 'transition_music_segment', {
        segment: '',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ===========================================================================
  // create_audio_snapshot
  // ===========================================================================

  describe('create_audio_snapshot', () => {
    it('saves a snapshot with the given name', async () => {
      const { result, store } = await invokeHandler(audioHandlers, 'create_audio_snapshot', {
        name: 'battle_mix',
      });

      expect(result.success).toBe(true);
      expect(store.saveAudioSnapshot).toHaveBeenCalledWith('battle_mix', undefined);
      expect(result.result).toContain('battle_mix');
    });

    it('passes crossfadeDurationMs to the store', async () => {
      const { result, store } = await invokeHandler(audioHandlers, 'create_audio_snapshot', {
        name: 'calm',
        crossfadeDurationMs: 2000,
      });

      expect(result.success).toBe(true);
      expect(store.saveAudioSnapshot).toHaveBeenCalledWith('calm', 2000);
    });

    it('returns error when name is missing', async () => {
      const { result } = await invokeHandler(audioHandlers, 'create_audio_snapshot', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when name is empty string', async () => {
      const { result } = await invokeHandler(audioHandlers, 'create_audio_snapshot', {
        name: '',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ===========================================================================
  // apply_audio_snapshot
  // ===========================================================================

  describe('apply_audio_snapshot', () => {
    it('loads snapshot when it exists', async () => {
      mockGetSnapshot.mockReturnValue({ crossfadeDurationMs: 500, buses: {} });

      const { result, store } = await invokeHandler(audioHandlers, 'apply_audio_snapshot', {
        name: 'battle_mix',
      });

      expect(result.success).toBe(true);
      expect(store.loadAudioSnapshot).toHaveBeenCalledWith('battle_mix', undefined);
      expect(result.result).toContain('500ms crossfade');
    });

    it('uses overridden crossfade when provided', async () => {
      mockGetSnapshot.mockReturnValue({ crossfadeDurationMs: 500, buses: {} });

      const { result, store } = await invokeHandler(audioHandlers, 'apply_audio_snapshot', {
        name: 'battle_mix',
        crossfadeDurationMs: 1000,
      });

      expect(result.success).toBe(true);
      expect(store.loadAudioSnapshot).toHaveBeenCalledWith('battle_mix', 1000);
      expect(result.result).toContain('1000ms crossfade');
    });

    it('returns error when snapshot not found', async () => {
      mockGetSnapshot.mockReturnValue(undefined);

      const { result } = await invokeHandler(audioHandlers, 'apply_audio_snapshot', {
        name: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Audio snapshot not found');
    });

    it('returns error when name is missing', async () => {
      const { result } = await invokeHandler(audioHandlers, 'apply_audio_snapshot', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when name is empty string', async () => {
      const { result } = await invokeHandler(audioHandlers, 'apply_audio_snapshot', {
        name: '',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });
  });

  // ===========================================================================
  // set_audio_occlusion
  // ===========================================================================

  describe('set_audio_occlusion', () => {
    it('enables occlusion by default', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_audio_occlusion', {
        entityId: 'e1',
      });

      expect(result.success).toBe(true);
      expect(mockSetOcclusion).toHaveBeenCalledWith('e1', true);
      expect(result.result).toContain('enabled');
    });

    it('disables occlusion when enabled=false', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_audio_occlusion', {
        entityId: 'e1',
        enabled: false,
      });

      expect(result.success).toBe(true);
      expect(mockSetOcclusion).toHaveBeenCalledWith('e1', false);
      expect(result.result).toContain('disabled');
    });

    it('explicitly enables occlusion when enabled=true', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_audio_occlusion', {
        entityId: 'e1',
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockSetOcclusion).toHaveBeenCalledWith('e1', true);
    });

    it('returns error when entityId is missing', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_audio_occlusion', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('returns error when entityId is empty string', async () => {
      const { result } = await invokeHandler(audioHandlers, 'set_audio_occlusion', {
        entityId: '',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid arguments');
    });

    it('catches thrown errors', async () => {
      mockSetOcclusion.mockImplementationOnce(() => {
        throw new Error('WebAudio error');
      });
      const { result } = await invokeHandler(audioHandlers, 'set_audio_occlusion', {
        entityId: 'e1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('WebAudio error');
    });
  });
});

// ===========================================================================
// Music arrangement handlers (music.FR-2.OP-01 / OP-02, #9854) — the in-app
// AI half of the same operations MusicArrangementPanel offers manually. These
// drive the real useMusicArrangementStore singleton, proving the AI path and
// the manual UI share one command/data contract (issue #9854 F2 parity).
// ===========================================================================

describe('audioHandlers — music arrangement (in-app AI parity)', () => {
  const arr = () => useMusicArrangementStore.getState();

  beforeEach(() => {
    useMusicArrangementStore.setState({ arrangement: createEmptyArrangement(), past: [], future: [] });
  });

  it('arrangement_add_track adds a track and returns its id', async () => {
    const { result } = await invokeHandler(audioHandlers, 'arrangement_add_track', { name: 'Lead' });
    expect(result.success).toBe(true);
    const trackId = (result.result as { trackId: string }).trackId;
    expect(arr().arrangement.tracks).toEqual([{ id: trackId, name: 'Lead', muted: false }]);
  });

  it('arrangement_add_clip places a clip on the track (same effect as the panel)', async () => {
    const trackId = arr().addTrack('T');
    const { result } = await invokeHandler(audioHandlers, 'arrangement_add_clip', {
      trackId,
      sourceUrl: 'music-boss',
      sourceDurationSeconds: 40,
    });
    expect(result.success).toBe(true);
    expect(arr().arrangement.clips[0]).toMatchObject({ trackId, sourceUrl: 'music-boss', sourceDurationSeconds: 40 });
  });

  it('arrangement_add_clip reports an unknown track instead of a phantom clip', async () => {
    const { result } = await invokeHandler(audioHandlers, 'arrangement_add_clip', {
      trackId: 'ghost',
      sourceUrl: 'x',
      sourceDurationSeconds: 10,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('track not found');
    expect(arr().arrangement.clips).toHaveLength(0);
  });

  it('arrangement_move_clip / trim_clip / set_loop mutate the same clip the panel would', async () => {
    const trackId = arr().addTrack();
    const clipId = arr().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 20 })!;

    await invokeHandler(audioHandlers, 'arrangement_move_clip', { clipId, startOffset: 7 });
    expect(arr().arrangement.clips[0].startOffset).toBe(7);

    await invokeHandler(audioHandlers, 'arrangement_trim_clip', { clipId, trimStart: 3, trimEnd: 15 });
    expect(arr().arrangement.clips[0]).toMatchObject({ trimStart: 3, trimEnd: 15 });

    await invokeHandler(audioHandlers, 'arrangement_set_loop', { clipId, loopEnabled: true });
    expect(arr().arrangement.clips[0].loopEnabled).toBe(true);
  });

  it('arrangement_move_clip reports an unknown target track instead of silently no-op-ing', async () => {
    const trackId = arr().addTrack();
    const clipId = arr().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 20 })!;

    const { result } = await invokeHandler(audioHandlers, 'arrangement_move_clip', {
      clipId,
      startOffset: 4,
      trackId: 'ghost-track',
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('track not found'),
    });
    // The clip must be untouched — no silent partial move.
    expect(arr().arrangement.clips[0]).toMatchObject({ trackId, startOffset: 0 });
  });

  // Each of the three clip-mutating handlers guards on the clip existing before
  // touching the store. Without a test per handler, a regression that silently
  // no-ops (or throws) on an unknown clipId would pass the suite — the mutate
  // test above only ever hands them a real clip.
  it.each([
    ['arrangement_move_clip', { clipId: 'ghost', startOffset: 4 }],
    ['arrangement_trim_clip', { clipId: 'ghost', trimStart: 1, trimEnd: 5 }],
    ['arrangement_set_loop', { clipId: 'ghost', loopEnabled: true }],
  ] as const)('%s reports a missing clip instead of mutating', async (handler, args) => {
    // A real track exists but no clip with this id — the guard must still fire.
    arr().addTrack();
    const { result } = await invokeHandler(audioHandlers, handler, args);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('clip not found'),
    });
    expect(arr().arrangement.clips).toHaveLength(0);
  });

  it('arrangement_delete_clip / delete_track report a missing target and remove a real one', async () => {
    const missing = await invokeHandler(audioHandlers, 'arrangement_delete_clip', { clipId: 'nope' });
    expect(missing.result.success).toBe(false);

    const trackId = arr().addTrack();
    const clipId = arr().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 10 })!;
    const del = await invokeHandler(audioHandlers, 'arrangement_delete_clip', { clipId });
    expect(del.result.success).toBe(true);
    expect(arr().arrangement.clips).toHaveLength(0);

    const delTrack = await invokeHandler(audioHandlers, 'arrangement_delete_track', { trackId });
    expect(delTrack.result.success).toBe(true);
    expect(arr().arrangement.tracks).toHaveLength(0);
  });

  // Parity with the MusicArrangementPanel Mute checkbox (setTrackMuted). Without
  // an AI/MCP command the manual control had no in-app-AI equivalent.
  it('arrangement_set_track_muted mutes and unmutes a real track', async () => {
    const trackId = arr().addTrack();
    const mute = await invokeHandler(audioHandlers, 'arrangement_set_track_muted', { trackId, muted: true });
    expect(mute.result.success).toBe(true);
    expect(arr().arrangement.tracks[0].muted).toBe(true);

    await invokeHandler(audioHandlers, 'arrangement_set_track_muted', { trackId, muted: false });
    expect(arr().arrangement.tracks[0].muted).toBe(false);
  });

  it('arrangement_set_track_muted reports a missing track instead of mutating', async () => {
    const { result } = await invokeHandler(audioHandlers, 'arrangement_set_track_muted', { trackId: 'ghost', muted: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('track not found');
  });

  it('arrangement mutations from the AI path are undoable, sharing the panel history', async () => {
    const trackId = arr().addTrack();
    await invokeHandler(audioHandlers, 'arrangement_add_clip', { trackId, sourceUrl: 'a', sourceDurationSeconds: 10 });
    expect(arr().arrangement.clips).toHaveLength(1);
    arr().undo();
    expect(arr().arrangement.clips).toHaveLength(0);
  });

  it('arrangement_set_tempo clamps and reports the applied tempo', async () => {
    const { result } = await invokeHandler(audioHandlers, 'arrangement_set_tempo', { bpm: 999 });
    expect(result.success).toBe(true);
    expect(arr().arrangement.tempoBpm).toBe(400);
  });
});
