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

describe('audio commands reach audioManager', () => {
  it('forwards set_music_intensity with the default track', () => {
    run('set_music_intensity', { intensity: 0.75, rampMs: 500 });
    expect(audioManagerMock.setMusicIntensity).toHaveBeenCalledWith(DEFAULT_TRACK, 0.75, 500);
  });

  it('forwards a layer add', () => {
    run('audio_add_layer', { entityId: 'e1', slotName: 'drums', assetId: 'a1' });
    expect(audioManagerMock.addLayer).toHaveBeenCalled();
  });
});
