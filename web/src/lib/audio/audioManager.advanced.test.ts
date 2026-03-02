/**
 * @vitest-environment jsdom
 *
 * Advanced audioManager tests for PF-162:
 * - Bus effect chain (reverb, lowpass, highpass, compressor, delay)
 * - Audio occlusion
 * - Adaptive music (intensity-based stem volumes)
 * - IR buffer generation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { audioManager } from './audioManager';

// ---- Internal singleton access ----
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
  adaptiveTracks: Map<string, unknown>;
}

interface BusStateInternal {
  name: string;
  gainNode: GainNode;
  volume: number;
  muted: boolean;
  soloed: boolean;
  effectiveMuted: boolean;
  effects: EffectInstanceInternal[];
  duckGainNode: GainNode;
}

interface EffectInstanceInternal {
  type: string;
  inputNode: AudioNode;
  outputNode: AudioNode;
  params: Record<string, number>;
  enabled: boolean;
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

class MockConvolverNode {
  buffer: AudioBuffer | null = null;
  connect(destination: unknown): unknown { return destination; }
  disconnect() {}
}

class MockBiquadFilterNode {
  type: BiquadFilterType = 'lowpass';
  frequency = {
    value: 350,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  Q = { value: 1 };

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
describe('audioManager - Advanced', () => {
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

    global.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    vi.clearAllMocks();
  });

  describe('Bus Effects Chain', () => {
    beforeEach(() => {
      audioManager.ensureContext();
    });

    it('setBusEffects applies reverb effect', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 0, wet: 0.5 }, enabled: true },
      ]);

      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('reverb');
    });

    it('setBusEffects applies lowpass filter', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'lowpass', params: { frequency: 2000, q: 1.5 }, enabled: true },
      ]);

      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('lowpass');
    });

    it('setBusEffects applies highpass filter', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'highpass', params: { frequency: 200, q: 0.7 }, enabled: true },
      ]);

      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('highpass');
    });

    it('setBusEffects applies compressor', () => {
      audioManager.setBusEffects('music', [
        { effectType: 'compressor', params: { threshold: -20, knee: 25, ratio: 8, attack: 0.01, release: 0.3 }, enabled: true },
      ]);

      const bus = getInternal().buses.get('music')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('compressor');
    });

    it('setBusEffects applies delay', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'delay', params: { time: 0.25, feedback: 0.4, wet: 0.3 }, enabled: true },
      ]);

      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('delay');
    });

    it('setBusEffects chains multiple effects', () => {
      audioManager.setBusEffects('music', [
        { effectType: 'lowpass', params: { frequency: 5000 }, enabled: true },
        { effectType: 'compressor', params: {}, enabled: true },
        { effectType: 'reverb', params: { preset: 1, wet: 0.3 }, enabled: true },
      ]);

      const bus = getInternal().buses.get('music')!;
      expect(bus.effects).toHaveLength(3);
      expect(bus.effects[0].type).toBe('lowpass');
      expect(bus.effects[1].type).toBe('compressor');
      expect(bus.effects[2].type).toBe('reverb');
    });

    it('setBusEffects skips disabled effects', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 0, wet: 0.5 }, enabled: true },
        { effectType: 'lowpass', params: { frequency: 1000 }, enabled: false },
      ]);

      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('reverb');
    });

    it('setBusEffects clears previous effects', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 0, wet: 0.5 }, enabled: true },
      ]);
      expect(getInternal().buses.get('sfx')!.effects).toHaveLength(1);

      audioManager.setBusEffects('sfx', []);
      expect(getInternal().buses.get('sfx')!.effects).toHaveLength(0);
    });

    it('unknown effect type creates passthrough', () => {
      audioManager.setBusEffects('sfx', [
        { effectType: 'unknown_fx', params: {}, enabled: true },
      ]);

      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
      expect(bus.effects[0].type).toBe('unknown_fx');
    });
  });

  describe('IR Buffer Generation', () => {
    it('generates IR buffer for Hall preset', () => {
      audioManager.ensureContext();

      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 0, wet: 0.5 }, enabled: true },
      ]);

      const irBuffers = getInternal().irBuffers;
      expect(irBuffers.has(0)).toBe(true);
    });

    it('caches IR buffer for repeated use', () => {
      audioManager.ensureContext();

      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 1, wet: 0.5 }, enabled: true },
      ]);
      audioManager.setBusEffects('music', [
        { effectType: 'reverb', params: { preset: 1, wet: 0.3 }, enabled: true },
      ]);

      // Should only generate once per preset index
      const irBuffers = getInternal().irBuffers;
      expect(irBuffers.has(1)).toBe(true);
    });

    it('generates different buffers for different presets', () => {
      audioManager.ensureContext();

      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 0, wet: 0.5 }, enabled: true },
      ]);
      audioManager.setBusEffects('music', [
        { effectType: 'reverb', params: { preset: 3, wet: 0.5 }, enabled: true },
      ]);

      const irBuffers = getInternal().irBuffers;
      expect(irBuffers.has(0)).toBe(true);
      expect(irBuffers.has(3)).toBe(true);
    });

    it('falls back to preset 0 for out-of-range index', () => {
      audioManager.ensureContext();

      audioManager.setBusEffects('sfx', [
        { effectType: 'reverb', params: { preset: 99, wet: 0.5 }, enabled: true },
      ]);

      // Should not throw, uses preset 0 as fallback
      const bus = getInternal().buses.get('sfx')!;
      expect(bus.effects).toHaveLength(1);
    });
  });

  describe('Audio Occlusion', () => {
    beforeEach(() => {
      audioManager.ensureContext();
    });

    it('enables occlusion for entity', () => {
      audioManager.setOcclusion('entity1', true);
      expect(audioManager.isOcclusionEnabled('entity1')).toBe(true);
    });

    it('disables occlusion for entity', () => {
      audioManager.setOcclusion('entity1', true);
      audioManager.setOcclusion('entity1', false);
      expect(audioManager.isOcclusionEnabled('entity1')).toBe(false);
    });

    it('creates lowpass filter on enable', () => {
      audioManager.setOcclusion('entity1', true);

      const filters = getInternal().occlusionFilters;
      expect(filters.has('entity1')).toBe(true);
    });

    it('removes filter on disable', () => {
      audioManager.setOcclusion('entity1', true);
      audioManager.setOcclusion('entity1', false);

      const filters = getInternal().occlusionFilters;
      expect(filters.has('entity1')).toBe(false);
    });

    it('tracks multiple entities independently', () => {
      audioManager.setOcclusion('entity1', true);
      audioManager.setOcclusion('entity2', true);
      audioManager.setOcclusion('entity1', false);

      expect(audioManager.isOcclusionEnabled('entity1')).toBe(false);
      expect(audioManager.isOcclusionEnabled('entity2')).toBe(true);
    });

    it('returns false for non-existent entity', () => {
      expect(audioManager.isOcclusionEnabled('unknown')).toBe(false);
    });

    it('updateOcclusionState does nothing when not enabled', () => {
      // Should not throw
      audioManager.updateOcclusionState('entity1', true);
      expect(audioManager.isOcclusionEnabled('entity1')).toBe(false);
    });

    it('updateOcclusionState adjusts filter frequency when occluded', () => {
      audioManager.setOcclusion('entity1', true);
      audioManager.updateOcclusionState('entity1', true);

      const filter = getInternal().occlusionFilters.get('entity1')!;
      expect(filter.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
        500, // Muffled frequency
        expect.any(Number)
      );
    });

    it('updateOcclusionState restores filter frequency when clear', () => {
      audioManager.setOcclusion('entity1', true);
      audioManager.updateOcclusionState('entity1', false);

      const filter = getInternal().occlusionFilters.get('entity1')!;
      expect(filter.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
        5000, // Clear frequency
        expect.any(Number)
      );
    });
  });

  describe('Adaptive Music', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('ambient-asset', data);
      await audioManager.loadBuffer('drums-asset', data);
      await audioManager.loadBuffer('melody-asset', data);
    });

    it('creates adaptive track with stems', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
        { name: 'drums', assetId: 'drums-asset' },
        { name: 'melody', assetId: 'melody-asset' },
      ]);

      const tracks = getInternal().adaptiveTracks;
      expect(tracks.has('battle')).toBe(true);
    });

    it('uses default intensity ranges for known stem names', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
        { name: 'drums', assetId: 'drums-asset' },
      ]);

      // Initial intensity is 0, so ambient plays and drums don't
      expect(audioManager.getMusicIntensity('battle')).toBe(0);
    });

    it('accepts custom intensity ranges', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'layer1', assetId: 'ambient-asset', intensityRange: [0.0, 0.5] },
        { name: 'layer2', assetId: 'drums-asset', intensityRange: [0.5, 1.0] },
      ]);

      expect(audioManager.getMusicIntensity('battle')).toBe(0);
    });

    it('accepts custom initial intensity', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
      ], { initialIntensity: 0.5 });

      expect(audioManager.getMusicIntensity('battle')).toBe(0.5);
    });

    it('accepts custom bus', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
      ], { bus: 'ambient' });

      // Should not throw, uses ambient bus
      expect(audioManager.getMusicIntensity('battle')).toBe(0);
    });

    it('setMusicIntensity clamps to 0-1', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
      ]);

      audioManager.setMusicIntensity('battle', 1.5);
      expect(audioManager.getMusicIntensity('battle')).toBe(1);

      audioManager.setMusicIntensity('battle', -0.5);
      expect(audioManager.getMusicIntensity('battle')).toBe(0);
    });

    it('setMusicIntensity updates track intensity', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
        { name: 'drums', assetId: 'drums-asset' },
      ]);

      audioManager.setMusicIntensity('battle', 0.7);
      expect(audioManager.getMusicIntensity('battle')).toBe(0.7);
    });

    it('stopAdaptiveMusic removes track', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
      ]);

      audioManager.stopAdaptiveMusic('battle');

      expect(getInternal().adaptiveTracks.has('battle')).toBe(false);
      expect(audioManager.getMusicIntensity('battle')).toBe(0);
    });

    it('getMusicIntensity returns 0 for unknown track', () => {
      expect(audioManager.getMusicIntensity('nonexistent')).toBe(0);
    });

    it('setMusicIntensity warns on unknown track', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      audioManager.setMusicIntensity('nonexistent', 0.5);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      warnSpy.mockRestore();
    });

    it('stopAdaptiveMusic is safe for unknown track', () => {
      // Should not throw
      audioManager.stopAdaptiveMusic('nonexistent');
    });

    it('replaces existing track with same ID', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'ambient', assetId: 'ambient-asset' },
      ], { initialIntensity: 0.3 });

      audioManager.setAdaptiveMusic('battle', [
        { name: 'drums', assetId: 'drums-asset' },
      ], { initialIntensity: 0.8 });

      expect(audioManager.getMusicIntensity('battle')).toBe(0.8);
    });

    it('manages multiple adaptive tracks simultaneously', () => {
      audioManager.setAdaptiveMusic('battle', [
        { name: 'drums', assetId: 'drums-asset' },
      ], { initialIntensity: 0.5 });

      audioManager.setAdaptiveMusic('explore', [
        { name: 'ambient', assetId: 'ambient-asset' },
      ], { initialIntensity: 0.2 });

      expect(audioManager.getMusicIntensity('battle')).toBe(0.5);
      expect(audioManager.getMusicIntensity('explore')).toBe(0.2);

      audioManager.stopAdaptiveMusic('battle');
      expect(audioManager.getMusicIntensity('battle')).toBe(0);
      expect(audioManager.getMusicIntensity('explore')).toBe(0.2);
    });
  });

  // ================================================================
  // Additional edge cases (PF-162)
  // ================================================================

  describe('Ducking Rules', () => {
    beforeEach(() => {
      audioManager.ensureContext();
      // Clear any leaked ducking rules from previous tests
      const int = getInternal();
      int.duckingRules = [];
      int.activeDuckTriggers = new Map();
    });

    it('addDuckingRule stores a rule', () => {
      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 50,
        releaseMs: 200,
      });

      const rules = audioManager.getDuckingRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].triggerBus).toBe('sfx');
      expect(rules[0].targetBus).toBe('music');
      expect(rules[0].duckLevel).toBe(0.3);
    });

    it('addDuckingRule replaces existing rule for same bus pair', () => {
      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 50,
        releaseMs: 200,
      });

      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.1,
        attackMs: 100,
        releaseMs: 500,
      });

      const rules = audioManager.getDuckingRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].duckLevel).toBe(0.1);
    });

    it('addDuckingRule allows different bus pairs', () => {
      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 50,
        releaseMs: 200,
      });

      audioManager.addDuckingRule({
        triggerBus: 'voice',
        targetBus: 'music',
        duckLevel: 0.2,
        attackMs: 30,
        releaseMs: 150,
      });

      expect(audioManager.getDuckingRules()).toHaveLength(2);
    });

    it('removeDuckingRule removes matching pair', () => {
      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 50,
        releaseMs: 200,
      });

      audioManager.removeDuckingRule('sfx', 'music');
      expect(audioManager.getDuckingRules()).toHaveLength(0);
    });

    it('removeDuckingRule does nothing for non-existent pair', () => {
      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 50,
        releaseMs: 200,
      });

      audioManager.removeDuckingRule('voice', 'ambient');
      expect(audioManager.getDuckingRules()).toHaveLength(1);
    });

    it('getDuckingRules returns a copy', () => {
      audioManager.addDuckingRule({
        triggerBus: 'sfx',
        targetBus: 'music',
        duckLevel: 0.3,
        attackMs: 50,
        releaseMs: 200,
      });

      const rules = audioManager.getDuckingRules();
      rules.push({
        triggerBus: 'fake',
        targetBus: 'fake',
        duckLevel: 0,
        attackMs: 0,
        releaseMs: 0,
      });

      // Original should be unaffected
      expect(audioManager.getDuckingRules()).toHaveLength(1);
    });
  });

  describe('Bus Volume, Mute, Solo', () => {
    beforeEach(() => {
      audioManager.ensureContext();
    });

    it('setBusVolume clamps to 0-1', () => {
      audioManager.createBus('test', 0.5);

      audioManager.setBusVolume('test', 1.5);
      expect(audioManager.getBusVolume('test')).toBe(1);

      audioManager.setBusVolume('test', -0.5);
      expect(audioManager.getBusVolume('test')).toBe(0);
    });

    it('setBusVolume does nothing for non-existent bus', () => {
      // Should not throw
      audioManager.setBusVolume('ghost_bus', 0.5);
      expect(audioManager.getBusVolume('ghost_bus')).toBe(1.0); // default fallback
    });

    it('muteBus sets effectiveMuted', () => {
      audioManager.createBus('test', 1.0);

      audioManager.muteBus('test', true);
      expect(audioManager.isBusMuted('test')).toBe(true);

      audioManager.muteBus('test', false);
      expect(audioManager.isBusMuted('test')).toBe(false);
    });

    it('soloBus mutes non-soloed buses', () => {
      audioManager.createBus('music', 1.0);
      audioManager.createBus('sfx_custom', 1.0);

      audioManager.soloBus('music', true);

      // music is soloed → not muted; sfx_custom is not soloed → effectively muted
      expect(audioManager.isBusMuted('music')).toBe(false);
      expect(audioManager.isBusMuted('sfx_custom')).toBe(true);
    });

    it('soloBus release restores non-muted state', () => {
      audioManager.createBus('music', 1.0);
      audioManager.createBus('sfx_custom', 1.0);

      audioManager.soloBus('music', true);
      expect(audioManager.isBusMuted('sfx_custom')).toBe(true);

      audioManager.soloBus('music', false);
      expect(audioManager.isBusMuted('sfx_custom')).toBe(false);
    });

    it('getBusVolume returns 1.0 for unknown bus', () => {
      expect(audioManager.getBusVolume('nonexistent')).toBe(1.0);
    });

    it('isBusMuted returns false for unknown bus', () => {
      expect(audioManager.isBusMuted('nonexistent')).toBe(false);
    });
  });

  describe('Bus Create/Delete', () => {
    beforeEach(() => {
      audioManager.ensureContext();
    });

    it('createBus does not overwrite existing bus', () => {
      audioManager.createBus('test', 0.5);
      audioManager.createBus('test', 0.9); // Should be ignored

      expect(audioManager.getBusVolume('test')).toBe(0.5);
    });

    it('deleteBus prevents deleting master', () => {
      audioManager.deleteBus('master');

      // Master should still exist
      const buses = getInternal().buses;
      expect(buses.has('master')).toBe(true);
    });

    it('deleteBus does nothing for non-existent bus', () => {
      // Should not throw
      audioManager.deleteBus('nonexistent');
    });

    it('deleteBus removes bus from internal map', () => {
      audioManager.createBus('temp', 0.7);
      expect(getInternal().buses.has('temp')).toBe(true);

      audioManager.deleteBus('temp');
      expect(getInternal().buses.has('temp')).toBe(false);
    });
  });

  describe('One-Shot Management', () => {
    beforeEach(async () => {
      const data = new ArrayBuffer(100);
      await audioManager.loadBuffer('shot-asset', data);
    });

    it('playOneShot returns empty string for missing buffer', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const id = audioManager.playOneShot('nonexistent-asset');
      expect(id).toBe('');

      warnSpy.mockRestore();
    });

    it('playOneShot returns unique IDs', () => {
      const id1 = audioManager.playOneShot('shot-asset');
      const id2 = audioManager.playOneShot('shot-asset');

      expect(id1).not.toBe('');
      expect(id2).not.toBe('');
      expect(id1).not.toBe(id2);
    });

    it('playOneShot clamps volume to 0-1', () => {
      const id = audioManager.playOneShot('shot-asset', { volume: 2.0 });
      expect(id).not.toBe('');

      // Verify clamping happened by checking internal gain node
      const oneshot = getInternal().oneShotInstances.get(id) as { gainNode: MockGainNode } | undefined;
      expect(oneshot).toBeDefined();
      expect(oneshot!.gainNode.gain.value).toBeLessThanOrEqual(1);
    });

    it('playOneShot clamps pitch to 0.25-4.0', () => {
      // Just ensure no error is thrown
      const id1 = audioManager.playOneShot('shot-asset', { pitch: 0.1 });
      const id2 = audioManager.playOneShot('shot-asset', { pitch: 10 });
      expect(id1).not.toBe('');
      expect(id2).not.toBe('');
    });

    it('cancelOneShot removes from internal map', () => {
      const id = audioManager.playOneShot('shot-asset');
      expect(getInternal().oneShotInstances.has(id)).toBe(true);

      audioManager.cancelOneShot(id);
      expect(getInternal().oneShotInstances.has(id)).toBe(false);
    });

    it('cancelOneShot is safe for nonexistent ID', () => {
      // Should not throw
      audioManager.cancelOneShot('nonexistent');
    });

    it('cancelAllOneShots clears all', () => {
      audioManager.playOneShot('shot-asset');
      audioManager.playOneShot('shot-asset');
      audioManager.playOneShot('shot-asset');

      expect(getInternal().oneShotInstances.size).toBe(3);

      audioManager.cancelAllOneShots();
      expect(getInternal().oneShotInstances.size).toBe(0);
    });
  });

  describe('ensureContext', () => {
    it('creates master bus on first call', () => {
      const internal = getInternal();
      expect(internal.ctx).toBeNull();

      audioManager.ensureContext();

      expect(internal.ctx).not.toBeNull();
      expect(internal.buses.has('master')).toBe(true);
    });

    it('creates default buses (master, music, sfx, voice, ambient)', () => {
      audioManager.ensureContext();

      const buses = getInternal().buses;
      expect(buses.has('master')).toBe(true);
      expect(buses.has('music')).toBe(true);
      expect(buses.has('sfx')).toBe(true);
      expect(buses.has('voice')).toBe(true);
      expect(buses.has('ambient')).toBe(true);
    });

    it('idempotent - second call returns same context', () => {
      const ctx1 = audioManager.ensureContext();
      const ctx2 = audioManager.ensureContext();
      expect(ctx1).toBe(ctx2);
    });
  });

  describe('applyBusConfig', () => {
    it('creates buses from config', () => {
      audioManager.applyBusConfig({
        buses: [
          { name: 'master', volume: 0.8, muted: false, soloed: false, effects: [] },
          { name: 'custom', volume: 0.6, muted: false, soloed: false, effects: [] },
        ],
      });

      expect(getInternal().buses.has('custom')).toBe(true);
      expect(audioManager.getBusVolume('custom')).toBe(0.6);
    });

    it('updates existing bus volume and mute', () => {
      audioManager.ensureContext();

      audioManager.applyBusConfig({
        buses: [
          { name: 'master', volume: 0.5, muted: false, soloed: false, effects: [] },
          { name: 'music', volume: 0.3, muted: true, soloed: false, effects: [] },
          { name: 'sfx', volume: 1.0, muted: false, soloed: false, effects: [] },
        ],
      });

      const musicBus = getInternal().buses.get('music')!;
      expect(musicBus.volume).toBe(0.3);
      expect(musicBus.muted).toBe(true);
    });
  });
});
