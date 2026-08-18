import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  applyEasing,
  buildCommand,
  CutscenePlayer,
  readCameraData,
  type CommandDispatcher,
} from '../player';
import type { CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';

// The keyframe error boundary reports to Sentry as well as the console. Mocked so
// the suite asserts on the report without pulling the SDK into the module graph.
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-client', () => ({ captureException }));

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

  it('camera track drops an inherited param rather than sending it', () => {
    // Called directly, NOT through `buildCommand`. `buildCommand` sanitizes the
    // payload first, and the sanitizer already drops inherited keys — so the
    // same assertion routed through it passes with every `Object.hasOwn` in the
    // payload builder deleted. Verified by mutation: both guards survive when
    // this is written against `buildCommand`.
    //
    // What is being pinned is the payload reader's own contract. Its parameter
    // says `Record<string, unknown>`, so it cannot assume a sanitized input, and
    // a `__proto__` entry in model-authored JSON produces exactly this object.
    // An inherited value that got picked would be written as an OWN property on
    // the camera data, past the point where anything downstream could tell.
    const payload = Object.create({ topDownHeight: 999 }) as Record<string, unknown>;
    payload.mode = 'topDown';

    expect(readCameraData(payload)).toEqual({
      mode: 'topDown',
      targetEntity: null,
    });
  });

  it('camera track does not read the mode or target off the prototype chain either', () => {
    // `mode` decides whether this dispatches at all, so an inherited one is the
    // difference between a no-op and a camera reconfigured by a key the author
    // never set — the highest-value of the three fields to guard.
    const inherited = Object.create({
      mode: 'topDown',
      targetEntity: 'someone-elses-entity',
    }) as Record<string, unknown>;

    expect(readCameraData(inherited)).toBeNull();

    const ownModeOnly = Object.create({ targetEntity: 'someone-elses-entity' }) as Record<
      string,
      unknown
    >;
    ownModeOnly.mode = 'topDown';

    expect(readCameraData(ownModeOnly)).toEqual({
      mode: 'topDown',
      targetEntity: null,
    });
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

  it('animation track drops keys the engine cannot receive', () => {
    const cmd = buildCommand(
      'animation',
      'entity1',
      makeKF({ clipName: 'run', crossfadeSecs: 0.25, loop: true, speed: 2 }),
      1,
    );
    expect(cmd?.payload).toEqual({ entityId: 'entity1', clipName: 'run', crossfadeSecs: 0.25 });
  });

  it.each([
    ['names no clip', {}],
    ['names the empty clip', { clipName: '' }],
    ['gives a non-string clip name', { clipName: 42 }],
  ])('animation track returns null when the payload %s', (_case, payload) => {
    // This used to dispatch `play_animation` for the empty clip, which the
    // engine can only ignore — a no-op indistinguishable in a log from a hit.
    expect(buildCommand('animation', 'entity1', makeKF(payload), 1)).toBeNull();
  });

  it.each([
    ['the model gave a non-numeric one', { clipName: 'run', crossfadeSecs: 'quickly' }],
    ['the model gave a negative one', { clipName: 'run', crossfadeSecs: -1 }],
    ['the payload has none at all', { clipName: 'run' }],
  ])('animation track omits crossfadeSecs when %s', (_case, payload) => {
    const cmd = buildCommand('animation', 'entity1', makeKF(payload), 1);
    // OMITTED, not defaulted to 0. `handle_play_animation` reads this field as
    // `unwrap_or(0.3)`, so a 0 written here is not "no opinion" — it is an
    // instant cut that overrides the engine's own crossfade. Absence is the
    // only way to ask for the engine default.
    expect(cmd?.payload).toEqual({ entityId: 'entity1', clipName: 'run' });
    expect(Object.hasOwn(cmd?.payload as object, 'crossfadeSecs')).toBe(false);
  });

  it('animation track keeps an explicit zero crossfade, which asks for a cut', () => {
    const cmd = buildCommand('animation', 'entity1', makeKF({ clipName: 'run', crossfadeSecs: 0 }), 1);
    expect(cmd?.payload).toEqual({ entityId: 'entity1', clipName: 'run', crossfadeSecs: 0 });
  });

  it('dialogue track returns start_dialogue, stamped with the beat it came from', () => {
    // `beat` is the keyframe's own timestamp. A dialogue keyframe with a
    // duration is re-dispatched on every frame of its window, so the handler
    // needs it to tell "the same beat again" — which must not reopen the tree —
    // from a later beat that happens to name the same one.
    const cmd = buildCommand('dialogue', 'npc1', makeKF({ treeId: 'tree_1' }), 0);
    expect(cmd?.command).toBe('start_dialogue');
    expect(cmd?.payload).toEqual({ treeId: 'tree_1', entityId: 'npc1', beat: 0 });
  });

  it('dialogue track still fires without an entity, since narration has no speaker', () => {
    const cmd = buildCommand('dialogue', null, makeKF({ treeId: 'tree_1' }), 0);
    expect(cmd?.payload).toEqual({ treeId: 'tree_1', entityId: undefined, beat: 0 });
  });

  it.each([
    ['names no tree', {}],
    ['names the empty tree', { treeId: '' }],
    ['gives a numeric tree id', { treeId: 42 }],
    ['gives a non-string tree id', { treeId: { id: 'tree_1' } }],
  ])('dialogue track returns null when the payload %s', (_case, payload) => {
    // `treeId` used to be forwarded unread, so a missing one started a dialogue
    // named `undefined` rather than declining to start one. The handler looks the
    // tree up by this value, so anything that is not a string finds nothing and
    // the beat passes as if it had played.
    expect(buildCommand('dialogue', 'npc1', makeKF(payload), 0)).toBeNull();
  });

  it('audio track sends only the field play_audio reads', () => {
    // `handle_play_audio` reads `entityId` and stops. The rest of the keyframe
    // payload used to be spread onto the command and dropped by the engine with
    // no error — a payload that looked like it configured playback.
    const cmd = buildCommand('audio', 'sfx1', makeKF({ volume: 0.8, fadeIn: 2 }), 0);
    expect(cmd?.command).toBe('play_audio');
    expect(cmd?.payload).toEqual({ entityId: 'sfx1' });
  });

  it('audio track cannot be made to address a different entity', () => {
    // The whole payload used to be spread into the command, so a payload key
    // named `entityId` renamed the entity the track addresses — the track's own
    // field, and not the payload's to set. Sending only the track's `entityId`
    // closes that regardless of what the keyframe carries.
    const cmd = buildCommand(
      'audio',
      'sfx1',
      makeKF({
        volume: 0.8,
        pitch: 1.2,
        clipUrl: 'https://example.invalid/a.mp3',
        loop: true,
        entityId: 'someone-elses-entity',
      }),
      0,
    );
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
  let dispatch: Mock<CommandDispatcher>;
  let onComplete: Mock<() => void>;
  let onStop: Mock<() => void>;
  let player: CutscenePlayer;

  // Shared rAF harness. `advance(ms)` moves the stubbed clock forward and runs
  // every frame the player has queued, so a test drives playback frame by frame
  // rather than waiting on a real clock — which is the only way to ask how many
  // frames a given keyframe sees.
  function installFakeClock(): (ms: number) => void {
    let now = 0;
    let pending: FrameRequestCallback[] = [];
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending.push(cb);
      return pending.length;
    });
    // Cancellation is honoured rather than stubbed away. `pause()` and `stop()`
    // both call it, and a no-op cancel would run a frame the player had already
    // called off — a paused player would go on ticking.
    vi.stubGlobal('cancelAnimationFrame', () => {
      pending = [];
    });
    return (ms: number) => {
      now += ms;
      const due = pending;
      pending = [];
      for (const cb of due) cb(now);
    };
  }

  beforeEach(() => {
    dispatch = vi.fn();
    onComplete = vi.fn();
    onStop = vi.fn();
    captureException.mockClear();
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
      advance = installFakeClock();
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

    const dispatched = () => dispatch.mock.calls;

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

    it('fires a camera keyframe that cannot blend once, not on every frame', () => {
      // No predecessor, so every frame would dispatch the identical payload —
      // no change in the engine, and ~60 GAME_CAMERA_CHANGED round trips a
      // second through the store and React.
      loadTracks({
        id: 't1', type: 'camera', entityId: 'cam1', muted: false,
        keyframes: [
          { timestamp: 0, duration: 5, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 30 } },
        ],
      });

      advance(1000);
      advance(1000);
      advance(1000);

      expect(dispatched().filter(([command]) => command === 'set_game_camera')).toHaveLength(1);
    });

    it('fires a camera keyframe once across a mode change, which it cannot blend', () => {
      loadTracks({
        id: 't1', type: 'camera', entityId: 'cam1', muted: false,
        keyframes: [
          { timestamp: 0, duration: 0, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 10 } },
          { timestamp: 1, duration: 4, easing: 'linear', payload: { mode: 'orbital', orbitalDistance: 30 } },
        ],
      });

      advance(1000);
      advance(1000);
      advance(1000);

      const orbital = dispatched()
        .map(([, payload]) => payload as Record<string, unknown>)
        .filter((payload) => payload.mode === 'orbital');

      expect(orbital).toHaveLength(1);
    });

    // ------------------------------------------------------------------------
    // A seek marked every keyframe before the target as already fired, which is
    // right for a trigger and wrong for a state: the camera keeps whatever it
    // held when the seek happened, so seeking INTO a blend applied it and
    // seeking one frame PAST the same blend applied nothing at all.
    // ------------------------------------------------------------------------
    describe('seeking over keyframes', () => {
      const heights = () =>
        dispatched()
          .filter(([command]) => command === 'set_game_camera')
          .map(([, payload]) => (payload as Record<string, unknown>).height);

      it('applies a camera blend the seek jumped clean over', () => {
        loadTracks({
          id: 't1', type: 'camera', entityId: 'cam1', muted: false,
          keyframes: [
            { timestamp: 0, duration: 0, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 10 } },
            { timestamp: 1, duration: 2, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 30 } },
          ],
        });

        advance(500); // t=0.5 — only the first keyframe has fired
        player.seek(5); // past the blend's end at t=3 entirely
        advance(16);

        expect(heights().at(-1)).toBe(30);
      });

      it('applies a camera cut the seek jumped over', () => {
        // No predecessor, so this takes the one-shot path — the branch a seek
        // suppressed just as thoroughly as the blending one.
        loadTracks({
          id: 't1', type: 'camera', entityId: 'cam1', muted: false,
          keyframes: [
            { timestamp: 1, duration: 5, easing: 'linear', payload: { mode: 'topDown', topDownHeight: 30 } },
          ],
        });

        advance(500); // t=0.5 — before the keyframe
        player.seek(8);
        advance(16);

        expect(heights()).toEqual([30]);
      });

      it('does not replay a trigger the seek jumped over', () => {
        loadTracks({
          id: 't1', type: 'audio', entityId: 'sfx1', muted: false,
          keyframes: [{ timestamp: 0, duration: 0, easing: 'linear', payload: {} }],
        });

        advance(500);
        player.seek(5);
        advance(16);

        expect(dispatched()).toEqual([['play_audio', { entityId: 'sfx1' }]]);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Playback lifecycle
  //
  // `fired` is the only thing standing between a keyframe and a re-dispatch, so
  // the transitions that touch it — `play` from a stop, `seek`, the per-tick
  // latch — are pinned individually, along with the two edges no test used to
  // reach at all: the terminal tick, and a keyframe whose sink throws.
  // --------------------------------------------------------------------------
  describe('playback lifecycle', () => {
    let advance: (ms: number) => void;

    beforeEach(() => {
      advance = installFakeClock();
      player = new CutscenePlayer({ dispatchCommand: dispatch, onComplete, onStop });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function loadSingleTrack(type: CutsceneTrack['type'], payload: Record<string, unknown>): void {
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 10,
        tracks: [{
          id: 't1',
          type,
          entityId: 'e1',
          muted: false,
          // The keyframe spans several frames, so a per-frame re-fire shows up as
          // a call count rather than needing a timing assertion.
          keyframes: [{ timestamp: 0, duration: 4, easing: 'linear', payload }],
        }],
        createdAt: 0,
        updatedAt: 0,
      });
    }

    /**
     * One track, three beats at distinct timestamps.
     *
     * `loadSingleTrack` puts its only keyframe at `timestamp: 0`, which is where
     * the playhead already sits — so it can show that a keyframe fires once, but
     * never that it fires at its OWN time rather than at the start. Zero
     * durations keep this about scheduling and nothing else.
     */
    function loadMultiKeyframeTrack(): void {
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 10,
        tracks: [{
          id: 't1',
          type: 'animation',
          entityId: 'e1',
          muted: false,
          keyframes: [
            { timestamp: 0, duration: 0, easing: 'linear', payload: { clipName: 'first' } },
            { timestamp: 2, duration: 0, easing: 'linear', payload: { clipName: 'second' } },
            { timestamp: 3, duration: 0, easing: 'linear', payload: { clipName: 'third' } },
          ],
        }],
        createdAt: 0,
        updatedAt: 0,
      });
    }

    const clipNames = () =>
      dispatch.mock.calls.map((c) => (c[1] as { clipName?: string }).clipName);

    it('muted tracks are not scheduled', () => {
      // A track that WOULD dispatch if it were not muted — a camera track with no
      // entityId or no mode builds no command at all, so muting it proves nothing.
      player.load({
        id: 'cs1', name: 'Test', duration: 5, createdAt: 0, updatedAt: 0,
        tracks: [{
          id: 't1', type: 'camera', entityId: 'cam1', muted: true,
          keyframes: [{ timestamp: 0, duration: 1, easing: 'linear', payload: { mode: 'orbital' } }],
        }],
      });

      // Drive a real frame. This used to `play()` then `pause()` immediately,
      // which cancelled the rAF before it ever ran — so `tick()` never executed
      // and the assertion below held for a muted track, an unmuted one, and a
      // player with nothing loaded alike. Deleting the mute guard entirely left
      // the suite green. The clock is what gives the assertion something to
      // disprove.
      player.play();
      advance(1000);

      expect(dispatch).not.toHaveBeenCalled();
    });

    it('an unmuted copy of the same track does dispatch', () => {
      // The control for the test above: same fixture, `muted: false`. Without it,
      // "did not dispatch" cannot distinguish muting from a fixture that was
      // never going to dispatch in the first place.
      player.load({
        id: 'cs1', name: 'Test', duration: 5, createdAt: 0, updatedAt: 0,
        tracks: [{
          id: 't1', type: 'camera', entityId: 'cam1', muted: false,
          keyframes: [{ timestamp: 0, duration: 1, easing: 'linear', payload: { mode: 'orbital' } }],
        }],
      });

      player.play();
      advance(1000);

      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('an animation keyframe starts its clip once, however long it lasts', () => {
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      advance(1000);
      advance(1000);
      advance(1000);

      // `duration` bounds the beat, not the dispatching: re-firing would restart
      // the clip from frame one on every tick, so it would never play past its
      // first instant.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'run' });
    });

    it('a dialogue keyframe starts its tree once, stamped with its own beat', () => {
      loadSingleTrack('dialogue', { treeId: 'tree_1' });
      player.play();
      advance(1000);
      advance(1000);

      // `start_dialogue` has no engine arm; `./dispatch.ts` intercepts it and
      // drives the dialogue store. The player still goes through the dispatcher
      // rather than reaching for the store itself, so the interception stays the
      // one place that decision lives. `beat` names the keyframe it came from.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('start_dialogue', {
        treeId: 'tree_1',
        entityId: 'e1',
        beat: 0,
      });
    });

    it('replays every keyframe after stop() and play() again', () => {
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      advance(1000);
      expect(dispatch).toHaveBeenCalledTimes(1);

      player.stop();
      player.play();
      advance(1000);

      // `play()` clears every `fired` flag when it is not resuming from a pause,
      // so a second run is a second dispatch rather than a silent no-op.
      expect(dispatch).toHaveBeenCalledTimes(2);
    });

    it('does not replay a keyframe when resuming from pause', () => {
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      advance(1000);
      player.pause();
      player.play();
      advance(1000);

      // Resuming keeps the flags: a paused cutscene picks up where it left off
      // rather than restarting every beat already played.
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('seeking exactly onto a keyframe leaves it due to fire', () => {
      loadMultiKeyframeTrack();
      player.play();
      advance(500);
      expect(dispatch).toHaveBeenCalledTimes(1);
      dispatch.mockClear();

      // The keyframe AT the seek point has not happened yet: a keyframe fires
      // once the playhead REACHES its timestamp, so 2 is due at t=2, not done.
      // Marking it fired here — which is what `<=` did — made scrubbing
      // precisely onto a beat the one way to skip it.
      player.seek(2);
      advance(100);

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'e1',
        clipName: 'second',
      });
    });

    it('seeking past a keyframe skips it', () => {
      loadMultiKeyframeTrack();
      player.play();
      player.seek(3);
      advance(100);

      // Everything strictly before the seek point counts as already played, so
      // scrubbing forward does not fire a burst of the beats it flew past.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'e1',
        clipName: 'third',
      });
    });

    it('fires each keyframe as the playhead reaches its own timestamp', () => {
      loadMultiKeyframeTrack();
      player.play();

      advance(500);
      expect(clipNames()).toEqual(['first']);

      advance(2000);
      advance(1000);
      expect(clipNames()).toEqual(['first', 'second', 'third']);
    });

    // ------------------------------------------------------------------------
    // Keyframe error boundary
    //
    // `scheduleFrame()` runs AFTER the fire call, so an escaping throw used to
    // take the rAF loop with it: playback froze mid-cutscene with `isPlaying`
    // still true, `onComplete` never ran, and the editor stayed in Play mode.
    // ------------------------------------------------------------------------

    it('keeps playing when a keyframe sink throws', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        dispatch.mockImplementationOnce(() => {
          throw new Error('engine bridge is not loaded');
        });
        loadMultiKeyframeTrack();
        player.play();

        advance(500);
        advance(2000);

        // The bad beat is reported and dropped; the rest of the timeline plays.
        expect(player.isPlaying).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        expect(dispatch).toHaveBeenLastCalledWith('play_animation', {
          entityId: 'e1',
          clipName: 'second',
        });
      } finally {
        consoleError.mockRestore();
      }
    });

    it('does not retry a keyframe whose sink threw', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        dispatch.mockImplementation(() => {
          throw new Error('engine bridge is not loaded');
        });
        loadSingleTrack('animation', { clipName: 'run' });
        player.play();
        advance(1000);
        advance(1000);
        advance(1000);

        // A trigger keyframe is marked `fired` BEFORE the sink runs. One that
        // threw every frame would otherwise re-throw every frame, turning one
        // bad beat into a per-frame console flood for the whole cutscene.
        expect(dispatch).toHaveBeenCalledTimes(1);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('fires the beats after a throwing one on the final tick', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        dispatch.mockImplementationOnce(() => {
          throw new Error('engine bridge is not loaded');
        });
        player.load({
          id: 'cs1', name: 'Test', duration: 3, createdAt: 0, updatedAt: 0,
          tracks: [{
            id: 't1', type: 'animation', entityId: 'e1', muted: false,
            keyframes: [
              { timestamp: 2.5, duration: 0, easing: 'linear', payload: { clipName: 'throws' } },
              { timestamp: 3, duration: 0, easing: 'linear', payload: { clipName: 'last' } },
            ],
          }],
        });
        player.play();

        // Straight to the end: both keyframes come due on the terminal tick.
        advance(3000);

        // A per-TICK boundary reads as equivalent to a per-keyframe one, because
        // mid-playback the skipped keyframes are still unfired and the next tick
        // picks them up. Here there is no next tick — the rAF loop ends at
        // `duration` — so anything the throw skipped is lost for good.
        expect(consoleError).toHaveBeenCalled();
        expect(dispatch).toHaveBeenLastCalledWith('play_animation', {
          entityId: 'e1',
          clipName: 'last',
        });
        expect(onComplete).toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    it('reports a failed keyframe to Sentry, not only to the console', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        dispatch.mockImplementationOnce(() => {
          throw new Error('engine bridge is not loaded');
        });
        loadSingleTrack('animation', { clipName: 'walk' });
        player.play();
        advance(1000);

        // The boundary's job is to swallow the error, and a swallowed beat looks
        // like "the thing didn't happen" — nobody has a console open for that.
        expect(captureException).toHaveBeenCalledTimes(1);
        const [err, context] = captureException.mock.calls[0] as [Error, Record<string, unknown>];
        expect(err.message).toBe('engine bridge is not loaded');
        expect(context).toMatchObject({ trackId: 't1', trackType: 'animation', timestamp: 0 });
      } finally {
        consoleError.mockRestore();
      }
    });

    // ------------------------------------------------------------------------
    // End of the timeline
    //
    // The completion branch is the only path that fires a keyframe sitting
    // exactly at `duration` — the normal path returns before the playhead
    // reaches it — and `duration` is where a generated cutscene puts its closing
    // beat.
    // ------------------------------------------------------------------------

    it('fires a keyframe sitting exactly at duration and completes once', () => {
      player.load({
        id: 'cs1', name: 'Test', duration: 2, createdAt: 0, updatedAt: 0,
        tracks: [{
          id: 't1', type: 'animation', entityId: 'e1', muted: false,
          keyframes: [{ timestamp: 2, duration: 0, easing: 'linear', payload: { clipName: 'closing' } }],
        }],
      });
      player.play();

      advance(1000);
      expect(dispatch).not.toHaveBeenCalled();

      advance(1000);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'closing' });
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(player.isPlaying).toBe(false);
      expect(useCutsceneStore.getState().playbackState).toBe('idle');
      expect(useCutsceneStore.getState().playbackTime).toBe(2);
    });

    it('a zero-duration cutscene completes on its first tick', () => {
      // The degenerate case of the same branch: the first frame is already terminal.
      player.load({
        id: 'cs1', name: 'Test', duration: 0, createdAt: 0, updatedAt: 0,
        tracks: [{
          id: 't1', type: 'animation', entityId: 'e1', muted: false,
          keyframes: [{ timestamp: 0, duration: 0, easing: 'linear', payload: { clipName: 'only' } }],
        }],
      });
      player.play();
      advance(0);

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(player.isPlaying).toBe(false);
      expect(useCutsceneStore.getState().playbackState).toBe('idle');
    });

    it('fires both keyframes sharing a timestamp, in track order', () => {
      player.load({
        id: 'cs1', name: 'Test', duration: 5, createdAt: 0, updatedAt: 0,
        tracks: [{
          id: 't1', type: 'animation', entityId: 'e1', muted: false,
          keyframes: [
            { timestamp: 1, duration: 0, easing: 'linear', payload: { clipName: 'a' } },
            { timestamp: 1, duration: 0, easing: 'linear', payload: { clipName: 'b' } },
          ],
        }],
      });
      player.play();
      advance(1000);

      // Both are due and both unfired, so one tick fires both. Array.prototype.sort
      // is stable, so the schedule keeps the authored order.
      expect(clipNames()).toEqual(['a', 'b']);
    });

    it('fires keyframes in timestamp order across tracks, not authored order', () => {
      // Authored so that track order and timestamp order DISAGREE: the earlier
      // beat lives on the second track. The schedule flattens the tracks in order
      // and then sorts, so only the sort can put these the right way round.
      //
      // A single tick that catches up on several beats replays them in schedule
      // order, and these two are the same track type — so an unsorted schedule
      // dispatches the 1.0 beat before the 0.5 one. Deleting the sort left the
      // whole suite green before this test existed: every other multi-keyframe
      // case authors its beats already ascending, where the sort is a no-op.
      player.load({
        id: 'cs1', name: 'Test', duration: 5, createdAt: 0, updatedAt: 0,
        tracks: [
          {
            id: 't1', type: 'animation', entityId: 'e1', muted: false,
            keyframes: [{ timestamp: 1, duration: 0, easing: 'linear', payload: { clipName: 'later' } }],
          },
          {
            id: 't2', type: 'animation', entityId: 'e2', muted: false,
            keyframes: [{ timestamp: 0.5, duration: 0, easing: 'linear', payload: { clipName: 'earlier' } }],
          },
        ],
      });
      player.play();
      advance(1000);

      expect(clipNames()).toEqual(['earlier', 'later']);
    });

    // ------------------------------------------------------------------------
    // Transitions between seek, pause and play
    //
    // Each flag transition was pinned individually; the COMBINATIONS, where one
    // transition undoes another, were not.
    // ------------------------------------------------------------------------

    it('play after seeking a stopped player starts at the seek point', () => {
      loadMultiKeyframeTrack();
      player.seek(2.5);
      player.play();
      advance(0);

      // `seek` on a stopped player marks everything before 2.5 as done. `play`
      // used to clear every flag unconditionally, so the first tick burst-fired
      // 'first' and 'second' together with nothing at the playhead having asked
      // for them. The beat at 3 is still ahead and must not have fired either.
      expect(dispatch).not.toHaveBeenCalled();

      advance(600);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'third' });
    });

    it('seeking while paused does not charge the seek for the pause', () => {
      loadMultiKeyframeTrack();
      player.play();
      advance(100);
      player.pause();

      // Sit paused for a long time, then scrub and resume.
      advance(9900);
      player.seek(2);
      player.play();
      advance(50);

      // Resume used to add the whole pause duration on top of the rebased start
      // time, landing the playhead at roughly -8: eight seconds of blank playback
      // before the beat at 2 would have fired.
      expect(useCutsceneStore.getState().playbackTime).toBeCloseTo(2.05, 5);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'second' });
    });

    it('pausing a player that never played leaves it playable', () => {
      loadSingleTrack('animation', { clipName: 'walk' });
      player.pause();
      player.play();
      advance(1000);

      // `pause` used to stamp the pause instant with no clock running, so the
      // next `play` took the resume branch and never started one. `tick` bailed
      // on the null start time without rescheduling: `isPlaying` true, state
      // 'playing', nothing ever fired, `onComplete` never called.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(useCutsceneStore.getState().playbackState).toBe('playing');
    });
  });
});
