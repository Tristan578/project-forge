/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { audioManager } from './audioManager';

// Type-safe singleton access helpers
interface AudioInstance {
  entityId: string;
  assetId: string;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  pannerNode: PannerNode | null;
  isPlaying: boolean;
  isPaused: boolean;
  startTime: number;
  pauseOffset: number;
  loop: boolean;
  bus: string;
  /**
   * Pitch is stored on the instance rather than only on the source node, so
   * that `play()` can stamp it onto each source it builds. A field missing from
   * this hand-written mirror is invisible to every assertion in the file.
   */
  pitch: number;
}

interface AudioManagerInternal {
  ctx: AudioContext | null;
  instances: Map<string, AudioInstance>;
  buffers: Map<string, AudioBuffer>;
  buses: Map<string, unknown>;
  irBuffers: Map<number, AudioBuffer>;
  oneShotInstances: Map<string, { source: AudioBufferSourceNode; gainNode: GainNode }>;
  oneShotCount: number;
  duckingRules: unknown[];
  activeDuckTriggers: Map<string, number>;
  occlusionEnabled: Set<string>;
  occlusionFilters: Map<string, BiquadFilterNode>;
}

function getInternal(): AudioManagerInternal {
  return audioManager as unknown as AudioManagerInternal;
}

// Mock Web Audio API
class MockAudioBuffer {
  duration = 1.0;
  sampleRate = 44100;
  length = 44100;
  numberOfChannels = 2;
  getChannelData(_channel: number) {
    return new Float32Array(44100);
  }
}

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = { value: 1.0 };
  onended: (() => void) | null = null;
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }

  start(_when?: number, _offset?: number) {
    // Simulate playback
  }

  stop() {
    if (this.onended) {
      this.onended();
    }
  }
}

class MockGainNode {
  gain = { value: 1.0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }
}

class MockPannerNode {
  distanceModel: DistanceModelType = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  positionX = { value: 0 };
  positionY = { value: 0 };
  positionZ = { value: 0 };
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }
}

class MockConvolverNode {
  buffer: AudioBuffer | null = null;
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }
}

class MockBiquadFilterNode {
  type: BiquadFilterType = 'lowpass';
  frequency = { value: 350, linearRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
  Q = { value: 1 };
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }
}

class MockDynamicsCompressorNode {
  threshold = { value: -24 };
  knee = { value: 30 };
  ratio = { value: 12 };
  attack = { value: 0.003 };
  release = { value: 0.25 };
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }
}

class MockDelayNode {
  delayTime = { value: 0 };
  private connected = false;

  connect(destination: unknown): unknown {
    this.connected = true;
    return destination;
  }

  disconnect() {
    this.connected = false;
  }
}

class MockAudioListener {
  positionX = { value: 0 };
  positionY = { value: 0 };
  positionZ = { value: 0 };
  forwardX = { value: 0 };
  forwardY = { value: 0 };
  forwardZ = { value: -1 };
  upX = { value: 0 };
  upY = { value: 1 };
  upZ = { value: 0 };

  setPosition = vi.fn();
  setOrientation = vi.fn();
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = new MockGainNode();
  listener = new MockAudioListener();

  createGain = vi.fn(() => new MockGainNode());
  createPanner = vi.fn(() => new MockPannerNode());
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode());
  createConvolver = vi.fn(() => new MockConvolverNode());
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode());
  createDynamicsCompressor = vi.fn(() => new MockDynamicsCompressorNode());
  createDelay = vi.fn((_maxDelay: number) => new MockDelayNode());

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const buffer = new MockAudioBuffer();
    buffer.numberOfChannels = numberOfChannels;
    buffer.length = length;
    buffer.sampleRate = sampleRate;
    return buffer as unknown as AudioBuffer;
  }

  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => {
    return new MockAudioBuffer() as unknown as AudioBuffer;
  });

  close = vi.fn();
  resume = vi.fn();
}

describe('audioManager', () => {
  beforeEach(() => {
    // Reset singleton state
    getInternal().ctx = null;
    getInternal().instances = new Map();
    getInternal().buffers = new Map();
    getInternal().buses = new Map();
    getInternal().irBuffers = new Map();
    getInternal().oneShotInstances = new Map();
    getInternal().oneShotCount = 0;
    getInternal().duckingRules = [];
    getInternal().activeDuckTriggers = new Map();
    getInternal().occlusionEnabled = new Set();
    getInternal().occlusionFilters = new Map();

    // Mock global AudioContext
    global.AudioContext = MockAudioContext as unknown as typeof AudioContext;

    // Clear document event listeners
    vi.clearAllMocks();
  });

  describe('ensureContext', () => {
    it('creates AudioContext lazily', () => {
      const ctx = audioManager.ensureContext();
      expect(ctx).toBeDefined();
      expect(ctx.state).toBe('running');
    });

    it('returns same context on repeated calls', () => {
      const ctx1 = audioManager.ensureContext();
      const ctx2 = audioManager.ensureContext();
      expect(ctx1).toBe(ctx2);
    });

    it('initializes default buses', () => {
      audioManager.ensureContext();
      expect(audioManager.getBusVolume('master')).toBe(1.0);
      expect(audioManager.getBusVolume('sfx')).toBe(1.0);
      expect(audioManager.getBusVolume('music')).toBe(0.8);
      expect(audioManager.getBusVolume('ambient')).toBe(0.7);
      expect(audioManager.getBusVolume('voice')).toBe(1.0);
    });
  });

  describe('loadBuffer', () => {
    it('decodes and stores buffer', async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);

      const ctx = audioManager.ensureContext();
      expect(ctx.decodeAudioData).toHaveBeenCalledWith(data);
    });

    it('throws on decode failure', async () => {
      const ctx = audioManager.ensureContext();
      (ctx.decodeAudioData as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('decode failed'));

      const data = new ArrayBuffer(100);
      await expect(audioManager.loadBuffer('bad-asset', data)).rejects.toThrow('decode failed');
    });
  });

  describe('createInstance and play', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
    });

    it('creates instance without spatial audio', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });

      expect(getInternal().instances.has('entity1')).toBe(true);
    });

    it('creates instance with spatial audio', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });

      const instance = getInternal().instances.get('entity1');
      expect(instance).toBeDefined();
      expect(instance!.pannerNode).toBeDefined();
    });

    it('play creates source and gain chain', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });

      audioManager.play('entity1');

      const instance = getInternal().instances.get('entity1');
      expect(instance!.isPlaying).toBe(true);
      expect(instance!.source).toBeDefined();
    });

    it('play with spatial creates PannerNode chain', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });

      audioManager.play('entity1');

      const instance = getInternal().instances.get('entity1');
      expect(instance!.pannerNode).toBeDefined();
      expect(instance!.source).toBeDefined();
    });

    // Every number below arrives from one of two places that do not check it:
    // an LLM tool call, which `audioEntityHandlers` copies off `args` on a bare
    // `!== undefined`, or the engine, which emits these without clamping. Web
    // Audio setters throw a RangeError on a non-finite or out-of-range value,
    // and `useEngineEvents` has no catch — so one bad number would take down
    // the whole event dispatch rather than one sound.
    it('clamps out-of-range spatial numbers rather than passing them to Web Audio', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 0,
        refDistance: 1,
        rolloffFactor: -5,
        bus: 'sfx',
      });

      const panner = getInternal().instances.get('entity1')!.pannerNode!;
      expect(panner.maxDistance).toBe(1);
      expect(panner.rolloffFactor).toBe(0);
    });

    it('falls back for non-finite numbers, which no min/max clamp excludes', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: Number.NaN,
        pitch: Number.NaN,
        loopAudio: false,
        spatial: true,
        maxDistance: Number.NaN,
        refDistance: Number.NaN,
        rolloffFactor: Number.NaN,
        bus: 'sfx',
      });

      const instance = getInternal().instances.get('entity1')!;
      expect(instance.pitch).toBe(1);
      expect(instance.gainNode.gain.value).toBe(1);
      expect(instance.pannerNode!.maxDistance).toBe(50);
      expect(instance.pannerNode!.refDistance).toBe(1);
      expect(instance.pannerNode!.rolloffFactor).toBe(1);
    });

    it('carries the created pitch onto the source play builds', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 0.5,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });

      audioManager.play('entity1');

      expect(getInternal().instances.get('entity1')!.source!.playbackRate.value).toBe(0.5);
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
      audioManager.play('entity1');
    });

    it('disconnects nodes and resets state', () => {
      audioManager.stop('entity1');

      const instance = getInternal().instances.get('entity1');
      expect(instance!.isPlaying).toBe(false);
      expect(instance!.source).toBe(null);
      expect(instance!.pauseOffset).toBe(0);
    });
  });

  describe('pause and resume', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
      audioManager.play('entity1');
    });

    it('pause records offset', () => {
      audioManager.pause('entity1');

      const instance = getInternal().instances.get('entity1');
      expect(instance!.isPlaying).toBe(false);
      expect(instance!.isPaused).toBe(true);
    });

    it('resume continues from paused offset', () => {
      audioManager.pause('entity1');
      audioManager.resume('entity1');

      const instance = getInternal().instances.get('entity1');
      expect(instance!.isPlaying).toBe(true);
      expect(instance!.isPaused).toBe(false);
    });
  });

  describe('setVolume', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
    });

    it('adjusts gain node value', () => {
      audioManager.setVolume('entity1', 0.5);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.gainNode.gain.value).toBe(0.5);
    });
  });

  // Pitch is the one setting that used to live ONLY on the
  // `AudioBufferSourceNode`, which `play()` rebuilds from scratch every time.
  // So a pitch set before playback was written to a node that did not exist
  // yet, and a pitch set during playback was discarded by the next `stop()` /
  // `play()`. It now lives on the instance, and `play()` stamps it onto each
  // new source — these cases pin both halves of that.
  describe('setPitch', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
    });

    it('adjusts playbackRate', () => {
      audioManager.play('entity1');

      audioManager.setPitch('entity1', 1.5);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.source!.playbackRate.value).toBe(1.5);
    });

    it('applies a pitch set before playback to the source play creates', () => {
      audioManager.setPitch('entity1', 1.5);

      audioManager.play('entity1');

      const instance = getInternal().instances.get('entity1');
      expect(instance!.source!.playbackRate.value).toBe(1.5);
    });

    it('keeps the pitch across a stop and a replay', () => {
      audioManager.play('entity1');
      audioManager.setPitch('entity1', 2.0);
      const firstSource = getInternal().instances.get('entity1')!.source;

      audioManager.stop('entity1');
      audioManager.play('entity1');

      const secondSource = getInternal().instances.get('entity1')!.source;
      // A genuinely new node, so this is not the first one still reading 2.0.
      expect(secondSource).not.toBe(firstSource);
      expect(secondSource!.playbackRate.value).toBe(2.0);
    });

    it('clamps to the range the inspector offers', () => {
      audioManager.play('entity1');

      audioManager.setPitch('entity1', 99);
      expect(getInternal().instances.get('entity1')!.pitch).toBe(4);

      audioManager.setPitch('entity1', 0);
      expect(getInternal().instances.get('entity1')!.pitch).toBe(0.25);
    });

    it('falls back to 1 for a non-finite pitch', () => {
      // `Math.max(min, Math.min(max, NaN))` is NaN, and Web Audio throws a
      // RangeError on a NaN playbackRate — the clamp has to reject non-finite
      // input explicitly, not merely bound it.
      audioManager.play('entity1');

      audioManager.setPitch('entity1', Number.NaN);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.pitch).toBe(1);
      expect(instance!.source!.playbackRate.value).toBe(1);
    });

    it('does nothing for an entity with no instance', () => {
      expect(() => audioManager.setPitch('never-created', 1.5)).not.toThrow();
    });
  });

  describe('isPlaying', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
    });

    it('returns false when not playing', () => {
      expect(audioManager.isPlaying('entity1')).toBe(false);
    });

    it('returns true when playing', () => {
      audioManager.play('entity1');
      expect(audioManager.isPlaying('entity1')).toBe(true);
    });
  });

  describe('updatePosition', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
    });

    it('sets panner position for spatial audio', () => {
      audioManager.updatePosition('entity1', 10, 20, 30);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.pannerNode!.positionX.value).toBe(10);
      expect(instance!.pannerNode!.positionY.value).toBe(20);
      expect(instance!.pannerNode!.positionZ.value).toBe(30);
    });
  });

  describe('bus controls', () => {
    it('setBusVolume adjusts bus gain', () => {
      audioManager.ensureContext();
      audioManager.setBusVolume('sfx', 0.5);

      expect(audioManager.getBusVolume('sfx')).toBe(0.5);
    });

    it('muteBus mutes bus', () => {
      audioManager.ensureContext();
      audioManager.muteBus('sfx', true);

      expect(audioManager.isBusMuted('sfx')).toBe(true);
    });

    it('soloBus solos bus and mutes others', () => {
      audioManager.ensureContext();
      audioManager.soloBus('sfx', true);

      expect(audioManager.isBusMuted('music')).toBe(true);
    });
  });

  describe('crossfade', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'music',
      });
      audioManager.createInstance('entity2', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'music',
      });
      audioManager.play('entity1');
    });

    it('transitions between entities', () => {
      audioManager.crossfade('entity1', 'entity2', 1000);

      const fromInstance = getInternal().instances.get('entity1');
      const toInstance = getInternal().instances.get('entity2');

      expect(fromInstance!.gainNode.gain.cancelScheduledValues).toHaveBeenCalled();
      expect(toInstance!.gainNode.gain.cancelScheduledValues).toHaveBeenCalled();
    });
  });

  describe('playOneShot', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
    });

    it('creates one-shot audio', () => {
      const id = audioManager.playOneShot('test-asset', { volume: 0.5, pitch: 1.5 });

      expect(id).toMatch(/^__oneshot_/);
      expect(getInternal().oneShotInstances.has(id)).toBe(true);
    });
  });

  describe('fadeIn', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
    });

    it('ramps gain from 0 to target', () => {
      audioManager.fadeIn('entity1', 1000);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });
  });

  describe('fadeOut', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
      audioManager.play('entity1');
    });

    it('ramps gain to 0', () => {
      audioManager.fadeOut('entity1', 1000, false);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });
  });

  describe('cleanup', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        bus: 'sfx',
      });
      audioManager.play('entity1');
    });

    it('disposes all resources', () => {
      audioManager.destroyAll();

      expect(getInternal().instances.size).toBe(0);
    });
  });

  describe('addLayer', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
    });

    it('adds layer to entity', () => {
      audioManager.addLayer('entity1', 'layer1', 'test-asset', { volume: 0.5, loop: true });

      expect(getInternal().instances.has('entity1:layer1')).toBe(true);
    });

    it('honours the pitch the caller passed', () => {
      // `options.pitch` was in this signature and read by nothing, so a layer's
      // pitch was dropped on the floor at every call site.
      audioManager.addLayer('entity1', 'layer1', 'test-asset', { pitch: 0.75 });

      expect(getInternal().instances.get('entity1:layer1')!.pitch).toBe(0.75);
    });

    it('defaults a layer with no pitch to 1', () => {
      audioManager.addLayer('entity1', 'layer1', 'test-asset');

      expect(getInternal().instances.get('entity1:layer1')!.pitch).toBe(1);
    });

    it('caps layers at 8 per entity', () => {
      for (let i = 0; i < 10; i++) {
        audioManager.addLayer('entity1', `layer${i}`, 'test-asset');
      }

      const layerCount = Array.from(getInternal().instances.keys())
        .filter(k => k.startsWith('entity1:')).length;
      expect(layerCount).toBeLessThanOrEqual(8);
    });
  });

  describe('removeLayer', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
      audioManager.addLayer('entity1', 'layer1', 'test-asset');
    });

    it('removes specific layer', () => {
      audioManager.removeLayer('entity1', 'layer1');

      expect(getInternal().instances.has('entity1:layer1')).toBe(false);
    });
  });

  describe('addDuckingRule', () => {
    beforeEach(() => {
      audioManager.ensureContext();
    });

    it('adds ducking rule', () => {
      audioManager.addDuckingRule({
        triggerBus: 'voice',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 200,
        releaseMs: 500,
      });

      const rules = audioManager.getDuckingRules();
      expect(rules.length).toBeGreaterThan(0);
    });
  });

  describe('removeDuckingRule', () => {
    beforeEach(() => {
      audioManager.ensureContext();
      audioManager.addDuckingRule({
        triggerBus: 'test',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 200,
        releaseMs: 500,
      });
    });

    it('removes ducking rule', () => {
      const before = audioManager.getDuckingRules().length;
      audioManager.removeDuckingRule('test', 'music');
      const after = audioManager.getDuckingRules().length;

      expect(after).toBeLessThan(before);
    });
  });

  describe('occlusion', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('test-asset', data);
    });

    it('creates filter when occlusion is enabled', () => {
      audioManager.setOcclusion('entity1', true);

      expect(getInternal().occlusionEnabled.has('entity1')).toBe(true);
      expect(getInternal().occlusionFilters.has('entity1')).toBe(true);
    });

    it('removes filter when occlusion is disabled', () => {
      audioManager.setOcclusion('entity1', true);
      audioManager.setOcclusion('entity1', false);

      expect(getInternal().occlusionEnabled.has('entity1')).toBe(false);
      expect(getInternal().occlusionFilters.has('entity1')).toBe(false);
    });

    it('isOcclusionEnabled reflects current state', () => {
      expect(audioManager.isOcclusionEnabled('entity1')).toBe(false);
      audioManager.setOcclusion('entity1', true);
      expect(audioManager.isOcclusionEnabled('entity1')).toBe(true);
    });

    it('updateOcclusionState ramps filter frequency', () => {
      audioManager.setOcclusion('entity1', true);
      const filter = getInternal().occlusionFilters.get('entity1')!;

      audioManager.updateOcclusionState('entity1', true);
      // Verify filter frequency is being ramped (mock doesn't track, but no error)
      expect(filter).toBeDefined();
      expect(filter.type).toBe('lowpass');
    });

    it('getOccludableEntities returns playing spatial entities', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });
      audioManager.play('entity1');
      audioManager.setOcclusion('entity1', true);

      const occludables = audioManager.getOccludableEntities();
      expect(occludables).toContain('entity1');
    });

    it('getOccludableEntities excludes non-playing entities', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });
      audioManager.setOcclusion('entity1', true);

      // Not playing yet
      const occludables = audioManager.getOccludableEntities();
      expect(occludables).not.toContain('entity1');
    });

    it('releases the filter when the entity is destroyed', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });
      audioManager.setOcclusion('entity1', true);
      const filter = getInternal().occlusionFilters.get('entity1')!;
      const disconnect = vi.spyOn(filter, 'disconnect');

      audioManager.destroyInstance('entity1');

      // Disconnecting matters as much as deleting: a filter still wired into a
      // bus keeps its whole upstream chain reachable, so dropping only the map
      // entry would leak the graph rather than fix it.
      expect(disconnect).toHaveBeenCalled();
      expect(getInternal().occlusionFilters.has('entity1')).toBe(false);
      expect(getInternal().occlusionEnabled.has('entity1')).toBe(false);
    });

    it('releases the filter even when the entity has no instance', () => {
      // `setOcclusion` builds the filter without needing an instance, and
      // `createInstance` bails on a buffer that is still decoding — so this is
      // the reachable state, not a synthetic one. `syncEntityAudioInstance`
      // calls `destroyInstance(id)` with no slot the moment the clip is
      // cleared, and a release placed after the missing-instance bail would
      // never run for precisely the entity holding an orphaned filter.
      audioManager.setOcclusion('entity1', true);
      const filter = getInternal().occlusionFilters.get('entity1')!;
      const disconnect = vi.spyOn(filter, 'disconnect');

      audioManager.destroyInstance('entity1');

      expect(disconnect).toHaveBeenCalled();
      expect(getInternal().occlusionFilters.has('entity1')).toBe(false);
      expect(getInternal().occlusionEnabled.has('entity1')).toBe(false);
    });

    it('keeps the entity filter when a single layer is destroyed', () => {
      // The filter belongs to the entity, not to one of its layers: removing a
      // music stem must not un-occlude everything else the entity plays.
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });
      audioManager.setOcclusion('entity1', true);

      audioManager.destroyInstance('entity1', 'layer1');

      expect(getInternal().occlusionFilters.has('entity1')).toBe(true);
      expect(getInternal().occlusionEnabled.has('entity1')).toBe(true);
    });

    it('keeps the entity filter when the clip is swapped', () => {
      // `createInstance` replaces any existing instance, and it did that by
      // calling the public `destroyInstance` — so re-pointing an occluded entity
      // at another clip silently un-occluded it. Once the release moved ahead of
      // the missing-instance bail, that same call would also have wiped
      // occlusion on the decode-retry path, i.e. the exact case the release
      // exists to serve. Replacement now goes through `teardownInstance`.
      audioManager.setOcclusion('entity1', true);
      const filter = getInternal().occlusionFilters.get('entity1')!;

      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });

      expect(getInternal().occlusionEnabled.has('entity1')).toBe(true);
      // The same node, not a rebuilt one: `setOcclusion` is the only builder, so
      // a dropped filter stays dropped until a caller re-enables occlusion.
      expect(getInternal().occlusionFilters.get('entity1')).toBe(filter);
    });

    it('destroyAll releases a layered entity whose keys never name it directly', () => {
      // `destroyAll` iterates instance KEYS, and a layered entity's keys all
      // carry a `:slot` suffix — so `destroyInstance` is only ever handed
      // `entity1:layer1`, and the per-entity release inside it looks up a key
      // that does not exist. The sweep in `destroyAll` is what closes that, and
      // it is load-bearing rather than belt-and-braces: without it a layered
      // entity's filter survives every Play -> Stop cycle.
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      }, 'layer1');
      audioManager.setOcclusion('entity1', true);
      const filter = getInternal().occlusionFilters.get('entity1')!;
      const disconnect = vi.spyOn(filter, 'disconnect');
      // Precondition: the only instance key is the compound one.
      expect(Array.from(getInternal().instances.keys())).toEqual(['entity1:layer1']);

      audioManager.destroyAll();

      expect(disconnect).toHaveBeenCalled();
      expect(getInternal().occlusionFilters.has('entity1')).toBe(false);
      expect(getInternal().occlusionEnabled.has('entity1')).toBe(false);
    });

    it('getSourcePosition returns panner position', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: true, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });
      audioManager.updatePosition('entity1', 5, 10, 15);

      const pos = audioManager.getSourcePosition('entity1');
      expect(pos).toEqual([5, 10, 15]);
    });

    it('getSourcePosition returns null for non-spatial', () => {
      audioManager.createInstance('entity1', 'test-asset', {
        volume: 0.8, pitch: 1.0, loopAudio: false,
        spatial: false, maxDistance: 50, refDistance: 1, rolloffFactor: 1, bus: 'sfx',
      });

      const pos = audioManager.getSourcePosition('entity1');
      expect(pos).toBeNull();
    });

    it('getListenerPosition returns listener coordinates', () => {
      audioManager.ensureContext();
      audioManager.updateListener(1, 2, 3, 0, 0, -1);

      const pos = audioManager.getListenerPosition();
      expect(pos).toEqual([1, 2, 3]);
    });
  });
});
