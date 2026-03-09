/**
 * @vitest-environment jsdom
 *
 * Tests for audio snapshot save/load/delete and occlusion enhancement.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { audioManager } from './audioManager';

// ---- Internal access ----
interface BusStateInternal {
  name: string;
  gainNode: GainNode;
  volume: number;
  muted: boolean;
  soloed: boolean;
  effectiveMuted: boolean;
  effects: unknown[];
  duckGainNode: GainNode;
}

interface AudioManagerInternal {
  ctx: AudioContext | null;
  instances: Map<string, unknown>;
  buffers: Map<string, AudioBuffer>;
  buses: Map<string, BusStateInternal>;
  irBuffers: Map<number, AudioBuffer>;
  oneShotInstances: Map<string, unknown>;
  oneShotCount: number;
  duckingRules: unknown[];
  activeDuckTriggers: Map<string, number>;
  occlusionEnabled: Set<string>;
  occlusionFilters: Map<string, BiquadFilterNode>;
  occlusionReverbNodes: Map<string, { convolver: ConvolverNode; wetGain: GainNode }>;
  adaptiveTracks: Map<string, unknown>;
  snapshots: Map<string, unknown>;
}

function getInternal(): AudioManagerInternal {
  return audioManager as unknown as AudioManagerInternal;
}

// ---- Mock Web Audio API ----
class MockAudioBuffer {
  duration = 1.0;
  sampleRate = 44100;
  length = 44100;
  numberOfChannels = 2;
  getChannelData(_channel: number) {
    return new Float32Array(44100);
  }
}

class MockGainNode {
  gain = {
    value: 1.0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockBiquadFilterNode {
  type: BiquadFilterType = 'lowpass';
  frequency = {
    value: 5000,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  Q = { value: 1.0 };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockPannerNode {
  distanceModel: DistanceModelType = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  positionX = { value: 0 };
  positionY = { value: 0 };
  positionZ = { value: 0 };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = { value: 1.0 };
  onended: (() => void) | null = null;
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
  start(_when?: number, _offset?: number) {}
  stop() { if (this.onended) this.onended(); }
}

class MockConvolverNode {
  buffer: AudioBuffer | null = null;
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockDelayNode {
  delayTime = { value: 0 };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockDynamicsCompressorNode {
  threshold = { value: -24 };
  knee = { value: 30 };
  ratio = { value: 12 };
  attack = { value: 0.003 };
  release = { value: 0.25 };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockAudioListener {
  positionX = { value: 0 }; positionY = { value: 0 }; positionZ = { value: 0 };
  forwardX = { value: 0 }; forwardY = { value: 0 }; forwardZ = { value: -1 };
  upX = { value: 0 }; upY = { value: 1 }; upZ = { value: 0 };
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

  decodeAudioData = vi.fn(async () => new MockAudioBuffer() as unknown as AudioBuffer);
  close = vi.fn();
  resume = vi.fn();
}

// ---- Tests ----
describe('audioManager - Snapshots', () => {
  beforeEach(() => {
    const internal = getInternal();
    internal.ctx = null;
    internal.instances = new Map();
    internal.buffers = new Map();
    internal.buses = new Map();
    internal.irBuffers = new Map();
    internal.oneShotInstances = new Map();
    internal.oneShotCount = 0;
    internal.duckingRules = [];
    internal.activeDuckTriggers = new Map();
    internal.occlusionEnabled = new Set();
    internal.occlusionFilters = new Map();
    internal.occlusionReverbNodes = new Map();
    internal.adaptiveTracks = new Map();
    internal.snapshots = new Map();

    // Inject mock AudioContext
    vi.stubGlobal('AudioContext', MockAudioContext);
    audioManager.ensureContext(); // Initializes buses
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('saveSnapshot captures current bus volumes and mute states', () => {
    audioManager.setBusVolume('music', 0.5);
    audioManager.muteBus('sfx', true);

    const snap = audioManager.saveSnapshot('test-snap');

    expect(snap.name).toBe('test-snap');
    expect(snap.busStates.music.volume).toBe(0.5);
    expect(snap.busStates.sfx.muted).toBe(true);
    expect(snap.busStates.master.volume).toBe(1.0);
  });

  it('loadSnapshot applies bus volumes with gain ramp', () => {
    // Set up initial state
    audioManager.setBusVolume('music', 0.3);
    audioManager.saveSnapshot('calm');

    // Change state
    audioManager.setBusVolume('music', 1.0);

    // Load snapshot
    const success = audioManager.loadSnapshot('calm', 500);
    expect(success).toBe(true);

    // Check that the bus volume was updated in stored state
    const internal = getInternal();
    const musicBus = internal.buses.get('music');
    expect(musicBus?.volume).toBe(0.3);
  });

  it('loadSnapshot returns false for non-existent snapshot', () => {
    const success = audioManager.loadSnapshot('nonexistent');
    expect(success).toBe(false);
  });

  it('deleteSnapshot removes the snapshot', () => {
    audioManager.saveSnapshot('temp');
    expect(audioManager.listSnapshots()).toContain('temp');

    const deleted = audioManager.deleteSnapshot('temp');
    expect(deleted).toBe(true);
    expect(audioManager.listSnapshots()).not.toContain('temp');
  });

  it('deleteSnapshot returns false for non-existent snapshot', () => {
    const deleted = audioManager.deleteSnapshot('no-such-snap');
    expect(deleted).toBe(false);
  });

  it('multiple snapshots can coexist', () => {
    audioManager.setBusVolume('music', 0.3);
    audioManager.saveSnapshot('calm');

    audioManager.setBusVolume('music', 1.0);
    audioManager.saveSnapshot('action');

    const names = audioManager.listSnapshots();
    expect(names).toContain('calm');
    expect(names).toContain('action');
    expect(names).toHaveLength(2);
  });

  it('snapshot preserves mute states correctly', () => {
    audioManager.muteBus('ambient', true);
    audioManager.saveSnapshot('muted-ambient');

    const snap = audioManager.getSnapshot('muted-ambient');
    expect(snap?.busStates.ambient.muted).toBe(true);
    expect(snap?.busStates.master.muted).toBe(false);
  });

  it('loadSnapshot uses default crossfade duration from snapshot', () => {
    audioManager.saveSnapshot('with-duration', 2000);
    const snap = audioManager.getSnapshot('with-duration');
    expect(snap?.crossfadeDurationMs).toBe(2000);

    // Load without specifying duration — uses snapshot's default
    const success = audioManager.loadSnapshot('with-duration');
    expect(success).toBe(true);
  });
});

describe('audioManager - Occlusion Enhancement', () => {
  beforeEach(() => {
    const internal = getInternal();
    internal.ctx = null;
    internal.instances = new Map();
    internal.buffers = new Map();
    internal.buses = new Map();
    internal.irBuffers = new Map();
    internal.oneShotInstances = new Map();
    internal.oneShotCount = 0;
    internal.duckingRules = [];
    internal.activeDuckTriggers = new Map();
    internal.occlusionEnabled = new Set();
    internal.occlusionFilters = new Map();
    internal.occlusionReverbNodes = new Map();
    internal.adaptiveTracks = new Map();
    internal.snapshots = new Map();

    vi.stubGlobal('AudioContext', MockAudioContext);
    audioManager.ensureContext();
  });

  it('updateOcclusionAmount at 0.0 targets frequency ~5000 Hz', () => {
    audioManager.setOcclusion('e1', true);

    const filter = getInternal().occlusionFilters.get('e1');
    expect(filter).toBeDefined();

    audioManager.updateOcclusionAmount('e1', 0.0);

    // Should ramp to 5000 * (200/5000)^0 = 5000
    expect(filter!.frequency.linearRampToValueAtTime).toHaveBeenCalled();
    const lastCall = vi.mocked(filter!.frequency.linearRampToValueAtTime).mock.calls.at(-1);
    expect(lastCall?.[0]).toBeCloseTo(5000, 0);
  });

  it('updateOcclusionAmount at 1.0 targets frequency ~200 Hz', () => {
    audioManager.setOcclusion('e1', true);
    const filter = getInternal().occlusionFilters.get('e1');

    audioManager.updateOcclusionAmount('e1', 1.0);

    const lastCall = vi.mocked(filter!.frequency.linearRampToValueAtTime).mock.calls.at(-1);
    expect(lastCall?.[0]).toBeCloseTo(200, 0);
  });

  it('updateOcclusionAmount at 0.5 targets intermediate frequency', () => {
    audioManager.setOcclusion('e1', true);
    const filter = getInternal().occlusionFilters.get('e1');

    audioManager.updateOcclusionAmount('e1', 0.5);

    const lastCall = vi.mocked(filter!.frequency.linearRampToValueAtTime).mock.calls.at(-1);
    const expected = 5000 * Math.pow(200 / 5000, 0.5); // ~1000 Hz
    expect(lastCall?.[0]).toBeCloseTo(expected, 0);
  });

  it('updateOcclusionAmount does nothing for disabled entity', () => {
    // Do NOT enable occlusion
    audioManager.updateOcclusionAmount('e1', 0.5);
    // No filter exists, no error
    expect(getInternal().occlusionFilters.get('e1')).toBeUndefined();
  });

  it('Q value scales with occlusion amount', () => {
    audioManager.setOcclusion('e1', true);
    const filter = getInternal().occlusionFilters.get('e1');

    audioManager.updateOcclusionAmount('e1', 0.0);
    expect(filter!.Q.value).toBeCloseTo(1.0);

    audioManager.updateOcclusionAmount('e1', 1.0);
    expect(filter!.Q.value).toBeCloseTo(4.0);

    audioManager.updateOcclusionAmount('e1', 0.5);
    expect(filter!.Q.value).toBeCloseTo(2.5);
  });

  it('amount is clamped to 0-1 range', () => {
    audioManager.setOcclusion('e1', true);
    const filter = getInternal().occlusionFilters.get('e1');

    audioManager.updateOcclusionAmount('e1', -0.5);
    expect(filter!.Q.value).toBeCloseTo(1.0); // clamped to 0

    audioManager.updateOcclusionAmount('e1', 2.0);
    expect(filter!.Q.value).toBeCloseTo(4.0); // clamped to 1
  });
});
