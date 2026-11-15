/**
 * Frame-capture primitives for the exported-fixture harness (#9904 / #10013,
 * operation performance.FR-3.OP-01).
 *
 * These pin the arithmetic both capture paths (the exported runtime and the
 * editor) feed into the report: when warm-up ends, which frame intervals land
 * in the 60-second window, and what an aggregate says when there is too little
 * to aggregate. The recurring rule is the manifest's: a value the capture could
 * not establish is `'unknown'`, never `0`.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateFrameTimes,
  createFrameRecorder,
  detectCacheState,
  readMemoryAvailability,
  sliceCaptureWindow,
  DEFAULT_CAPTURE_PROTOCOL,
  MIN_FRAME_SAMPLES,
} from '../frameCapture';
import { UNKNOWN } from '@/lib/config/measurementManifest';

/** Timestamps at a fixed interval, starting at `start`. */
function steady(count: number, intervalMs: number, start = 1000): number[] {
  return Array.from({ length: count }, (_, i) => start + i * intervalMs);
}

describe('DEFAULT_CAPTURE_PROTOCOL', () => {
  it('is the issue protocol: 10 s warm-up, then a 60 s capture', () => {
    expect(DEFAULT_CAPTURE_PROTOCOL).toEqual({ warmupMs: 10_000, captureMs: 60_000 });
  });
});

describe('createFrameRecorder', () => {
  it('walks warm-up -> capturing -> complete on frame timestamps, not wall clock', () => {
    const recorder = createFrameRecorder({ warmupMs: 100, captureMs: 200 });
    expect(recorder.phase()).toBe('waiting');
    expect(recorder.onFrame(1000)).toBe('warmup');
    expect(recorder.onFrame(1050)).toBe('warmup');
    expect(recorder.onFrame(1100)).toBe('capturing');
    expect(recorder.onFrame(1250)).toBe('capturing');
    expect(recorder.onFrame(1300)).toBe('complete');
    // A frame after completion is ignored rather than extending the window.
    expect(recorder.onFrame(1400)).toBe('complete');
    expect(recorder.timestamps()).toEqual([1000, 1050, 1100, 1250, 1300]);
  });

  it('reports progress across the whole warm-up + capture span', () => {
    const recorder = createFrameRecorder({ warmupMs: 100, captureMs: 300 });
    expect(recorder.progress()).toBe(0);
    recorder.onFrame(0);
    recorder.onFrame(200);
    expect(recorder.progress()).toBeCloseTo(0.5);
    recorder.onFrame(400);
    expect(recorder.progress()).toBe(1);
  });

  it('drops a timestamp that goes backwards instead of recording a negative interval', () => {
    const recorder = createFrameRecorder({ warmupMs: 0, captureMs: 1000 });
    recorder.onFrame(100);
    recorder.onFrame(90);
    recorder.onFrame(120);
    expect(recorder.timestamps()).toEqual([100, 120]);
  });

  it('ignores non-finite timestamps', () => {
    const recorder = createFrameRecorder({ warmupMs: 0, captureMs: 1000 });
    recorder.onFrame(Number.NaN);
    recorder.onFrame(Number.POSITIVE_INFINITY);
    expect(recorder.phase()).toBe('waiting');
    expect(recorder.timestamps()).toEqual([]);
  });
});

describe('sliceCaptureWindow', () => {
  it('keeps only the intervals that start after warm-up and end inside the capture window', () => {
    // First frame at 1000; warm-up ends at 1100; capture ends at 1300.
    const samples = sliceCaptureWindow([1000, 1050, 1100, 1110, 1130, 1300, 1310], {
      warmupMs: 100,
      captureMs: 200,
    });
    // 1100->1110, 1110->1130, 1130->1300. 1050->1100 is warm-up; 1300->1310 is past the window.
    expect(samples).toEqual([10, 20, 170]);
  });

  it('returns no samples when a stall jumps over the whole capture window', () => {
    expect(sliceCaptureWindow([0, 50, 5000], { warmupMs: 100, captureMs: 200 })).toEqual([]);
  });

  it('returns no samples for an empty or single-frame recording', () => {
    expect(sliceCaptureWindow([], DEFAULT_CAPTURE_PROTOCOL)).toEqual([]);
    expect(sliceCaptureWindow([5], DEFAULT_CAPTURE_PROTOCOL)).toEqual([]);
  });
});

describe('aggregateFrameTimes', () => {
  it('computes p50/p95/p99 with the benchmark percentile interpolation', () => {
    // 1..200 ms: p50 = 100.5, p95 = 190.05, p99 = 198.01 under linear interpolation.
    const samples = Array.from({ length: 200 }, (_, i) => i + 1);
    const stats = aggregateFrameTimes(samples);
    expect(stats.status).toBe('measured');
    expect(stats.sampleCount).toBe(200);
    expect(stats.p50Ms).toBeCloseTo(100.5, 6);
    expect(stats.p95Ms).toBeCloseTo(190.05, 6);
    expect(stats.p99Ms).toBeCloseTo(198.01, 6);
    expect(stats.minMs).toBe(1);
    expect(stats.maxMs).toBe(200);
    expect(stats.meanMs).toBeCloseTo(100.5, 6);
  });

  it('is order-independent (sorts its own copy and leaves the input alone)', () => {
    const samples = [30, 10, 20, ...Array.from({ length: 200 }, () => 16)];
    const snapshot = [...samples];
    const stats = aggregateFrameTimes(samples);
    expect(samples).toEqual(snapshot);
    expect(stats.maxMs).toBe(30);
    expect(stats.minMs).toBe(10);
  });

  it('reports every statistic as unknown — never 0 — below the minimum sample count', () => {
    const stats = aggregateFrameTimes(Array.from({ length: MIN_FRAME_SAMPLES - 1 }, () => 16.7));
    expect(stats.status).toBe('insufficient_sample');
    expect(stats.sampleCount).toBe(MIN_FRAME_SAMPLES - 1);
    for (const key of ['p50Ms', 'p95Ms', 'p99Ms', 'meanMs', 'minMs', 'maxMs'] as const) {
      expect(stats[key]).toBe(UNKNOWN);
    }
  });

  it('treats an empty capture as unknown rather than the 0 the bare percentile helper returns', () => {
    const stats = aggregateFrameTimes([]);
    expect(stats.p95Ms).toBe(UNKNOWN);
    expect(stats.sampleCount).toBe(0);
  });

  it('discards non-finite and negative samples before counting', () => {
    const good = Array.from({ length: MIN_FRAME_SAMPLES }, () => 10);
    const stats = aggregateFrameTimes([...good, Number.NaN, -5, Number.POSITIVE_INFINITY]);
    expect(stats.sampleCount).toBe(MIN_FRAME_SAMPLES);
    expect(stats.p99Ms).toBe(10);
  });

  it('works end to end from recorder timestamps', () => {
    const protocol = { warmupMs: 1000, captureMs: 5000 };
    const recorder = createFrameRecorder(protocol);
    for (const ts of steady(400, 16)) recorder.onFrame(ts);
    const stats = aggregateFrameTimes(sliceCaptureWindow(recorder.timestamps(), protocol));
    expect(stats.status).toBe('measured');
    expect(stats.p95Ms).toBe(16);
    // 5000 ms / 16 ms per frame is 312.5: 312 whole intervals fit the window.
    expect(stats.sampleCount).toBe(312);
  });
});

describe('detectCacheState', () => {
  const wasm = 'https://cdn.example/engine-pkg-webgpu-runtime/forge_engine_bg.wasm';

  it('reads a WASM body that crossed the network as a cold cache', () => {
    expect(
      detectCacheState([{ name: wasm, transferSize: 26_000_300, encodedBodySize: 26_000_000, decodedBodySize: 26_000_000 }]),
    ).toBe('cold');
  });

  it('reads a zero-transfer (memory/disk cache) body as warm', () => {
    expect(
      detectCacheState([{ name: wasm, transferSize: 0, encodedBodySize: 26_000_000, decodedBodySize: 26_000_000 }]),
    ).toBe('warm');
  });

  it('reads a 304 revalidation (headers only on the wire) as warm', () => {
    expect(
      detectCacheState([{ name: wasm, transferSize: 300, encodedBodySize: 26_000_000, decodedBodySize: 26_000_000 }]),
    ).toBe('warm');
  });

  it('is unknown when the entry hides its sizes (cross-origin without Timing-Allow-Origin)', () => {
    // A TAO-restricted entry reports 0 for all three sizes: that is "cannot tell", not "cached".
    expect(detectCacheState([{ name: wasm, transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 }])).toBe(UNKNOWN);
  });

  it('is unknown when no engine WASM was fetched at all (embedded single-HTML export)', () => {
    expect(detectCacheState([{ name: 'https://x/app.js', transferSize: 10, encodedBodySize: 10, decodedBodySize: 10 }])).toBe(UNKNOWN);
    expect(detectCacheState([])).toBe(UNKNOWN);
  });

  it('calls a mixed load cold: any engine body that came over the network', () => {
    expect(
      detectCacheState([
        { name: wasm, transferSize: 0, encodedBodySize: 5, decodedBodySize: 5 },
        { name: wasm.replace('webgpu', 'webgl2'), transferSize: 900, encodedBodySize: 800, decodedBodySize: 800 },
      ]),
    ).toBe('cold');
  });
});

describe('readMemoryAvailability', () => {
  it('reports the JS heap and WASM linear memory in MB when the browser exposes them', () => {
    const memory = readMemoryAvailability(
      { memory: { usedJSHeapSize: 50 * 1024 * 1024, jsHeapSizeLimit: 4096 * 1024 * 1024 } },
      { buffer: { byteLength: 256 * 1024 * 1024 } },
    );
    expect(memory).toEqual({
      jsHeapUsedMb: 50,
      jsHeapLimitMb: 4096,
      wasmLinearMemoryMb: 256,
      jsHeapSource: 'performance.memory',
      wasmMemorySource: 'wasm-linear-memory',
    });
  });

  it('reports unsupported memory APIs as unknown, never 0 MB', () => {
    const memory = readMemoryAvailability({}, undefined);
    expect(memory.jsHeapUsedMb).toBe(UNKNOWN);
    expect(memory.jsHeapLimitMb).toBe(UNKNOWN);
    expect(memory.wasmLinearMemoryMb).toBe(UNKNOWN);
    expect(memory.jsHeapSource).toBe('unavailable');
    expect(memory.wasmMemorySource).toBe('unavailable');
  });

  it('rejects a non-finite or non-positive heap reading as unknown', () => {
    const memory = readMemoryAvailability({ memory: { usedJSHeapSize: Number.NaN, jsHeapSizeLimit: 0 } }, { buffer: { byteLength: 0 } });
    expect(memory.jsHeapUsedMb).toBe(UNKNOWN);
    expect(memory.jsHeapLimitMb).toBe(UNKNOWN);
    expect(memory.wasmLinearMemoryMb).toBe(UNKNOWN);
  });
});
