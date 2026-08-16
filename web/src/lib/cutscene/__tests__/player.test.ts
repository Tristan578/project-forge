import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  applyEasing,
  buildActions,
  buildCameraCommandPayload,
  CutscenePlayer,
  type CommandDispatcher,
} from '../player';
import type { CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';
import { useDialogueStore } from '@/stores/dialogueStore';

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
// buildActions
// ============================================================================

function makeKF(payload: Record<string, unknown> = {}): CutsceneKeyframe {
  return { timestamp: 0, duration: 1, easing: 'linear', payload };
}

describe('buildActions', () => {
  it('camera track translates authoring params into the engine wire form', () => {
    const actions = buildActions(
      'camera',
      'cam1',
      makeKF({ mode: 'orbital', targetEntity: 'hero', orbitalDistance: 12, orbitalAutoRotateSpeed: 20 }),
    );
    // Full shape, not objectContaining: an invented key sitting alongside the
    // asserted ones is exactly what this ticket exists to stop shipping.
    expect(actions).toEqual([
      {
        kind: 'command',
        command: 'set_game_camera',
        payload: {
          entityId: 'cam1',
          mode: 'orbital',
          targetEntity: 'hero',
          radius: 12,
          autoRotateSpeed: 20,
          // Derived from the speed, not authored: emitting it makes the authoring
          // vocabulary the owner of `autoRotate`, so a stale flag from an earlier
          // engine report cannot survive a round trip and mute this rotation.
          autoRotate: true,
        },
      },
    ]);
  });

  it('camera track collapses third-person distance and height into one offset', () => {
    const actions = buildActions(
      'camera',
      'cam1',
      makeKF({ mode: 'thirdPersonFollow', followDistance: 8, followHeight: 3, followSmoothing: 4 }),
    );
    expect(actions).toEqual([
      {
        kind: 'command',
        command: 'set_game_camera',
        payload: {
          entityId: 'cam1',
          mode: 'thirdPersonFollow',
          targetEntity: null,
          offset: [0, 3, -8],
          damping: 4,
        },
      },
    ]);
  });

  it('camera track drops keys the engine cannot receive', () => {
    const actions = buildActions(
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
    );
    expect(actions).toEqual([
      {
        kind: 'command',
        command: 'set_game_camera',
        payload: { entityId: 'cam1', mode: 'topDown', targetEntity: null, height: 20 },
      },
    ]);
  });

  it('camera track ignores non-finite numeric params rather than resetting them', () => {
    const actions = buildActions('camera', 'cam1', makeKF({ mode: 'topDown', topDownHeight: NaN }));
    expect(actions).toEqual([
      {
        kind: 'command',
        command: 'set_game_camera',
        payload: { entityId: 'cam1', mode: 'topDown', targetEntity: null },
      },
    ]);
  });

  it('camera track drops an inherited param rather than sending it', () => {
    // Called directly, NOT through `buildActions`. `buildActions` sanitizes the
    // payload first, and the sanitizer already drops inherited keys — so the
    // same assertion routed through it passes with every `Object.hasOwn` in the
    // payload builder deleted. Verified by mutation: both guards survive when
    // this is written against `buildActions`.
    //
    // What is being pinned is the payload builder's own contract. Its parameter
    // says `Record<string, unknown>`, so it cannot assume a sanitized input, and
    // a `__proto__` entry in model-authored JSON produces exactly this object.
    // An inherited value that got picked would be written as an OWN property on
    // the camera data, past the point where anything downstream could tell.
    const payload = Object.create({ topDownHeight: 999 }) as Record<string, unknown>;
    payload.mode = 'topDown';

    expect(buildCameraCommandPayload('cam1', payload)).toEqual({
      entityId: 'cam1',
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

    expect(buildCameraCommandPayload('cam1', inherited)).toBeNull();

    const ownModeOnly = Object.create({ targetEntity: 'someone-elses-entity' }) as Record<
      string,
      unknown
    >;
    ownModeOnly.mode = 'topDown';

    expect(buildCameraCommandPayload('cam1', ownModeOnly)).toEqual({
      entityId: 'cam1',
      mode: 'topDown',
      targetEntity: null,
    });
  });

  it('camera track asks for nothing when entityId is null', () => {
    expect(buildActions('camera', null, makeKF({ mode: 'orbital' }))).toEqual([]);
  });

  it('camera track asks for nothing for an unrecognized mode', () => {
    // The old PascalCase vocabulary — the engine has never had a mode by this name.
    expect(buildActions('camera', 'cam1', makeKF({ mode: 'Orbital' }))).toEqual([]);
  });

  it('camera track asks for nothing when the payload names no mode', () => {
    expect(buildActions('camera', 'cam1', makeKF())).toEqual([]);
  });

  it('animation track asks for play_animation', () => {
    expect(buildActions('animation', 'entity1', makeKF({ clipName: 'run' }))).toEqual([
      { kind: 'command', command: 'play_animation', payload: { entityId: 'entity1', clipName: 'run' } },
    ]);
  });

  it('animation track asks for nothing when entityId is null', () => {
    expect(buildActions('animation', null, makeKF({ clipName: 'run' }))).toEqual([]);
  });

  it('animation track drops keys the engine cannot receive', () => {
    const actions = buildActions(
      'animation',
      'entity1',
      makeKF({ clipName: 'run', crossfadeSecs: 0.25, loop: true, speed: 2 }),
    );
    expect(actions).toEqual([
      {
        kind: 'command',
        command: 'play_animation',
        payload: { entityId: 'entity1', clipName: 'run', crossfadeSecs: 0.25 },
      },
    ]);
  });

  it.each([
    ['names no clip', {}],
    ['names the empty clip', { clipName: '' }],
    ['gives a non-string clip name', { clipName: 42 }],
  ])('animation track asks for nothing when the payload %s', (_case, payload) => {
    // This used to dispatch `play_animation` for the empty clip, which the
    // engine can only ignore — a no-op indistinguishable in a log from a hit.
    expect(buildActions('animation', 'entity1', makeKF(payload))).toEqual([]);
  });

  it.each([
    ['the model gave a non-numeric one', { clipName: 'run', crossfadeSecs: 'quickly' }],
    ['the model gave a negative one', { clipName: 'run', crossfadeSecs: -1 }],
    ['the payload has none at all', { clipName: 'run' }],
  ])('animation track omits crossfadeSecs when %s', (_case, payload) => {
    const actions = buildActions('animation', 'entity1', makeKF(payload));
    // OMITTED, not defaulted to 0. `handle_play_animation` reads this field as
    // `unwrap_or(0.3)`, so a 0 written here is not "no opinion" — it is an
    // instant cut that overrides the engine's own crossfade. Absence is the
    // only way to ask for the engine default.
    expect(actions).toEqual([
      { kind: 'command', command: 'play_animation', payload: { entityId: 'entity1', clipName: 'run' } },
    ]);
  });

  it('animation track keeps an explicit zero crossfade, which asks for a cut', () => {
    const actions = buildActions(
      'animation',
      'entity1',
      makeKF({ clipName: 'run', crossfadeSecs: 0 }),
    );
    expect(actions).toEqual([
      {
        kind: 'command',
        command: 'play_animation',
        payload: { entityId: 'entity1', clipName: 'run', crossfadeSecs: 0 },
      },
    ]);
  });

  it('dialogue track asks the store to start the tree, not the engine', () => {
    // Not a command. This used to dispatch `start_dialogue`, which no arm in
    // `engine/src/core/commands/` has ever handled — `handle_command` answered
    // with an `Err` that `dispatchCommand` (returning `void`) discarded.
    expect(buildActions('dialogue', 'npc1', makeKF({ treeId: 'tree_1' }))).toEqual([
      { kind: 'dialogue', treeId: 'tree_1' },
    ]);
  });

  it('dialogue track drops the entity, since startDialogue names only a tree', () => {
    // The old payload carried `entityId`. `startDialogue(treeId)` takes nothing
    // else, and the store holds no speaker, so passing one would be a field the
    // receiver never reads — the same shape as the bug being fixed here.
    expect(buildActions('dialogue', null, makeKF({ treeId: 'tree_1' }))).toEqual([
      { kind: 'dialogue', treeId: 'tree_1' },
    ]);
  });

  it.each([
    ['names no tree', {}],
    ['names the empty tree', { treeId: '' }],
    ['gives a non-string tree id', { treeId: { id: 'tree_1' } }],
  ])('dialogue track asks for nothing when the payload %s', (_case, payload) => {
    // `treeId` used to be forwarded unread, so a missing one started a dialogue
    // named `undefined` rather than declining to start one.
    expect(buildActions('dialogue', 'npc1', makeKF(payload))).toEqual([]);
  });

  it('audio track does not try to set a volume the audio graph would never hear', () => {
    // `volume` and `pitch` are authored onto the keyframe and deliberately not
    // dispatched. Prepending a `set_audio` is the obvious fix and the wrong one:
    // it would be inaudible (nothing in the app ever creates an entity audio
    // instance, so `audioManager.play` warns and returns) while permanently
    // merging the value into the entity's saved `AudioData` and pushing an
    // `UndoableAction::AudioChange` onto the editor history mid-playback. PF-1155
    // wires the graph; until then the track plays the sound and claims nothing
    // about its level.
    expect(buildActions('audio', 'sfx1', makeKF({ volume: 0.8 }))).toEqual([
      { kind: 'command', command: 'play_audio', payload: { entityId: 'sfx1' } },
    ]);
  });

  it('audio track asks only for play_audio when the keyframe sets nothing', () => {
    expect(buildActions('audio', 'sfx1', makeKF())).toEqual([
      { kind: 'command', command: 'play_audio', payload: { entityId: 'sfx1' } },
    ]);
  });

  it('audio track drops keys the engine cannot receive', () => {
    // The whole payload used to be spread into `play_audio`, so every key below
    // reached the engine — including one that renames the entity the track
    // addresses, which is the track's own field and not the payload's to set.
    const actions = buildActions(
      'audio',
      'sfx1',
      makeKF({
        volume: 0.8,
        pitch: 1.2,
        clipUrl: 'https://example.invalid/a.mp3',
        loop: true,
        entityId: 'someone-elses-entity',
      }),
    );
    expect(actions).toEqual([
      { kind: 'command', command: 'play_audio', payload: { entityId: 'sfx1' } },
    ]);
  });

  it('audio track asks for nothing when entityId is null', () => {
    expect(buildActions('audio', null, makeKF())).toEqual([]);
  });

  it('wait track asks for nothing', () => {
    expect(buildActions('wait', null, makeKF())).toEqual([]);
  });
});

// ============================================================================
// CutscenePlayer
// ============================================================================

describe('CutscenePlayer', () => {
  // Typed as the mock rather than as `CommandDispatcher`: several tests below
  // need `.mock.calls` and `.mockImplementationOnce`, and casting the mock down
  // to the bare function type throws all of that away.
  let dispatch: Mock<CommandDispatcher>;
  let onComplete: (() => void) | undefined;
  let onStop: (() => void) | undefined;
  let player: CutscenePlayer;

  beforeEach(() => {
    // Hoisted, so it is shared across the whole file and outlives each test.
    captureException.mockClear();
    dispatch = vi.fn<CommandDispatcher>();
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

    // Drive a real frame. This used to `play()` then `pause()` immediately, which
    // cancelled the rAF before jsdom ever ran it — so `tick()` never executed and
    // the assertion below held for a muted track, an unmuted one, and a player
    // with nothing loaded alike. Deleting the mute guard entirely left the suite
    // green. The clock is what gives the assertion something to disprove.
    const clock = fakeClock();
    try {
      player.play();
      clock.advanceTo(1);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      clock.restore();
    }
  });

  it('an unmuted copy of the same track does dispatch', () => {
    // The control for the test above: same fixture, `muted: false`. Without it,
    // "did not dispatch" cannot distinguish muting from a fixture that was never
    // going to dispatch in the first place.
    const track: CutsceneTrack = {
      id: 't1', type: 'camera', entityId: 'cam1', muted: false,
      keyframes: [{ timestamp: 0, duration: 1, easing: 'linear', payload: { mode: 'orbital' } }],
    };
    player.load({
      id: 'cs1', name: 'Test', duration: 5, tracks: [track], createdAt: 0, updatedAt: 0,
    });

    const clock = fakeClock();
    try {
      player.play();
      clock.advanceTo(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      clock.restore();
    }
  });

  // --------------------------------------------------------------------------
  // Re-fire behaviour
  //
  // A keyframe's `duration` used to mean "keep dispatching for this long" on
  // every track, and it is wrong on all four. Three carry triggers: a two-second
  // audio keyframe restarted the sound on every frame, so it never played past
  // its first instant. The fourth looks like a state and is worse — see the
  // camera case below. `duration` bounds the beat, not the dispatching. These
  // drive the rAF loop by hand rather than waiting on a real clock, since the
  // whole question is how many frames each keyframe sees.
  // --------------------------------------------------------------------------

  interface FakeClock {
    advanceTo(seconds: number): void;
    restore(): void;
  }

  function fakeClock(): FakeClock {
    let nowMs = 0;
    let pending: FrameRequestCallback | null = null;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        pending = cb;
        return 1;
      });
    // Cancellation has to be honoured too, or a paused player keeps ticking:
    // `pause()` calls the real `cancelAnimationFrame`, which knows nothing about
    // the callback parked in `pending`, so the next `advanceTo` would run a frame
    // the player had already called off.
    const cancelSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {
        pending = null;
      });
    return {
      advanceTo(seconds) {
        nowMs = seconds * 1000;
        const cb = pending;
        pending = null;
        cb?.(nowMs);
      },
      restore() {
        nowSpy.mockRestore();
        rafSpy.mockRestore();
        cancelSpy.mockRestore();
      },
    };
  }

  function loadSingleTrack(type: CutsceneTrack['type'], payload: Record<string, unknown>): void {
    const track: CutsceneTrack = {
      id: 't1',
      type,
      entityId: 'e1',
      muted: false,
      // Duration spans several frames, so a per-frame re-fire is visible as a
      // call count rather than needing a timing assertion.
      keyframes: [{ timestamp: 0, duration: 4, easing: 'linear', payload }],
    };
    player.load({
      id: 'cs1',
      name: 'Test',
      duration: 10,
      tracks: [track],
      createdAt: 0,
      updatedAt: 0,
    });
  }

  /**
   * One track, three beats at distinct timestamps.
   *
   * `loadSingleTrack` puts its only keyframe at `timestamp: 0`, which is where
   * the playhead already sits — so it can show that a keyframe fires once, but
   * never that it fires at its OWN time rather than at the start. Zero durations
   * keep this about scheduling and nothing else.
   */
  function loadMultiKeyframeTrack(): void {
    const track: CutsceneTrack = {
      id: 't1',
      type: 'animation',
      entityId: 'e1',
      muted: false,
      keyframes: [
        { timestamp: 0, duration: 0, easing: 'linear', payload: { clipName: 'first' } },
        { timestamp: 2, duration: 0, easing: 'linear', payload: { clipName: 'second' } },
        { timestamp: 3, duration: 0, easing: 'linear', payload: { clipName: 'third' } },
      ],
    };
    player.load({
      id: 'cs1',
      name: 'Test',
      duration: 10,
      tracks: [track],
      createdAt: 0,
      updatedAt: 0,
    });
  }

  it('an audio keyframe starts its sound once, however long it lasts', () => {
    const clock = fakeClock();
    try {
      loadSingleTrack('audio', { volume: 0.8 });
      player.play();
      clock.advanceTo(1);
      clock.advanceTo(2);
      clock.advanceTo(3);

      // One command for one beat, and one beat only. Re-firing would restart
      // the sound from the top on every frame.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_audio', { entityId: 'e1' });
    } finally {
      clock.restore();
    }
  });

  it('an animation keyframe starts its clip once, however long it lasts', () => {
    const clock = fakeClock();
    try {
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      clock.advanceTo(1);
      clock.advanceTo(2);
      clock.advanceTo(3);

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'run' });
    } finally {
      clock.restore();
    }
  });

  it('a camera keyframe is applied once, however long it lasts', () => {
    const clock = fakeClock();
    try {
      loadSingleTrack('camera', { mode: 'topDown', topDownHeight: 20 });
      player.play();
      clock.advanceTo(1);
      clock.advanceTo(2);
      clock.advanceTo(3);

      // `set_game_camera` reads like an absolute set that would be safe to
      // re-issue, and an earlier revision of the player kept the camera track
      // continuous on exactly that reasoning. It is not: `bridge/game.rs:159-163`
      // rebuilds the component with `..Default::default()` and `:168-176`
      // re-inserts `OrbitalState::default()` / `FirstPersonState::default()`, so a
      // per-frame re-issue zeroes the orbital angle, the first-person yaw/pitch
      // and any in-flight camera shake every tick.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('set_game_camera', {
        entityId: 'e1',
        mode: 'topDown',
        targetEntity: null,
        height: 20,
      });
    } finally {
      clock.restore();
    }
  });

  it('a dialogue keyframe starts the tree through the store, once', () => {
    const clock = fakeClock();
    const startDialogue = vi.fn();
    const original = useDialogueStore.getState().startDialogue;
    useDialogueStore.setState({ startDialogue });
    try {
      loadSingleTrack('dialogue', { treeId: 'tree_1' });
      player.play();
      clock.advanceTo(1);
      clock.advanceTo(2);

      // Nothing reaches the engine: `start_dialogue` is not a command any arm in
      // `engine/src/core/commands/` handles, so dispatching it was a silent
      // no-op for the whole life of the cutscene player.
      expect(dispatch).not.toHaveBeenCalled();
      expect(startDialogue).toHaveBeenCalledTimes(1);
      expect(startDialogue).toHaveBeenCalledWith('tree_1');
    } finally {
      useDialogueStore.setState({ startDialogue: original });
      clock.restore();
    }
  });

  // --------------------------------------------------------------------------
  // `fired` lifecycle
  //
  // Now that every track is one-shot, `fired` is the ONLY thing standing between
  // a keyframe and a re-dispatch — there is no second gate behind it. So the
  // three transitions that touch the flag (`play` from a stop, `seek`, and the
  // per-tick latch) are pinned individually.
  // --------------------------------------------------------------------------

  it('replays every keyframe after stop() and play() again', () => {
    const clock = fakeClock();
    try {
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      clock.advanceTo(1);
      expect(dispatch).toHaveBeenCalledTimes(1);

      player.stop();
      player.play();
      clock.advanceTo(2);

      // `play()` clears every `fired` flag when it is not resuming from a pause,
      // so a second run is a second dispatch rather than a silent no-op.
      expect(dispatch).toHaveBeenCalledTimes(2);
    } finally {
      clock.restore();
    }
  });

  it('does not replay a keyframe when resuming from pause', () => {
    const clock = fakeClock();
    try {
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      clock.advanceTo(1);
      player.pause();
      player.play();
      clock.advanceTo(2);

      // Resuming keeps the flags: a paused cutscene picks up where it left off
      // rather than restarting every beat already played.
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      clock.restore();
    }
  });

  it('seeking exactly onto a keyframe leaves it due to fire', () => {
    const clock = fakeClock();
    try {
      loadMultiKeyframeTrack();
      player.play();
      clock.advanceTo(0.5);
      expect(dispatch).toHaveBeenCalledTimes(1);
      dispatch.mockClear();

      // The keyframe AT the seek point has not happened yet: `fireKeyframesSafely`
      // fires on `timestamp <= time`, so 2 is due at t=2, not done. Marking it
      // fired here would make scrubbing precisely onto a beat the one way to
      // skip it.
      // `advanceTo` moves the WALL clock; `seek` rebases the playhead against it,
      // so this next frame lands at playhead 2.1, not 2 — far enough to reach the
      // keyframe at 2 and not the one at 3.
      player.seek(2);
      clock.advanceTo(0.6);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'e1',
        clipName: 'second',
      });
    } finally {
      clock.restore();
    }
  });

  it('seeking past a keyframe skips it', () => {
    const clock = fakeClock();
    try {
      loadMultiKeyframeTrack();
      player.play();
      player.seek(3);
      clock.advanceTo(0.1);

      // Everything strictly before the seek point counts as already played, so
      // scrubbing forward does not fire a burst of the beats it flew past.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'e1',
        clipName: 'third',
      });
    } finally {
      clock.restore();
    }
  });

  it('fires each keyframe as the playhead reaches its own timestamp', () => {
    const clock = fakeClock();
    try {
      loadMultiKeyframeTrack();
      player.play();

      clock.advanceTo(0.5);
      expect(dispatch.mock.calls.map((c) => c[1])).toEqual([
        { entityId: 'e1', clipName: 'first' },
      ]);

      clock.advanceTo(2.5);
      clock.advanceTo(3.5);
      expect(dispatch.mock.calls.map((c) => c[1])).toEqual([
        { entityId: 'e1', clipName: 'first' },
        { entityId: 'e1', clipName: 'second' },
        { entityId: 'e1', clipName: 'third' },
      ]);
    } finally {
      clock.restore();
    }
  });

  it('keeps playing when a keyframe sink throws', () => {
    const clock = fakeClock();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      dispatch.mockImplementationOnce(() => {
        throw new Error('engine bridge is not loaded');
      });
      loadMultiKeyframeTrack();
      player.play();

      clock.advanceTo(0.5);
      clock.advanceTo(2.5);

      // `scheduleFrame()` runs AFTER the fire call, so an escaping throw used to
      // take the rAF loop with it: playback froze mid-cutscene with `isPlaying`
      // still true, `onComplete` never ran, and the editor stayed in Play mode.
      // The bad beat is reported and dropped; the rest of the timeline plays.
      expect(player.isPlaying).toBe(true);
      expect(consoleError).toHaveBeenCalled();
      expect(dispatch).toHaveBeenLastCalledWith('play_animation', {
        entityId: 'e1',
        clipName: 'second',
      });
    } finally {
      consoleError.mockRestore();
      clock.restore();
    }
  });

  it('does not retry a keyframe whose sink threw', () => {
    const clock = fakeClock();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      dispatch.mockImplementation(() => {
        throw new Error('engine bridge is not loaded');
      });
      loadSingleTrack('animation', { clipName: 'run' });
      player.play();
      clock.advanceTo(1);
      clock.advanceTo(2);
      clock.advanceTo(3);

      // `fired` is set BEFORE the sink runs. A keyframe that throws every frame
      // would otherwise re-throw every frame, turning one bad beat into a
      // per-frame console flood for the whole duration of the cutscene.
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
      clock.restore();
    }
  });

  it('fires the beats after a throwing one on the final tick', () => {
    const clock = fakeClock();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      dispatch.mockImplementationOnce(() => {
        throw new Error('engine bridge is not loaded');
      });
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 3,
        tracks: [{
          id: 't1',
          type: 'animation',
          entityId: 'e1',
          muted: false,
          keyframes: [
            { timestamp: 2.5, duration: 0, easing: 'linear', payload: { clipName: 'throws' } },
            { timestamp: 3, duration: 0, easing: 'linear', payload: { clipName: 'last' } },
          ],
        }],
        createdAt: 0,
        updatedAt: 0,
      });
      player.play();

      // Straight to the end: both keyframes come due on the terminal tick.
      clock.advanceTo(3);

      // A per-TICK boundary reads as equivalent to a per-keyframe one, because
      // mid-playback the skipped keyframes are still unfired and the next tick
      // picks them up. Here there is no next tick — `tick()` ends the rAF loop
      // at `duration` — so anything the throw skipped is lost for good.
      expect(consoleError).toHaveBeenCalled();
      expect(dispatch).toHaveBeenLastCalledWith('play_animation', {
        entityId: 'e1',
        clipName: 'last',
      });
      expect(onComplete).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      clock.restore();
    }
  });

  it('reports a failed keyframe to Sentry, not only to the console', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = fakeClock();
    try {
      dispatch.mockImplementationOnce(() => {
        throw new Error('engine bridge is not loaded');
      });
      loadSingleTrack('animation', { clipName: 'walk' });
      player.play();
      clock.advanceTo(1);

      // The boundary's job is to swallow the error, and a swallowed beat looks
      // like "the thing didn't happen" — nobody has a console open for that.
      expect(captureException).toHaveBeenCalledTimes(1);
      const [err, context] = captureException.mock.calls[0] as [Error, Record<string, unknown>];
      expect(err.message).toBe('engine bridge is not loaded');
      expect(context).toMatchObject({ trackId: 't1', trackType: 'animation', timestamp: 0 });
    } finally {
      consoleError.mockRestore();
      clock.restore();
    }
  });

  // --------------------------------------------------------------------------
  // End of the timeline
  //
  // `tick()`'s completion branch is the only path that fires a keyframe sitting
  // exactly at `duration` — the normal path returns before the playhead reaches
  // it — and `duration` is where a generated cutscene puts its closing beat. The
  // whole branch was previously unexercised: every fixture ran to `duration: 10`
  // and no test advanced the clock past 3.5, so gutting the branch outright left
  // the suite green.
  // --------------------------------------------------------------------------

  it('fires a keyframe sitting exactly at duration and completes once', () => {
    const clock = fakeClock();
    try {
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 2,
        tracks: [{
          id: 't1',
          type: 'animation',
          entityId: 'e1',
          muted: false,
          keyframes: [{ timestamp: 2, duration: 0, easing: 'linear', payload: { clipName: 'closing' } }],
        }],
        createdAt: 0,
        updatedAt: 0,
      });
      player.play();

      clock.advanceTo(1);
      expect(dispatch).not.toHaveBeenCalled();

      clock.advanceTo(2);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'closing' });
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(player.isPlaying).toBe(false);
      expect(useCutsceneStore.getState().playbackState).toBe('idle');
      expect(useCutsceneStore.getState().playbackTime).toBe(2);
    } finally {
      clock.restore();
    }
  });

  it('a zero-duration cutscene completes on its first tick', () => {
    // The degenerate case of the same branch: the first frame is already terminal.
    const clock = fakeClock();
    try {
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 0,
        tracks: [{
          id: 't1',
          type: 'animation',
          entityId: 'e1',
          muted: false,
          keyframes: [{ timestamp: 0, duration: 0, easing: 'linear', payload: { clipName: 'only' } }],
        }],
        createdAt: 0,
        updatedAt: 0,
      });
      player.play();
      clock.advanceTo(0);

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(player.isPlaying).toBe(false);
      expect(useCutsceneStore.getState().playbackState).toBe('idle');
    } finally {
      clock.restore();
    }
  });

  it('fires both keyframes sharing a timestamp, in track order', () => {
    const clock = fakeClock();
    try {
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 5,
        tracks: [{
          id: 't1',
          type: 'animation',
          entityId: 'e1',
          muted: false,
          keyframes: [
            { timestamp: 1, duration: 0, easing: 'linear', payload: { clipName: 'a' } },
            { timestamp: 1, duration: 0, easing: 'linear', payload: { clipName: 'b' } },
          ],
        }],
        createdAt: 0,
        updatedAt: 0,
      });
      player.play();
      clock.advanceTo(1);

      // Both are due and both unfired, so one tick fires both. Array.prototype.sort
      // is stable, so the schedule keeps the authored order.
      expect(dispatch.mock.calls.map(c => (c[1] as { clipName: string }).clipName)).toEqual(['a', 'b']);
    } finally {
      clock.restore();
    }
  });

  it('fires keyframes in timestamp order across tracks, not authored order', () => {
    const clock = fakeClock();
    try {
      // Authored so that track order and timestamp order DISAGREE: the earlier
      // beat lives on the second track. `buildSchedule` flattens the tracks in
      // order and then sorts, so only the sort can put these the right way round.
      //
      // A single tick that catches up on several beats replays them in schedule
      // order, and these two are the same track type — so an unsorted schedule
      // dispatches the 1.0 beat before the 0.5 one. Deleting the sort left the
      // whole suite green before this test existed: every other multi-keyframe
      // case authors its beats already ascending, where the sort is a no-op.
      player.load({
        id: 'cs1',
        name: 'Test',
        duration: 5,
        tracks: [
          {
            id: 't1',
            type: 'animation',
            entityId: 'e1',
            muted: false,
            keyframes: [{ timestamp: 1, duration: 0, easing: 'linear', payload: { clipName: 'later' } }],
          },
          {
            id: 't2',
            type: 'animation',
            entityId: 'e2',
            muted: false,
            keyframes: [{ timestamp: 0.5, duration: 0, easing: 'linear', payload: { clipName: 'earlier' } }],
          },
        ],
        createdAt: 0,
        updatedAt: 0,
      });
      player.play();
      clock.advanceTo(1);

      expect(dispatch.mock.calls.map(c => (c[1] as { clipName: string }).clipName)).toEqual([
        'earlier',
        'later',
      ]);
    } finally {
      clock.restore();
    }
  });

  // --------------------------------------------------------------------------
  // Transitions between seek, pause and play
  //
  // Each flag transition was pinned individually; the COMBINATIONS, where one
  // transition undoes another, were not — and all three below were broken.
  // --------------------------------------------------------------------------

  it('play after seeking a stopped player starts at the seek point', () => {
    const clock = fakeClock();
    try {
      loadMultiKeyframeTrack();
      player.seek(2.5);
      player.play();
      clock.advanceTo(0);

      // `seek` on a stopped player marks everything before 2.5 as done. `play`
      // used to clear every flag unconditionally, so the first tick burst-fired
      // 'first' and 'second' together with nothing at the playhead having asked
      // for them. The beat at 3 is still ahead and must not have fired either.
      expect(dispatch).not.toHaveBeenCalled();

      clock.advanceTo(0.6);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'third' });
    } finally {
      clock.restore();
    }
  });

  it('seeking while paused does not charge the seek for the pause', () => {
    const clock = fakeClock();
    try {
      loadMultiKeyframeTrack();
      player.play();
      clock.advanceTo(0.1);
      player.pause();

      // Sit paused for a long time, then scrub and resume.
      clock.advanceTo(10);
      player.seek(2);
      player.play();
      clock.advanceTo(10.05);

      // Resume used to add the whole pause duration on top of the rebased start
      // time, landing the playhead at roughly -8: eight seconds of blank playback
      // before the beat at 2 would have fired.
      expect(useCutsceneStore.getState().playbackTime).toBeCloseTo(2.05, 5);
      expect(dispatch).toHaveBeenCalledWith('play_animation', { entityId: 'e1', clipName: 'second' });
    } finally {
      clock.restore();
    }
  });

  it('pausing a player that never played leaves it playable', () => {
    const clock = fakeClock();
    try {
      loadSingleTrack('animation', { clipName: 'walk' });
      player.pause();
      player.play();
      clock.advanceTo(1);

      // `pause` used to stamp the pause instant with no clock running, so the
      // next `play` took the resume branch and never started one. `tick` bailed
      // on the null start time without rescheduling: `isPlaying` true, state
      // 'playing', nothing ever fired, `onComplete` never called.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(useCutsceneStore.getState().playbackState).toBe('playing');
    } finally {
      clock.restore();
    }
  });
});
