import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyEasing, buildCommand, CutscenePlayer, type CommandDispatcher } from '../player';
import type { CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';

// ============================================================================
// applyEasing
// ============================================================================

describe('applyEasing', () => {
  it('linear returns t unchanged', () => {
    expect(applyEasing(0.5, 'linear')).toBeCloseTo(0.5);
  });

  it('linear clamps below 0', () => {
    expect(applyEasing(-1, 'linear')).toBe(0);
  });

  it('linear clamps above 1', () => {
    expect(applyEasing(2, 'linear')).toBe(1);
  });

  it('ease_in is slower at the start', () => {
    expect(applyEasing(0.5, 'ease_in')).toBeCloseTo(0.25);
  });

  it('ease_out is faster at the start', () => {
    expect(applyEasing(0.5, 'ease_out')).toBeCloseTo(0.75);
  });

  it('ease_in_out is symmetric at 0.5', () => {
    expect(applyEasing(0.5, 'ease_in_out')).toBeCloseTo(0.5);
  });

  it('ease_in_out starts slow (t=0.1)', () => {
    const eased = applyEasing(0.1, 'ease_in_out');
    const linear = 0.1;
    expect(eased).toBeLessThan(linear);
  });

  it('all easings return 0 at t=0', () => {
    for (const mode of ['linear', 'ease_in', 'ease_out', 'ease_in_out'] as const) {
      expect(applyEasing(0, mode)).toBeCloseTo(0);
    }
  });

  it('all easings return 1 at t=1', () => {
    for (const mode of ['linear', 'ease_in', 'ease_out', 'ease_in_out'] as const) {
      expect(applyEasing(1, mode)).toBeCloseTo(1);
    }
  });
});

// ============================================================================
// buildCommand
// ============================================================================

function makeKF(payload: Record<string, unknown> = {}): CutsceneKeyframe {
  return { timestamp: 0, duration: 1, easing: 'linear', payload };
}

describe('buildCommand', () => {
  it('camera track returns set_game_camera', () => {
    const cmd = buildCommand('camera', null, makeKF({ mode: 'Orbital' }), 0.5);
    expect(cmd?.command).toBe('set_game_camera');
    expect((cmd?.payload as Record<string, unknown>).mode).toBe('Orbital');
  });

  it('animation track returns play_animation', () => {
    const cmd = buildCommand('animation', 'entity1', makeKF({ clipName: 'run' }), 1);
    expect(cmd?.command).toBe('play_animation');
    expect((cmd?.payload as Record<string, unknown>).entityId).toBe('entity1');
    expect((cmd?.payload as Record<string, unknown>).clipName).toBe('run');
  });

  it('animation track returns null when entityId is null', () => {
    const cmd = buildCommand('animation', null, makeKF({ clipName: 'run' }), 1);
    expect(cmd).toBeNull();
  });

  it('dialogue track returns start_dialogue', () => {
    const cmd = buildCommand('dialogue', 'npc1', makeKF({ treeId: 'tree_1' }), 0);
    expect(cmd?.command).toBe('start_dialogue');
  });

  it('audio track returns play_audio', () => {
    const cmd = buildCommand('audio', 'sfx1', makeKF({ volume: 0.8 }), 0);
    expect(cmd?.command).toBe('play_audio');
    expect((cmd?.payload as Record<string, unknown>).entityId).toBe('sfx1');
  });

  it('audio track returns null when entityId is null', () => {
    const cmd = buildCommand('audio', null, makeKF(), 0);
    expect(cmd).toBeNull();
  });

  it('wait track returns null', () => {
    const cmd = buildCommand('wait', null, makeKF(), 0.5);
    expect(cmd).toBeNull();
  });

  it('includes _easedProgress on camera commands', () => {
    const cmd = buildCommand('camera', null, makeKF(), 0.5);
    expect(typeof (cmd?.payload as Record<string, unknown>)._easedProgress).toBe('number');
  });
});

// ============================================================================
// CutscenePlayer
// ============================================================================

describe('CutscenePlayer', () => {
  let dispatch: CommandDispatcher;
  let onComplete: (() => void) | undefined;
  let onStop: (() => void) | undefined;
  let player: CutscenePlayer;

  beforeEach(() => {
    dispatch = vi.fn() as unknown as CommandDispatcher;
    onComplete = vi.fn() as unknown as () => void;
    onStop = vi.fn() as unknown as () => void;
    player = new CutscenePlayer({ dispatchCommand: dispatch, onComplete, onStop });

    // Reset store state
    useCutsceneStore.setState({
      cutscenes: {},
      activeCutsceneId: null,
      playbackState: 'idle',
      playbackTime: 0,
    });
  });

  it('isPlaying is false before load', () => {
    expect(player.isPlaying).toBe(false);
  });

  it('stop without load does not throw', () => {
    expect(() => player.stop()).not.toThrow();
  });

  it('play without load does not throw', () => {
    expect(() => player.play()).not.toThrow();
  });

  it('stop calls onStop', () => {
    player.stop();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('stop resets playback time in store', () => {
    useCutsceneStore.getState().setPlaybackTime(5);
    player.stop();
    expect(useCutsceneStore.getState().playbackTime).toBe(0);
  });

  it('stop sets playback state to stopped', () => {
    player.stop();
    expect(useCutsceneStore.getState().playbackState).toBe('stopped');
  });

  it('pause sets playback state to paused', () => {
    const cs = {
      id: 'cs1', name: 'Test', duration: 10, tracks: [], createdAt: 0, updatedAt: 0,
    };
    player.load(cs);
    player.play();
    player.pause();
    expect(useCutsceneStore.getState().playbackState).toBe('paused');
    expect(player.isPlaying).toBe(false);
  });

  it('seek clamps to [0, duration]', () => {
    const cs = {
      id: 'cs1', name: 'Test', duration: 10, tracks: [], createdAt: 0, updatedAt: 0,
    };
    player.load(cs);
    player.seek(-5);
    expect(useCutsceneStore.getState().playbackTime).toBe(0);
    player.seek(100);
    expect(useCutsceneStore.getState().playbackTime).toBe(10);
  });

  it('muted tracks are not scheduled', () => {
    const track: CutsceneTrack = {
      id: 't1', type: 'camera', entityId: null, muted: true,
      keyframes: [{ timestamp: 0, duration: 1, easing: 'linear', payload: {} }],
    };
    const cs = {
      id: 'cs1', name: 'Test', duration: 5,
      tracks: [track], createdAt: 0, updatedAt: 0,
    };
    player.load(cs);
    // play + immediately pause so no rAF ticks happen
    player.play();
    player.pause();
    // dispatch should NOT have been called for the muted track at t=0
    expect(dispatch).not.toHaveBeenCalled();
  });
});
