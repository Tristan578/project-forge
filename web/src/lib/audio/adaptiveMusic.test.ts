import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdaptiveMusicManager } from './adaptiveMusic';

// Mock AudioContext and related Web Audio API
class MockGainNode {
  public gain = {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };

  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  destination = {};
  createGain = vi.fn(() => new MockGainNode());
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode());
}

function createMockAudioBuffer(duration = 10): AudioBuffer {
  return {
    duration,
    length: 44100 * duration,
    numberOfChannels: 2,
    sampleRate: 44100,
  } as AudioBuffer;
}

describe('adaptiveMusic', () => {
  let ctx: MockAudioContext;
  let manager: AdaptiveMusicManager;

  beforeEach(() => {
    ctx = new MockAudioContext();
    manager = new AdaptiveMusicManager(ctx as unknown as AudioContext);
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates a manager instance', () => {
      expect(manager).toBeInstanceOf(AdaptiveMusicManager);
      expect(manager.intensity).toBe(0);
      expect(manager.bpm).toBe(120);
    });
  });

  describe('loadStemSet', () => {
    it('loads stems and creates gain nodes', () => {
      const stems = {
        pad: createMockAudioBuffer(),
        bass: createMockAudioBuffer(),
        melody: createMockAudioBuffer(),
        drums: createMockAudioBuffer(),
      };

      manager.loadStemSet(stems);

      expect(ctx.createGain).toHaveBeenCalledTimes(4);
    });

    it('connects gain nodes to destination', () => {
      const stems = {
        pad: createMockAudioBuffer(),
      };

      manager.loadStemSet(stems);

      const gainNode = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(gainNode.connect).toHaveBeenCalledWith(ctx.destination);
    });

    it('starts stems muted', () => {
      const stems = {
        pad: createMockAudioBuffer(),
      };

      manager.loadStemSet(stems);

      const gainNode = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime);
    });

    it('stops playback when loading new stems', () => {
      const stems = {
        pad: createMockAudioBuffer(),
      };

      manager.loadStemSet(stems);
      manager.play();

      const firstSource = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSourceNode;

      manager.loadStemSet(stems);

      expect(firstSource.stop).toHaveBeenCalled();
    });
  });

  describe('setIntensity', () => {
    beforeEach(() => {
      const stems = {
        pad: createMockAudioBuffer(),
        bass: createMockAudioBuffer(),
        melody: createMockAudioBuffer(),
        drums: createMockAudioBuffer(),
      };
      manager.loadStemSet(stems);
    });

    it('clamps intensity to 0-1 range', () => {
      manager.setIntensity(1.5);
      expect(manager.intensity).toBe(1);

      manager.setIntensity(-0.5);
      expect(manager.intensity).toBe(0);
    });

    it('sets only pad at intensity 0.1', () => {
      manager.setIntensity(0.1);

      const padGain = ctx.createGain.mock.results[0].value as MockGainNode;
      const bassGain = ctx.createGain.mock.results[1].value as MockGainNode;

      expect(padGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        1,
        expect.any(Number)
      );
      expect(bassGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        0,
        expect.any(Number)
      );
    });

    it('sets pad + bass at intensity 0.4', () => {
      manager.setIntensity(0.4);

      const padGain = ctx.createGain.mock.results[0].value as MockGainNode;
      const bassGain = ctx.createGain.mock.results[1].value as MockGainNode;
      const melodyGain = ctx.createGain.mock.results[2].value as MockGainNode;

      expect(padGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
      expect(bassGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
      expect(melodyGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    it('sets pad + bass + melody at intensity 0.6', () => {
      manager.setIntensity(0.6);

      const melodyGain = ctx.createGain.mock.results[2].value as MockGainNode;
      const drumsGain = ctx.createGain.mock.results[3].value as MockGainNode;

      expect(melodyGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
      expect(drumsGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    it('sets full mix at intensity 0.9', () => {
      manager.setIntensity(0.9);

      const drumsGain = ctx.createGain.mock.results[3].value as MockGainNode;
      expect(drumsGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it('uses smooth 500ms ramp transition', () => {
      ctx.currentTime = 5;
      manager.setIntensity(0.5);

      const padGain = ctx.createGain.mock.results[0].value as MockGainNode;
      expect(padGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.5);
    });
  });

  describe('setBPM', () => {
    it('updates BPM value', () => {
      manager.setBPM(140);
      expect(manager.bpm).toBe(140);

      manager.setBPM(80);
      expect(manager.bpm).toBe(80);
    });
  });

  describe('play', () => {
    beforeEach(() => {
      const stems = {
        pad: createMockAudioBuffer(),
        bass: createMockAudioBuffer(),
      };
      manager.loadStemSet(stems);
    });

    it('creates buffer sources for all stems', () => {
      manager.play();
      expect(ctx.createBufferSource).toHaveBeenCalledTimes(2);
    });

    it('sets loop to true on all sources', () => {
      manager.play();

      const padSource = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSourceNode;
      const bassSource = ctx.createBufferSource.mock.results[1].value as MockAudioBufferSourceNode;

      expect(padSource.loop).toBe(true);
      expect(bassSource.loop).toBe(true);
    });

    it('connects sources to gain nodes', () => {
      manager.play();

      const padSource = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSourceNode;
      const padGain = ctx.createGain.mock.results[0].value as MockGainNode;

      expect(padSource.connect).toHaveBeenCalledWith(padGain);
    });

    it('starts all sources', () => {
      manager.play();

      const padSource = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSourceNode;
      const bassSource = ctx.createBufferSource.mock.results[1].value as MockAudioBufferSourceNode;

      expect(padSource.start).toHaveBeenCalledWith(0);
      expect(bassSource.start).toHaveBeenCalledWith(0);
    });

    it('does nothing if already playing', () => {
      manager.play();
      const firstCallCount = ctx.createBufferSource.mock.calls.length;

      manager.play();
      const secondCallCount = ctx.createBufferSource.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      const stems = {
        pad: createMockAudioBuffer(),
        bass: createMockAudioBuffer(),
      };
      manager.loadStemSet(stems);
    });

    it('stops all sources', () => {
      manager.play();

      const padSource = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSourceNode;
      const bassSource = ctx.createBufferSource.mock.results[1].value as MockAudioBufferSourceNode;

      manager.stop();

      expect(padSource.stop).toHaveBeenCalled();
      expect(bassSource.stop).toHaveBeenCalled();
    });

    it('disconnects all sources', () => {
      manager.play();

      const padSource = ctx.createBufferSource.mock.results[0].value as MockAudioBufferSourceNode;

      manager.stop();

      expect(padSource.disconnect).toHaveBeenCalled();
    });

    it('does nothing if not playing', () => {
      manager.stop();
      expect(ctx.createBufferSource).not.toHaveBeenCalled();
    });
  });

  describe('setSegments', () => {
    it('sets music segments', () => {
      const segments = [
        { name: 'intro', startTime: 0, duration: 8 },
        { name: 'main', startTime: 8, duration: 32 },
        { name: 'ending', startTime: 40, duration: 8 },
      ];

      manager.setSegments(segments);
      expect(manager.getCurrentSegment()).toBe('intro');
    });
  });

  describe('transitionToSegment', () => {
    beforeEach(() => {
      const stems = { pad: createMockAudioBuffer() };
      manager.loadStemSet(stems);

      manager.setSegments([
        { name: 'intro', startTime: 0, duration: 8 },
        { name: 'main', startTime: 8, duration: 32 },
      ]);
    });

    it('transitions to a valid segment', () => {
      manager.transitionToSegment('main', false);
      expect(manager.getCurrentSegment()).toBe('main');
    });

    it('warns when transitioning to invalid segment', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      manager.transitionToSegment('nonexistent', false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Segment "nonexistent" not found')
      );
      warnSpy.mockRestore();
    });

    it('uses quantized transition by default', () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      manager.play();
      manager.transitionToSegment('main');

      expect(setTimeoutSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('immediate transition when quantized is false', () => {
      manager.play();
      manager.transitionToSegment('main', false);
      expect(manager.getCurrentSegment()).toBe('main');
    });
  });

  describe('crossfade', () => {
    beforeEach(() => {
      const stems = { pad: createMockAudioBuffer() };
      manager.loadStemSet(stems);
      manager.play();
    });

    it('schedules crossfade on next beat', () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      ctx.currentTime = 0;
      manager.setBPM(120);
      manager.crossfade(1);

      expect(setTimeoutSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('getCurrentSegment', () => {
    it('returns current segment name', () => {
      manager.setSegments([{ name: 'intro', startTime: 0, duration: 8 }]);
      expect(manager.getCurrentSegment()).toBe('intro');
    });

    it('updates after transition', () => {
      manager.setSegments([
        { name: 'intro', startTime: 0, duration: 8 },
        { name: 'main', startTime: 8, duration: 32 },
      ]);

      manager.transitionToSegment('main', false);
      expect(manager.getCurrentSegment()).toBe('main');
    });
  });

  describe('intensity getter', () => {
    it('returns current intensity value', () => {
      const stems = { pad: createMockAudioBuffer() };
      manager.loadStemSet(stems);

      manager.setIntensity(0.7);
      expect(manager.intensity).toBe(0.7);
    });
  });

  describe('bpm getter', () => {
    it('returns current BPM value', () => {
      manager.setBPM(140);
      expect(manager.bpm).toBe(140);
    });
  });
});
