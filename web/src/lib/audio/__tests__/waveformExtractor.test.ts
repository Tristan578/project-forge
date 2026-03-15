import { describe, it, expect, vi } from 'vitest';
import { extractWaveform, extractWaveformFromUrl } from '../waveformExtractor';

// ---------------------------------------------------------------------------
// Helpers — build mock AudioBuffers without a real browser context
// ---------------------------------------------------------------------------

function makeMonoBuffer(samples: Float32Array): AudioBuffer {
  return {
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: 44100,
    duration: samples.length / 44100,
    getChannelData: (channel: number) => {
      if (channel !== 0) throw new Error('Channel out of range');
      return samples;
    },
    copyFromChannel: () => { /* not needed */ },
    copyToChannel: () => { /* not needed */ },
  } as unknown as AudioBuffer;
}

function makeStereoBuffer(left: Float32Array, right: Float32Array): AudioBuffer {
  return {
    length: left.length,
    numberOfChannels: 2,
    sampleRate: 44100,
    duration: left.length / 44100,
    getChannelData: (channel: number) => {
      if (channel === 0) return left;
      if (channel === 1) return right;
      throw new Error('Channel out of range');
    },
    copyFromChannel: () => { /* not needed */ },
    copyToChannel: () => { /* not needed */ },
  } as unknown as AudioBuffer;
}

// ---------------------------------------------------------------------------
// extractWaveform
// ---------------------------------------------------------------------------

describe('extractWaveform', () => {
  it('returns the requested sample count for a mono buffer', () => {
    const samples = new Float32Array(44100).fill(0.5);
    const buf = makeMonoBuffer(samples);

    const result = extractWaveform(buf, 200);

    expect(result).toHaveLength(200);
  });

  it('uses a default of 200 samples when sampleCount is omitted', () => {
    const samples = new Float32Array(44100).fill(0.3);
    const buf = makeMonoBuffer(samples);

    expect(extractWaveform(buf)).toHaveLength(200);
  });

  it('returns an empty array for a zero-length buffer', () => {
    const buf = makeMonoBuffer(new Float32Array(0));

    expect(extractWaveform(buf, 200)).toEqual([]);
  });

  it('all values are in the range [0, 1]', () => {
    // Use a buffer with varying amplitudes to exercise normalization
    const samples = new Float32Array(44100);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin(i / 100) * (0.1 + (i / samples.length) * 0.9);
    }
    const buf = makeMonoBuffer(samples);

    const result = extractWaveform(buf, 200);

    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('peak sample is normalized to 1.0', () => {
    // Single non-silent bucket so the maximum is well-defined
    const samples = new Float32Array(200);
    samples[100] = 0.8; // only non-zero sample
    const buf = makeMonoBuffer(samples);

    const result = extractWaveform(buf, 200);

    expect(Math.max(...result)).toBeCloseTo(1.0, 5);
  });

  it('returns all-zero array for a silent buffer', () => {
    const buf = makeMonoBuffer(new Float32Array(44100)); // all zeros

    const result = extractWaveform(buf, 200);

    expect(result).toHaveLength(200);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('averages stereo channels', () => {
    // Left channel: constant 1.0, right channel: constant 0.0
    // Expected mean: 0.5 everywhere, normalized to 1.0
    const left = new Float32Array(44100).fill(1.0);
    const right = new Float32Array(44100).fill(0.0);
    const buf = makeStereoBuffer(left, right);

    const result = extractWaveform(buf, 100);

    // All buckets should be identical (constant signal)
    const [first, ...rest] = result;
    for (const v of rest) {
      expect(v).toBeCloseTo(first, 5);
    }

    // Since both channels contribute equally, the normalized peak must be 1.0
    expect(first).toBeCloseTo(1.0, 5);
  });

  it('stereo averaging: equal left and right channels give same result as mono', () => {
    const samples = new Float32Array(44100);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.abs(Math.sin(i / 50));
    }
    const mono = makeMonoBuffer(samples);
    const stereo = makeStereoBuffer(samples, samples);

    const monoResult = extractWaveform(mono, 50);
    const stereoResult = extractWaveform(stereo, 50);

    for (let i = 0; i < 50; i++) {
      expect(stereoResult[i]).toBeCloseTo(monoResult[i], 5);
    }
  });
});

// ---------------------------------------------------------------------------
// extractWaveformFromUrl
// ---------------------------------------------------------------------------

describe('extractWaveformFromUrl', () => {
  it('fetches, decodes, and returns a normalized waveform', async () => {
    const samples = new Float32Array(44100).fill(0.5);
    const mockBuffer = makeMonoBuffer(samples);

    const mockCtx = {
      decodeAudioData: (_ab: ArrayBuffer) => Promise.resolve(mockBuffer),
    } as unknown as AudioContext;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);

    const result = await extractWaveformFromUrl('http://example.com/sound.mp3', mockCtx, 100);

    expect(fetchSpy).toHaveBeenCalledWith('http://example.com/sound.mp3');
    expect(result).toHaveLength(100);
    expect(result.every(v => v >= 0 && v <= 1)).toBe(true);

    fetchSpy.mockRestore();
  });

  it('throws when the HTTP response is not ok', async () => {
    const mockCtx = {} as AudioContext;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(
      extractWaveformFromUrl('http://example.com/missing.mp3', mockCtx),
    ).rejects.toThrow('HTTP 404');

    fetchSpy.mockRestore();
  });
});
