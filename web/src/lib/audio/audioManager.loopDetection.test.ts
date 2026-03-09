/**
 * @vitest-environment jsdom
 *
 * Tests for loop point detection in audioManager.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { audioManager } from './audioManager';

// ---- Internal access ----
interface AudioManagerInternal {
  ctx: AudioContext | null;
  instances: Map<string, unknown>;
  buffers: Map<string, AudioBuffer>;
  buses: Map<string, unknown>;
  irBuffers: Map<number, AudioBuffer>;
  oneShotInstances: Map<string, unknown>;
  oneShotCount: number;
  duckingRules: unknown[];
  activeDuckTriggers: Map<string, number>;
  occlusionEnabled: Set<string>;
  occlusionFilters: Map<string, BiquadFilterNode>;
  adaptiveTracks: Map<string, unknown>;
  snapshots: Map<string, unknown>;
}

function getInternal(): AudioManagerInternal {
  return audioManager as unknown as AudioManagerInternal;
}

// ---- Mock Audio API ----
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

class MockBiquadFilterNode {
  type: BiquadFilterType = 'lowpass';
  frequency = { value: 350, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  Q = { value: 1 };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockConvolverNode {
  buffer: AudioBuffer | null = null;
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockDynamicsCompressorNode {
  threshold = { value: -24 }; knee = { value: 30 }; ratio = { value: 12 };
  attack = { value: 0.003 }; release = { value: 0.25 };
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockDelayNode {
  delayTime = { value: 0 };
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

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      sampleRate,
      length,
      numberOfChannels,
      getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
  }

  decodeAudioData = vi.fn(async () => ({
    duration: 1.0, sampleRate: 44100, length: 44100, numberOfChannels: 2,
    getChannelData: () => new Float32Array(44100),
  }) as unknown as AudioBuffer);
  close = vi.fn();
  resume = vi.fn();
}

/**
 * Create a fake AudioBuffer with a specific waveform.
 */
function createFakeBuffer(samples: Float32Array, sampleRate: number = 44100): AudioBuffer {
  return {
    duration: samples.length / sampleRate,
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: (_ch: number) => samples,
  } as unknown as AudioBuffer;
}

describe('audioManager - Loop Point Detection', () => {
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
    internal.adaptiveTracks = new Map();
    internal.snapshots = new Map();

    vi.stubGlobal('AudioContext', MockAudioContext);
    audioManager.ensureContext();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty array for unknown asset', () => {
    const result = audioManager.detectLoopPoints('nonexistent');
    expect(result).toEqual([]);
  });

  it('finds zero crossings in a sine wave', () => {
    const sampleRate = 44100;
    const duration = 2; // 2 seconds
    const totalSamples = sampleRate * duration;
    const samples = new Float32Array(totalSamples);

    // Generate 440 Hz sine wave (has many zero crossings)
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }

    getInternal().buffers.set('sine440', createFakeBuffer(samples, sampleRate));

    const points = audioManager.detectLoopPoints('sine440');
    expect(points.length).toBeGreaterThan(0);

    // All points should have valid ranges
    for (const pt of points) {
      expect(pt.startSample).toBeGreaterThanOrEqual(0);
      expect(pt.endSample).toBeGreaterThan(pt.startSample);
      expect(pt.startTime).toBeLessThan(pt.endTime);
      expect(pt.score).toBeGreaterThanOrEqual(0);
      expect(pt.score).toBeLessThanOrEqual(1);
    }
  });

  it('loop points have valid time ranges', () => {
    const sampleRate = 44100;
    const totalSamples = sampleRate * 3;
    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 100 * i / sampleRate);
    }

    getInternal().buffers.set('test-loop', createFakeBuffer(samples, sampleRate));

    const points = audioManager.detectLoopPoints('test-loop');
    for (const pt of points) {
      expect(pt.startTime).toBeCloseTo(pt.startSample / sampleRate, 5);
      expect(pt.endTime).toBeCloseTo(pt.endSample / sampleRate, 5);
    }
  });

  it('minLoopDuration filters short loops', () => {
    const sampleRate = 44100;
    const totalSamples = sampleRate * 2;
    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }

    getInternal().buffers.set('dur-test', createFakeBuffer(samples, sampleRate));

    // With 1.5s minimum, all loops must be >= 1.5s
    const points = audioManager.detectLoopPoints('dur-test', { minLoopDuration: 1.5 });
    for (const pt of points) {
      const duration = pt.endTime - pt.startTime;
      expect(duration).toBeGreaterThanOrEqual(1.49); // Allow tiny float error
    }
  });

  it('results sorted by score (highest first)', () => {
    const sampleRate = 44100;
    const totalSamples = sampleRate * 3;
    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 200 * i / sampleRate);
    }

    getInternal().buffers.set('sorted-test', createFakeBuffer(samples, sampleRate));

    const points = audioManager.detectLoopPoints('sorted-test', { maxResults: 10 });
    for (let i = 1; i < points.length; i++) {
      expect(points[i - 1].score).toBeGreaterThanOrEqual(points[i].score);
    }
  });

  it('maxResults limits output count', () => {
    const sampleRate = 44100;
    const totalSamples = sampleRate * 3;
    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 200 * i / sampleRate);
    }

    getInternal().buffers.set('max-test', createFakeBuffer(samples, sampleRate));

    const points = audioManager.detectLoopPoints('max-test', { maxResults: 2 });
    expect(points.length).toBeLessThanOrEqual(2);
  });

  it('silent buffer returns full-length loop', () => {
    const sampleRate = 44100;
    const totalSamples = sampleRate * 2;
    const samples = new Float32Array(totalSamples); // All zeros

    getInternal().buffers.set('silence', createFakeBuffer(samples, sampleRate));

    const points = audioManager.detectLoopPoints('silence');
    expect(points.length).toBe(1);
    expect(points[0].startSample).toBe(0);
    expect(points[0].endSample).toBe(totalSamples - 1);
    expect(points[0].score).toBe(0.5);
  });

  it('very short buffer returns full-length loop', () => {
    const sampleRate = 44100;
    const totalSamples = 1000; // Very short (~23ms)
    const samples = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }

    getInternal().buffers.set('short', createFakeBuffer(samples, sampleRate));

    // minLoopDuration defaults to 0.5s, buffer is only 23ms
    const points = audioManager.detectLoopPoints('short');
    expect(points.length).toBe(1);
    expect(points[0].startSample).toBe(0);
    expect(points[0].endSample).toBe(totalSamples - 1);
  });
});
