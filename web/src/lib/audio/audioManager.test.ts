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
  frequency = { value: 350 };
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
      audioManager.play('entity1');
    });

    it('adjusts playbackRate', () => {
      audioManager.setPitch('entity1', 1.5);

      const instance = getInternal().instances.get('entity1');
      expect(instance!.source!.playbackRate.value).toBe(1.5);
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
});
