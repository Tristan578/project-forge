/**
 * @vitest-environment jsdom
 *
 * Behaviour of the JS-SIDE script commands.
 *
 * `scriptAllowlistParity.test.ts` proves each of these names is HANDLED — it
 * matches `case 'x':` followed by a `return true`. That is a structural claim
 * and it cannot see what the handler does, so on its own the module's 300 lines
 * of mapping logic had no behavioural coverage at all: the camera offset
 * conversion, the stems object-to-array shape change, the parameter coercion
 * and the prototype guard were each asserted by a regex looking at their
 * shape. The parity file's docstring already pointed here for the real
 * coverage; this is that file.
 *
 * What matters most is the CONVERSIONS. Each of these commands exists because a
 * script-facing shape and a store or audioManager shape disagree, so the
 * conversion is the whole substance — and a wrong one fails silently, which is
 * the class #9284 is about.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.hoisted`, because `vi.mock` is lifted above every const in the file and a
// plain declaration is not initialised by the time the factory runs.
const audioManagerMock = vi.hoisted(() => ({
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  removeAllLayers: vi.fn(),
  crossfade: vi.fn(),
  playOneShot: vi.fn(),
  fadeIn: vi.fn(),
  fadeOut: vi.fn(),
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  detectLoopPoints: vi.fn(),
  setMusicIntensity: vi.fn(),
  setAdaptiveMusic: vi.fn(),
}));

vi.mock('@/lib/audio/audioManager', () => ({ audioManager: audioManagerMock }));

// The module keeps its own `DEFAULT_MUSIC_TRACK_ID = 'default'` rather than
// importing one, so this mirrors that value instead of mocking an export that
// does not exist.
const DEFAULT_TRACK = 'default';

import { handleLocalScriptCommand, type LocalCommandStore } from '../localScriptCommands';

function makeStore(overrides: Partial<LocalCommandStore> = {}): LocalCommandStore {
  return {
    primaryId: 'cam-primary',
    activeGameCameraId: null,
    allGameCameras: {},
    spriteAnimators: {},
    animationStateMachines: {},
    setGameCamera: vi.fn(),
    setSpriteAnimator: vi.fn(),
    setAnimationStateMachine: vi.fn(),
    ...overrides,
  };
}

/** Run one command against a store, returning the store for assertions. */
function run(cmd: string, payload: Record<string, unknown>, store = makeStore()) {
  const handled = handleLocalScriptCommand(cmd, payload, () => store);
  return { handled, store };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleLocalScriptCommand — ownership', () => {
  it('declines a command it does not own, so the engine still sees it', () => {
    const { handled } = run('spawn_entity', { entityType: 'cube' });
    expect(handled).toBe(false);
  });

  it('claims a command it owns, so the engine never sees it', () => {
    const { handled } = run('set_music_intensity', { intensity: 0.5 });
    expect(handled).toBe(true);
  });
});

describe('set_music_stems — object in, array out', () => {
  // `forge.audio.loadStems({ drums: 'a1' })` is the ergonomic script shape;
  // `setAdaptiveMusic` takes the array form. A wrong conversion here loses the
  // stems silently and the music simply never layers.
  it('converts the script object into the array audioManager expects', () => {
    run('set_music_stems', { stems: { drums: 'asset-1', bass: 'asset-2' } });
    expect(audioManagerMock.setAdaptiveMusic).toHaveBeenCalledWith(DEFAULT_TRACK, [
      { name: 'drums', assetId: 'asset-1' },
      { name: 'bass', assetId: 'asset-2' },
    ]);
  });

  it('drops entries whose asset id is not a string rather than passing them on', () => {
    run('set_music_stems', { stems: { good: 'asset-1', bad: 42, alsoBad: null } });
    expect(audioManagerMock.setAdaptiveMusic).toHaveBeenCalledWith(DEFAULT_TRACK, [
      { name: 'good', assetId: 'asset-1' },
    ]);
  });

  it('treats a non-object stems argument as empty, not as a crash', () => {
    run('set_music_stems', { stems: 'not-an-object' });
    expect(audioManagerMock.setAdaptiveMusic).toHaveBeenCalledWith(DEFAULT_TRACK, []);
  });

  it('uses the caller track when given one', () => {
    run('set_music_stems', { trackId: 'battle', stems: { drums: 'a1' } });
    expect(audioManagerMock.setAdaptiveMusic).toHaveBeenCalledWith('battle', [
      { name: 'drums', assetId: 'a1' },
    ]);
  });
});

describe('camera_follow — offset vector to the three follow fields', () => {
  // `x -> followOffsetX, y -> followHeight, z -> -followDistance`. The NEGATION
  // is the part worth pinning: a script passes a camera-space offset where the
  // camera sits behind the target at negative z, and the store keeps distance as
  // a positive magnitude. Getting the sign wrong puts the camera in front.
  it('maps the offset onto the follow fields, negating z into a distance', () => {
    const { store } = run('camera_follow', { entityId: 'player', offset: [1, 5, -10] });
    expect(store.setGameCamera).toHaveBeenCalledWith(
      'cam-primary',
      expect.objectContaining({
        mode: 'thirdPersonFollow',
        targetEntity: 'player',
        followOffsetX: 1,
        followHeight: 5,
        followDistance: 10,
      }),
    );
  });

  it('sets the target without touching the follow fields when no offset is given', () => {
    const { store } = run('camera_follow', { entityId: 'player' });
    const written = (store.setGameCamera as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(written.targetEntity).toBe('player');
    expect(written).not.toHaveProperty('followDistance');
  });

  it('ignores a malformed offset rather than writing NaN into the store', () => {
    const { store } = run('camera_follow', { entityId: 'player', offset: [1, 'two', 3] });
    const written = (store.setGameCamera as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(written).not.toHaveProperty('followDistance');
  });

  it('prefers the active game camera over the primary entity', () => {
    const store = makeStore({ activeGameCameraId: 'cam-active' });
    run('camera_follow', { entityId: 'player' }, store);
    expect(store.setGameCamera).toHaveBeenCalledWith('cam-active', expect.anything());
  });

  it('does nothing when there is no camera to address', () => {
    const store = makeStore({ primaryId: null, activeGameCameraId: null });
    const { handled } = run('camera_follow', { entityId: 'player' }, store);
    // Still CLAIMED: the command is ours and must not fall through to the
    // engine, which has no arm for it.
    expect(handled).toBe(true);
    expect(store.setGameCamera).not.toHaveBeenCalled();
  });

  // `allGameCameras` is keyed by ids that reach this module from a user script.
  // A bare `allGameCameras['constructor']` resolves to an inherited function,
  // which would then be spread into the store as a camera.
  it('does not read an inherited key as an existing camera', () => {
    const store = makeStore({ activeGameCameraId: 'constructor', allGameCameras: {} });
    run('camera_follow', { entityId: 'player' }, store);
    const written = (store.setGameCamera as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(typeof written).toBe('object');
    expect(written.mode).toBe('thirdPersonFollow');
    expect(written).not.toHaveProperty('prototype');
  });
});

describe('camera_stop_follow', () => {
  it('clears the target but keeps the mode, so a later follow resumes', () => {
    const store = makeStore({
      allGameCameras: {
        'cam-primary': { mode: 'thirdPersonFollow', targetEntity: 'player' } as never,
      },
    });
    run('camera_stop_follow', {}, store);
    expect(store.setGameCamera).toHaveBeenCalledWith(
      'cam-primary',
      expect.objectContaining({ mode: 'thirdPersonFollow', targetEntity: null }),
    );
  });

  it('does nothing when the camera is not in the store', () => {
    const store = makeStore({ allGameCameras: {} });
    const { handled } = run('camera_stop_follow', {}, store);
    expect(handled).toBe(true);
    expect(store.setGameCamera).not.toHaveBeenCalled();
  });
});

describe('vibrate', () => {
  it('passes an array pattern to the device', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    run('vibrate', { pattern: [100, 50, 100] });
    expect(vibrate).toHaveBeenCalledWith([100, 50, 100]);
    vi.unstubAllGlobals();
  });

  it('cancels rather than throwing on a malformed pattern', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    run('vibrate', { pattern: 'buzz' });
    // `0` is the spec's own "cancel any running vibration" — the safe reading
    // of a call that cannot mean anything else.
    expect(vibrate).toHaveBeenCalledWith(0);
    vi.unstubAllGlobals();
  });

  it('is still claimed on a device with no vibrator', () => {
    vi.stubGlobal('navigator', {});
    const { handled } = run('vibrate', { pattern: [100] });
    expect(handled).toBe(true);
    vi.unstubAllGlobals();
  });
});

/**
 * SPRITE ANIMATION — the store is read before it is written.
 *
 * Each of these four reads the entity's existing component and spreads it, so
 * the failure mode is not a throw but a component rebuilt without the fields it
 * had. And each declines silently for an entity that has no such component,
 * which is right (a script may address an entity before it is set up) and is
 * also what makes a wrong lookup invisible — hence `ownEntry`.
 */
describe('play_sprite_animation', () => {
  const animator = { spriteSheetId: 'sheet-1', currentClip: 'idle', frameIndex: 7, playing: false, speed: 2 };

  it('starts the named clip from frame zero, keeping the rest of the component', () => {
    const store = makeStore({ spriteAnimators: { hero: { ...animator } } });
    run('play_sprite_animation', { entityId: 'hero', clipName: 'run' }, store);
    expect(store.setSpriteAnimator).toHaveBeenCalledWith('hero', {
      spriteSheetId: 'sheet-1',
      currentClip: 'run',
      frameIndex: 0,
      playing: true,
      // Speed is the entity's, NOT reset: a clip change is not a speed change.
      speed: 2,
    });
  });

  it('does nothing for an entity with no animator, but still claims the command', () => {
    const store = makeStore({ spriteAnimators: {} });
    const { handled } = run('play_sprite_animation', { entityId: 'hero', clipName: 'run' }, store);
    expect(handled).toBe(true);
    expect(store.setSpriteAnimator).not.toHaveBeenCalled();
  });

  it('ignores a non-string clip name rather than writing it', () => {
    const store = makeStore({ spriteAnimators: { hero: { ...animator } } });
    run('play_sprite_animation', { entityId: 'hero', clipName: 42 }, store);
    expect(store.setSpriteAnimator).not.toHaveBeenCalled();
  });

  // `spriteAnimators['constructor']` on a bare index read returns an inherited
  // function, which would then be spread into the store as an animator.
  it('does not read an inherited key as an existing animator', () => {
    const store = makeStore({ spriteAnimators: {} });
    run('play_sprite_animation', { entityId: 'constructor', clipName: 'run' }, store);
    expect(store.setSpriteAnimator).not.toHaveBeenCalled();
  });
});

describe('stop_sprite_animation', () => {
  it('stops without rewinding, so a resume continues where it stopped', () => {
    const store = makeStore({
      spriteAnimators: { hero: { spriteSheetId: 's', currentClip: 'run', frameIndex: 5, playing: true, speed: 1 } },
    });
    run('stop_sprite_animation', { entityId: 'hero' }, store);
    expect(store.setSpriteAnimator).toHaveBeenCalledWith('hero', {
      spriteSheetId: 's',
      currentClip: 'run',
      frameIndex: 5,
      playing: false,
      speed: 1,
    });
  });
});

describe('set_sprite_anim_speed', () => {
  const store = () => makeStore({
    spriteAnimators: { hero: { spriteSheetId: 's', currentClip: 'run', frameIndex: 3, playing: true, speed: 1 } },
  });

  it('writes a finite speed', () => {
    const s = store();
    run('set_sprite_anim_speed', { entityId: 'hero', speed: 2.5 }, s);
    expect(s.setSpriteAnimator).toHaveBeenCalledWith('hero', expect.objectContaining({ speed: 2.5 }));
  });

  it('accepts zero, which is a legitimate speed and not a missing one', () => {
    const s = store();
    run('set_sprite_anim_speed', { entityId: 'hero', speed: 0 }, s);
    expect(s.setSpriteAnimator).toHaveBeenCalledWith('hero', expect.objectContaining({ speed: 0 }));
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['a numeric string', '2.5'],
    ['undefined', undefined],
  ])('refuses %s rather than writing it into the component', (_label, speed) => {
    const s = store();
    run('set_sprite_anim_speed', { entityId: 'hero', speed }, s);
    expect(s.setSpriteAnimator).not.toHaveBeenCalled();
  });
});

/**
 * `set_sprite_anim_param` — the coercion is the substance.
 *
 * A state machine parameter carries its own type and the script supplies a bare
 * value, so the handler coerces to whatever the parameter already declares. A
 * wrong coercion writes a `value` of the wrong JavaScript type into a
 * discriminated union, and every later transition comparing it is silently
 * false — the animation simply never fires.
 */
describe('set_sprite_anim_param', () => {
  function machineStore(parameters: Record<string, { type: string; value: unknown }>) {
    return makeStore({
      animationStateMachines: {
        hero: { states: {}, transitions: [], currentState: 'idle', parameters } as never,
      },
    });
  }

  it('coerces to a number for a float parameter', () => {
    const s = machineStore({ speed: { type: 'float', value: 0 } });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: 'speed', value: '2.5' }, s);
    expect(s.setAnimationStateMachine).toHaveBeenCalledWith(
      'hero',
      expect.objectContaining({ parameters: { speed: { type: 'float', value: 2.5 } } }),
    );
  });

  it('refuses a float that does not parse, leaving the previous value in place', () => {
    const s = machineStore({ speed: { type: 'float', value: 1 } });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: 'speed', value: 'fast' }, s);
    expect(s.setAnimationStateMachine).not.toHaveBeenCalled();
  });

  it('coerces to a boolean for a bool parameter, keeping the declared type', () => {
    const s = machineStore({ grounded: { type: 'bool', value: false } });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: 'grounded', value: 1 }, s);
    expect(s.setAnimationStateMachine).toHaveBeenCalledWith(
      'hero',
      expect.objectContaining({ parameters: { grounded: { type: 'bool', value: true } } }),
    );
  });

  it('keeps the trigger type rather than collapsing it to bool', () => {
    const s = machineStore({ jump: { type: 'trigger', value: false } });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: 'jump', value: 'yes' }, s);
    expect(s.setAnimationStateMachine).toHaveBeenCalledWith(
      'hero',
      expect.objectContaining({ parameters: { jump: { type: 'trigger', value: true } } }),
    );
  });

  it('leaves the other parameters untouched', () => {
    const s = machineStore({
      speed: { type: 'float', value: 0 },
      grounded: { type: 'bool', value: true },
    });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: 'speed', value: 3 }, s);
    const written = (s.setAnimationStateMachine as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(written.parameters).toEqual({
      speed: { type: 'float', value: 3 },
      grounded: { type: 'bool', value: true },
    });
  });

  it('does not create a parameter the machine never declared', () => {
    const s = machineStore({ speed: { type: 'float', value: 0 } });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: 'invented', value: 1 }, s);
    expect(s.setAnimationStateMachine).not.toHaveBeenCalled();
  });

  // The parameter name comes off a user script and indexes a record.
  it('does not resolve an inherited key as an existing parameter', () => {
    const s = machineStore({ speed: { type: 'float', value: 0 } });
    run('set_sprite_anim_param', { entityId: 'hero', paramName: '__proto__', value: 1 }, s);
    expect(s.setAnimationStateMachine).not.toHaveBeenCalled();
  });
});

/**
 * The audio commands are pass-throughs, so what is worth pinning is the
 * ARGUMENT MAPPING — most of them build an options object out of loose payload
 * keys, and a misspelled key there drops a setting with no error anywhere.
 */
describe('audio commands reach audioManager', () => {
  it('forwards set_music_intensity with the default track', () => {
    run('set_music_intensity', { intensity: 0.75, rampMs: 500 });
    expect(audioManagerMock.setMusicIntensity).toHaveBeenCalledWith(DEFAULT_TRACK, 0.75, 500);
  });

  it('builds the full layer options object from the flat payload', () => {
    run('audio_add_layer', {
      entityId: 'e1',
      slotName: 'drums',
      assetId: 'a1',
      volume: 0.5,
      pitch: 1.2,
      loop: true,
      spatial: false,
      bus: 'music',
    });
    expect(audioManagerMock.addLayer).toHaveBeenCalledWith('e1', 'drums', 'a1', {
      volume: 0.5,
      pitch: 1.2,
      loop: true,
      spatial: false,
      bus: 'music',
    });
  });

  it('passes the options through as undefined rather than inventing defaults', () => {
    run('audio_add_layer', { entityId: 'e1', slotName: 'drums', assetId: 'a1' });
    expect(audioManagerMock.addLayer).toHaveBeenCalledWith('e1', 'drums', 'a1', {
      volume: undefined,
      pitch: undefined,
      loop: undefined,
      spatial: undefined,
      bus: undefined,
    });
  });

  it('forwards a layer removal by entity and slot', () => {
    run('audio_remove_layer', { entityId: 'e1', slotName: 'drums' });
    expect(audioManagerMock.removeLayer).toHaveBeenCalledWith('e1', 'drums');
  });

  it('forwards removing every layer on an entity', () => {
    run('audio_remove_all_layers', { entityId: 'e1' });
    expect(audioManagerMock.removeAllLayers).toHaveBeenCalledWith('e1');
  });

  // From and to, in that order — swapping them crossfades the wrong way and
  // nothing reports it.
  it('forwards a crossfade with from before to', () => {
    run('audio_crossfade', { fromEntityId: 'a', toEntityId: 'b', durationMs: 750 });
    expect(audioManagerMock.crossfade).toHaveBeenCalledWith('a', 'b', 750);
  });

  it('forwards a one-shot with its options object', () => {
    run('audio_play_one_shot', {
      assetId: 'a1',
      position: [1, 2, 3],
      bus: 'sfx',
      volume: 0.8,
      pitch: 0.9,
    });
    expect(audioManagerMock.playOneShot).toHaveBeenCalledWith('a1', {
      position: [1, 2, 3],
      bus: 'sfx',
      volume: 0.8,
      pitch: 0.9,
    });
  });

  it('forwards a fade in', () => {
    run('audio_fade_in', { entityId: 'e1', durationMs: 250 });
    expect(audioManagerMock.fadeIn).toHaveBeenCalledWith('e1', 250);
  });

  it('forwards a fade out', () => {
    run('audio_fade_out', { entityId: 'e1', durationMs: 250 });
    expect(audioManagerMock.fadeOut).toHaveBeenCalledWith('e1', 250);
  });

  it('forwards a snapshot save with its crossfade duration', () => {
    run('audio_save_snapshot', { name: 'combat', crossfadeDurationMs: 400 });
    expect(audioManagerMock.saveSnapshot).toHaveBeenCalledWith('combat', 400);
  });

  it('forwards a snapshot load with its duration', () => {
    run('audio_load_snapshot', { name: 'combat', durationMs: 400 });
    expect(audioManagerMock.loadSnapshot).toHaveBeenCalledWith('combat', 400);
  });

  it('forwards loop-point detection with its options object', () => {
    run('audio_detect_loop_points', { assetId: 'a1', maxResults: 3, minLoopDuration: 2 });
    expect(audioManagerMock.detectLoopPoints).toHaveBeenCalledWith('a1', {
      maxResults: 3,
      minLoopDuration: 2,
    });
  });
});
