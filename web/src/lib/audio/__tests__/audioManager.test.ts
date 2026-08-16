/**
 * AudioManager pitch behaviour.
 *
 * `pitch` used to live only on the `AudioBufferSourceNode`, which exists only
 * while a sound is playing and is rebuilt from scratch by every `play()`. So a
 * pitch set before playback, or set and then replayed, was silently discarded —
 * and `addLayer` accepted an `options.pitch` that nothing ever read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal Web Audio stand-in
// ---------------------------------------------------------------------------

class FakeParam {
  constructor(public value = 0) {}
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}

class FakeNode {
  connect(target: FakeNode) { return target; }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakePanner extends FakeNode {
  distanceModel = 'inverse';
  refDistance = 1;
  maxDistance = 50;
  rolloffFactor = 1;
  positionX = new FakeParam(0);
  positionY = new FakeParam(0);
  positionZ = new FakeParam(0);
}

/** Every source node the manager has built, oldest first. */
const sources: FakeSource[] = [];

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  started = false;
  constructor() {
    super();
    sources.push(this);
  }
  start() { this.started = true; }
  stop() { this.started = false; }
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  createGain() { return new FakeGain(); }
  createPanner() { return new FakePanner(); }
  createBufferSource() { return new FakeSource(); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { frequency: new FakeParam(350), Q: new FakeParam(1), type: 'lowpass' }); }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(-24), knee: new FakeParam(30), ratio: new FakeParam(12),
      attack: new FakeParam(0.003), release: new FakeParam(0.25),
    });
  }
  decodeAudioData() { return Promise.resolve({ duration: 1, length: 44100, sampleRate: 44100 }); }
  resume() { return Promise.resolve(); }
}

const AUDIO_DATA = {
  volume: 1,
  pitch: 1,
  loopAudio: false,
  spatial: false,
  maxDistance: 50,
  refDistance: 1,
  rolloffFactor: 1,
  bus: 'sfx',
};

/**
 * Fresh manager per test — it is a module singleton holding an AudioContext and
 * an instance map, so state would otherwise leak between cases.
 */
async function freshManager() {
  sources.length = 0;
  vi.resetModules();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const { audioManager } = await import('../audioManager');
  await audioManager.loadBuffer('asset-1', new ArrayBuffer(8));
  return audioManager;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AudioManager pitch', () => {
  it('applies a pitch set before the sound ever plays', async () => {
    const manager = await freshManager();
    manager.createInstance('ent-1', 'asset-1', AUDIO_DATA);

    // Nothing is playing yet, so there is no source node to write to. This used
    // to return early and drop the value.
    manager.setPitch('ent-1', 2);
    manager.play('ent-1');

    expect(sources.at(-1)!.playbackRate.value).toBe(2);
  });

  it('keeps the pitch across a stop and replay', async () => {
    const manager = await freshManager();
    manager.createInstance('ent-1', 'asset-1', AUDIO_DATA);
    manager.play('ent-1');
    manager.setPitch('ent-1', 0.5);
    expect(sources.at(-1)!.playbackRate.value).toBe(0.5);

    // `play()` builds a brand new source node, so the pitch has to be re-applied
    // from the instance rather than assumed to still be on the old node.
    manager.stop('ent-1');
    manager.play('ent-1');

    expect(sources).toHaveLength(2);
    expect(sources.at(-1)!.playbackRate.value).toBe(0.5);
  });

  it('carries the createInstance pitch onto the first source', async () => {
    const manager = await freshManager();
    manager.createInstance('ent-1', 'asset-1', { ...AUDIO_DATA, pitch: 1.5 });
    manager.play('ent-1');

    expect(sources.at(-1)!.playbackRate.value).toBe(1.5);
  });

  it('clamps to the playable range', async () => {
    const manager = await freshManager();
    manager.createInstance('ent-1', 'asset-1', AUDIO_DATA);

    manager.setPitch('ent-1', 99);
    manager.play('ent-1');
    expect(sources.at(-1)!.playbackRate.value).toBe(4);

    manager.setPitch('ent-1', 0);
    expect(sources.at(-1)!.playbackRate.value).toBe(0.25);
  });

  it('honours a layer pitch instead of dropping it', async () => {
    const manager = await freshManager();
    // `addLayer` auto-plays, so the source it builds is the assertion target.
    manager.addLayer('ent-1', 'stem-a', 'asset-1', { pitch: 0.75 });

    expect(sources.at(-1)!.playbackRate.value).toBe(0.75);
  });

  it('ignores a pitch for an entity with no instance', async () => {
    const manager = await freshManager();
    expect(() => manager.setPitch('nobody', 2)).not.toThrow();
  });
});
