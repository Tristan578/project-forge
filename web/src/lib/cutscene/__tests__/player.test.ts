import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  it('camera track translates authoring params into the engine wire form', () => {
    const cmd = buildCommand(
      'camera',
      'cam1',
      makeKF({ mode: 'orbital', targetEntity: 'hero', orbitalDistance: 12, orbitalAutoRotateSpeed: 20 }),
      0.5,
    );
    expect(cmd?.command).toBe('set_game_camera');
    // Full shape, not objectContaining: an invented key sitting alongside the
    // asserted ones is exactly what this ticket exists to stop shipping.
    expect(cmd?.payload).toEqual({
      entityId: 'cam1',
      mode: 'orbital',
      targetEntity: 'hero',
      radius: 12,
      autoRotateSpeed: 20,
      // Derived from the speed, not authored: emitting it makes the authoring
      // vocabulary the owner of `autoRotate`, so a stale flag from an earlier
      // engine report cannot survive a round trip and mute this rotation.
      autoRotate: true,
    });
  });

  it('camera track collapses third-person distance and height into one offset', () => {
    const cmd = buildCommand(
      'camera',
      'cam1',
      makeKF({ mode: 'thirdPersonFollow', followDistance: 8, followHeight: 3, followSmoothing: 4 }),
      1,
    );
    expect(cmd?.payload).toEqual({
      entityId: 'cam1',
      mode: 'thirdPersonFollow',
      targetEntity: null,
      offset: [0, 3, -8],
      damping: 4,
    });
  });

  it('camera track drops keys the engine cannot receive', () => {
    const cmd = buildCommand(
      'camera',
      'cam1',
      makeKF({
        mode: 'topDown',
        topDownHeight: 20,
        // Phantom parameters an earlier vocabulary advertised, plus arbitrary
        // model output. None reach the wire.
        topDownAngle: 45,
        followLookAhead: 2,
        sideScrollerHeight: 6,
        _easedProgress: 0.5,
      }),
      0.5,
    );
    expect(cmd?.payload).toEqual({
      entityId: 'cam1',
      mode: 'topDown',
      targetEntity: null,
      height: 20,
    });
  });

  it('camera track ignores non-finite numeric params rather than resetting them', () => {
    const cmd = buildCommand('camera', 'cam1', makeKF({ mode: 'topDown', topDownHeight: NaN }), 1);
    expect(cmd?.payload).toEqual({ entityId: 'cam1', mode: 'topDown', targetEntity: null });
  });

  it('camera track does not read params off the prototype chain', () => {
    // Keyframe payloads are model-authored, so a `__proto__` entry in that JSON
    // produces exactly this object. The inherited value must not reach the wire:
    // once picked it would be written as an OWN property on the camera data, so
    // the `Object.hasOwn` check further down the payload builder cannot catch it.
    const payload = Object.create({ topDownHeight: 999 }) as Record<string, unknown>;
    payload.mode = 'topDown';

    const cmd = buildCommand('camera', 'cam1', makeKF(payload), 0.5);
    expect(cmd?.payload).toEqual({ entityId: 'cam1', mode: 'topDown', targetEntity: null });
  });

  it('camera track returns null when entityId is null', () => {
    const cmd = buildCommand('camera', null, makeKF({ mode: 'orbital' }), 0.5);
    expect(cmd).toBeNull();
  });

  it('camera track returns null for an unrecognized mode', () => {
    // The old PascalCase vocabulary — the engine has never had a mode by this name.
    const cmd = buildCommand('camera', 'cam1', makeKF({ mode: 'Orbital' }), 0.5);
    expect(cmd).toBeNull();
  });

  it('camera track returns null when the payload names no mode', () => {
    const cmd = buildCommand('camera', 'cam1', makeKF(), 0.5);
    expect(cmd).toBeNull();
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
    expect(cmd?.payload).toEqual({ treeId: 'tree_1', entityId: 'npc1' });
  });

  it('dialogue track returns null when the payload names no tree', () => {
    // A command carrying `treeId: undefined` names nothing to start. Building it
    // anyway produced a dispatch that could only ever be a no-op.
    expect(buildCommand('dialogue', 'npc1', makeKF(), 0)).toBeNull();
    expect(buildCommand('dialogue', 'npc1', makeKF({ treeId: 42 }), 0)).toBeNull();
  });

  it('audio track sends only the field play_audio reads', () => {
    // `handle_play_audio` reads `entityId` and stops. The rest of the keyframe
    // payload used to be spread onto the command and dropped by the engine with
    // no error — a payload that looked like it configured playback.
    const cmd = buildCommand('audio', 'sfx1', makeKF({ volume: 0.8, fadeIn: 2 }), 0);
    expect(cmd?.command).toBe('play_audio');
    expect(cmd?.payload).toEqual({ entityId: 'sfx1' });
  });

  it('audio track returns null when entityId is null', () => {
    const cmd = buildCommand('audio', null, makeKF(), 0);
    expect(cmd).toBeNull();
  });

  it('wait track returns null', () => {
    const cmd = buildCommand('wait', null, makeKF(), 0.5);
    expect(cmd).toBeNull();
  });
});

// ============================================================================
// Camera easing
//
// `set_game_camera` is an absolute set — the engine has no notion of a
// transition — so a camera move that is meant to take time has to be stepped
// JS-side. It never was: the command carried the eased progress as
// `_easedProgress`, a field no engine command reads and nothing on the JS side
// consumed, so `applyEasing` had no production caller at all and a three-second
// eased move snapped on its first frame.
// ============================================================================

describe('buildCommand — camera easing', () => {
  const cam = (payload: Record<string, unknown>, easing: CutsceneKeyframe['easing'] = 'linear') =>
    ({ timestamp: 0, duration: 2, easing, payload }) satisfies CutsceneKeyframe;

  it('blends from the previous keyframe on the same track', () => {
    const cmd = buildCommand(
      'camera',
      'cam1',
      cam({ mode: 'topDown', topDownHeight: 30 }),
      0.5,
      cam({ mode: 'topDown', topDownHeight: 10 }),
    );

    expect(cmd?.payload).toEqual({
      entityId: 'cam1',
      mode: 'topDown',
      targetEntity: null,
      height: 20,
    });
  });

  it('applies the keyframe easing curve, not raw progress', () => {
    // ease_in at t=0.5 is 0.25, so a 0 -> 100 move is a quarter of the way in.
    const cmd = buildCommand(
      'camera',
      'cam1',
      cam({ mode: 'topDown', topDownHeight: 100 }, 'ease_in'),
      0.5,
      cam({ mode: 'topDown', topDownHeight: 0 }),
    );

    expect((cmd?.payload as Record<string, unknown>).height).toBeCloseTo(25);
  });

  it('cuts to the target with no predecessor — the prior state is unknowable here', () => {
    const cmd = buildCommand('camera', 'cam1', cam({ mode: 'topDown', topDownHeight: 30 }), 0.5);
    expect((cmd?.payload as Record<string, unknown>).height).toBe(30);
  });

  it('cuts across a mode change rather than blending unrelated parameters', () => {
    const cmd = buildCommand(
      'camera',
      'cam1',
      cam({ mode: 'topDown', topDownHeight: 30 }),
      0.5,
      cam({ mode: 'orbital', orbitalDistance: 200 }),
    );
    expect((cmd?.payload as Record<string, unknown>).height).toBe(30);
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

  it('stop calls onStop when playback was active', () => {
    const cs = {
      id: 'cs1', name: 'Test', duration: 10, tracks: [], createdAt: 0, updatedAt: 0,
    };
    player.load(cs);
    player.play();
    player.stop();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('stop does not call onStop when nothing was playing', () => {
    player.stop();
    expect(onStop).not.toHaveBeenCalled();
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

  // --------------------------------------------------------------------------
  // Scheduling
  //
  // These drive the real rAF loop against a stubbed clock. A duration-based
  // keyframe re-dispatches on every frame so easing can be stepped, and that
  // only makes sense where the command sets a state the next dispatch
  // supersedes. Every other track type is a one-shot trigger, so the same loop
  // was restarting the sound, the clip and the dialogue ~60 times a second for
  // the length of the keyframe.
  // --------------------------------------------------------------------------
  describe('duration-based keyframes', () => {
    let advance: (ms: number) => void;

    beforeEach(() => {
      let now = 0;
      let pending: FrameRequestCallback[] = [];
      vi.stubGlobal('performance', { now: () => now });
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        pending.push(cb);
        return pending.length;
      });
      vi.stubGlobal('cancelAnimationFrame', () => {});
      advance = (ms: number) => {
        now += ms;
        const due = pending;
        pending = [];
        for (const cb of due) cb(now);
      };
      player = new CutscenePlayer({ dispatchCommand: dispatch, onComplete, onStop });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function loadTracks(...tracks: CutsceneTrack[]) {
      player.load({
        id: 'cs1', name: 'Test', duration: 10, tracks, createdAt: 0, updatedAt: 0,
      });
      player.play();
    }

    const dispatched = () => (dispatch as ReturnType<typeof vi.fn>).mock.calls;

    it('re-dispatches a camera keyframe each frame, stepping toward the target', () => {
      loadTracks({
        id: 't1', type: 'camera', entityId: 'cam1', muted: false,
        keyframes: [
          { timestamp: 0, duration: 0, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 10 } },
          { timestamp: 1, duration: 2, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 30 } },
        ],
      });

      advance(1000); // t=1 — the move begins, still at the previous height
      advance(1000); // t=2 — halfway through a 2s move
      advance(1000); // t=3 — arrived

      const heights = dispatched()
        .filter(([command]) => command === 'set_game_camera')
        .map(([, payload]) => (payload as Record<string, unknown>).height);

      expect(heights).toEqual([10, 10, 20, 30]);
    });

    it('fires a one-shot track once, however long its keyframe lasts', () => {
      loadTracks({
        id: 't1', type: 'audio', entityId: 'sfx1', muted: false,
        keyframes: [{ timestamp: 0, duration: 5, easing: 'linear', payload: {} }],
      });

      advance(1000);
      advance(1000);
      advance(1000);

      expect(dispatched()).toEqual([['play_audio', { entityId: 'sfx1' }]]);
    });

    it('links each keyframe to its own track, not to whatever fired before it', () => {
      // The schedule is flattened across every track and sorted by timestamp, so
      // the element before cam2's keyframe belongs to a different camera. Blending
      // from it would move cam2 out of a state it was never in.
      loadTracks(
        {
          id: 't1', type: 'camera', entityId: 'cam1', muted: false,
          keyframes: [{ timestamp: 0, duration: 0, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 10 } }],
        },
        {
          id: 't2', type: 'camera', entityId: 'cam2', muted: false,
          keyframes: [{ timestamp: 0, duration: 2, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 30 } }],
        },
      );

      advance(1000); // t=1 — halfway through cam2's window, were it blending

      const cam2Heights = dispatched()
        .map(([, payload]) => payload as Record<string, unknown>)
        .filter((payload) => payload.entityId === 'cam2')
        .map((payload) => payload.height);

      expect(cam2Heights).toEqual([30]);
    });
  });

  it('muted tracks are not scheduled', () => {
    // A track that WOULD dispatch if it were not muted — a camera track with no
    // entityId or no mode builds no command at all, so muting it proves nothing.
    const track: CutsceneTrack = {
      id: 't1', type: 'camera', entityId: 'cam1', muted: true,
      keyframes: [{ timestamp: 0, duration: 1, easing: 'linear', payload: { mode: 'orbital' } }],
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
