/**
 * Frame-capture primitives shared by the two performance-capture paths.
 *
 * Operation `performance.FR-3.OP-01` (#9904 / #10013). A capture is a warm-up
 * followed by a fixed capture window (10 s + 60 s by default). Both the
 * exported-game harness (`lib/export/perfHarnessFragment.ts`, which records raw
 * `requestAnimationFrame` timestamps in plain JS) and the editor capture
 * (`lib/perf/editorCapture.ts`, which uses {@link createFrameRecorder}) hand
 * their raw timestamps to {@link sliceCaptureWindow} and
 * {@link aggregateFrameTimes}, so the windowing and percentile arithmetic has
 * exactly one implementation.
 *
 * A frame-time sample is the interval between two consecutive animation
 * frames: what the player sees, quantised to the display refresh. It is not
 * CPU or GPU work time (GPU timers stay #9880).
 *
 * Every figure the capture could not establish is {@link UNKNOWN}: an empty or
 * too-small window, a memory API the browser does not ship, a cache state the
 * resource timing hides. None of them may read as `0`.
 */
import { UNKNOWN, type Unknown, type CacheState } from '@/lib/config/measurementManifest';
import { percentile } from './benchmark';

/** Warm-up and capture durations for one run, in milliseconds. */
export interface CaptureProtocol {
  warmupMs: number;
  captureMs: number;
}

/** The issue's protocol: a 60-second capture after a 10-second warm-up. */
export const DEFAULT_CAPTURE_PROTOCOL: Readonly<CaptureProtocol> = Object.freeze({
  warmupMs: 10_000,
  captureMs: 60_000,
});

/**
 * Fewest frame intervals a percentile is reported from. p99 of fewer than 100
 * samples is just the maximum, so below this every statistic is unknown.
 */
export const MIN_FRAME_SAMPLES = 100;

/** Where a recorder is in its warm-up / capture lifecycle. */
export type FrameRecorderPhase = 'waiting' | 'warmup' | 'capturing' | 'complete';

/** Accumulates animation-frame timestamps until the capture window closes. */
export interface FrameRecorder {
  /** Record one frame timestamp (ms, monotonic clock); returns the new phase. */
  onFrame(timestampMs: number): FrameRecorderPhase;
  /** Current phase. */
  phase(): FrameRecorderPhase;
  /** Fraction of warm-up + capture elapsed, clamped to [0, 1]. */
  progress(): number;
  /** Every accepted timestamp, first frame to the one that closed the window. */
  timestamps(): readonly number[];
}

/**
 * Create a recorder for one run. Time is measured from the FIRST recorded
 * frame, not from when the recorder was created, so a slow first frame cannot
 * eat into the warm-up.
 * @param protocol Warm-up and capture durations.
 * @returns A recorder that stops accepting frames once the window closes.
 */
export function createFrameRecorder(protocol: CaptureProtocol): FrameRecorder {
  const total = protocol.warmupMs + protocol.captureMs;
  const stamps: number[] = [];
  let current: FrameRecorderPhase = 'waiting';

  const phaseAt = (ts: number): FrameRecorderPhase => {
    const elapsed = ts - stamps[0];
    if (elapsed >= total) return 'complete';
    return elapsed >= protocol.warmupMs ? 'capturing' : 'warmup';
  };

  return {
    onFrame(timestampMs) {
      if (current === 'complete' || !Number.isFinite(timestampMs)) return current;
      const last = stamps[stamps.length - 1];
      // A clock that steps backwards would produce a negative interval; drop it.
      if (last !== undefined && timestampMs < last) return current;
      stamps.push(timestampMs);
      current = phaseAt(timestampMs);
      return current;
    },
    phase: () => current,
    progress() {
      if (stamps.length === 0 || total <= 0) return current === 'complete' ? 1 : 0;
      return Math.min(1, Math.max(0, (stamps[stamps.length - 1] - stamps[0]) / total));
    },
    timestamps: () => stamps,
  };
}

/**
 * Frame-time samples inside the capture window.
 *
 * The window opens `warmupMs` after the first timestamp and closes `captureMs`
 * later. An interval counts only when it starts at or after the opening and
 * ends at or before the close, so warm-up frames and the frame that overran
 * the window never leak in. A stall that jumps across the whole window yields
 * no samples — which aggregates to unknown, not to a fast frame.
 * @param timestamps Monotonic frame timestamps in milliseconds.
 * @param protocol Warm-up and capture durations.
 * @returns Intervals in milliseconds, in capture order.
 */
export function sliceCaptureWindow(timestamps: readonly number[], protocol: CaptureProtocol): number[] {
  if (timestamps.length < 2) return [];
  const start = timestamps[0] + protocol.warmupMs;
  const end = start + protocol.captureMs;
  const samples: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const from = timestamps[i - 1];
    const to = timestamps[i];
    if (from >= start && to <= end) samples.push(to - from);
  }
  return samples;
}

/** Aggregated frame-time statistics for one capture window. */
export interface FrameTimeStats {
  /** `measured` only when at least {@link MIN_FRAME_SAMPLES} intervals exist. */
  status: 'measured' | 'insufficient_sample';
  /** Valid intervals the statistics were computed from. */
  sampleCount: number;
  p50Ms: number | Unknown;
  p95Ms: number | Unknown;
  p99Ms: number | Unknown;
  meanMs: number | Unknown;
  minMs: number | Unknown;
  maxMs: number | Unknown;
}

/**
 * Percentiles and range of a set of frame-time samples.
 *
 * Reuses `benchmark.ts`'s `percentile` (linear interpolation between ranks) so
 * the harness and the product benchmarks agree on what "p95" means. Non-finite
 * and negative samples are discarded first. Below {@link MIN_FRAME_SAMPLES}
 * every statistic is {@link UNKNOWN}.
 * @param samples Frame intervals in milliseconds; not mutated.
 * @returns Statistics with an explicit measured / insufficient-sample status.
 */
export function aggregateFrameTimes(samples: readonly number[]): FrameTimeStats {
  const valid = samples.filter((s) => Number.isFinite(s) && s >= 0);
  if (valid.length < MIN_FRAME_SAMPLES) {
    return {
      status: 'insufficient_sample',
      sampleCount: valid.length,
      p50Ms: UNKNOWN,
      p95Ms: UNKNOWN,
      p99Ms: UNKNOWN,
      meanMs: UNKNOWN,
      minMs: UNKNOWN,
      maxMs: UNKNOWN,
    };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, s) => acc + s, 0);
  return {
    status: 'measured',
    sampleCount: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    meanMs: sum / sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/** The resource-timing fields {@link detectCacheState} reads. */
export interface ResourceTimingLike {
  name: string;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}

/** Engine binaries whose fetch decides whether a run started cold. */
const ENGINE_WASM_RE = /forge_engine_bg\.wasm/;

/**
 * Infer whether the engine binary came from the HTTP cache.
 *
 * - `decodedBodySize === 0` means the entry hides its sizes (a cross-origin
 *   fetch without `Timing-Allow-Origin`), so it says nothing: skip it.
 * - `transferSize < encodedBodySize` means the body did not cross the wire —
 *   a memory/disk-cache hit (0) or a 304 revalidation (headers only): warm.
 * - Otherwise the body was downloaded: cold. One cold engine fetch makes the
 *   whole run cold.
 *
 * With no readable engine fetch (an embedded single-HTML export, or no entries)
 * the answer is {@link UNKNOWN}; callers may still declare the state explicitly.
 * @param entries `performance.getEntriesByType('resource')` or an equivalent.
 * @returns `'cold'`, `'warm'` or unknown.
 */
export function detectCacheState(entries: readonly ResourceTimingLike[]): CacheState | Unknown {
  let sawWarm = false;
  for (const entry of entries) {
    if (!ENGINE_WASM_RE.test(entry.name)) continue;
    if (!(entry.decodedBodySize > 0)) continue;
    if (entry.transferSize < entry.encodedBodySize) {
      sawWarm = true;
    } else {
      return 'cold';
    }
  }
  return sawWarm ? 'warm' : UNKNOWN;
}

/** Which memory figures this browser exposed for a run, in MB. */
export interface MemoryAvailability {
  /** `performance.memory.usedJSHeapSize` (Chromium only), or unknown. */
  jsHeapUsedMb: number | Unknown;
  /** `performance.memory.jsHeapSizeLimit` (Chromium only), or unknown. */
  jsHeapLimitMb: number | Unknown;
  /** Size of the engine's WebAssembly linear memory, or unknown. */
  wasmLinearMemoryMb: number | Unknown;
  jsHeapSource: 'performance.memory' | 'unavailable';
  wasmMemorySource: 'wasm-linear-memory' | 'unavailable';
}

/** Minimal `performance` surface for the non-standard Chromium memory API. */
export interface PerformanceMemoryLike {
  memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
}

/** Minimal `WebAssembly.Memory` surface. */
export interface WasmMemoryLike {
  buffer: { byteLength: number };
}

const BYTES_PER_MB = 1024 * 1024;

function positiveMb(bytes: number | undefined): number | Unknown {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0
    ? Math.round((bytes / BYTES_PER_MB) * 10) / 10
    : UNKNOWN;
}

/**
 * Read the memory figures the browser exposes. `performance.memory` exists only
 * in Chromium; Firefox and Safari report it as unknown rather than 0 MB, which
 * is the defect the profiler's old `: 0` fallback had.
 * @param perf `performance`, or a test double.
 * @param wasmMemory The engine module's `memory` export, when known.
 * @returns Memory figures with the source of each.
 */
export function readMemoryAvailability(
  perf: PerformanceMemoryLike | undefined,
  wasmMemory: WasmMemoryLike | undefined,
): MemoryAvailability {
  const jsHeapUsedMb = positiveMb(perf?.memory?.usedJSHeapSize);
  const jsHeapLimitMb = positiveMb(perf?.memory?.jsHeapSizeLimit);
  const wasmLinearMemoryMb = positiveMb(wasmMemory?.buffer?.byteLength);
  return {
    jsHeapUsedMb,
    jsHeapLimitMb,
    wasmLinearMemoryMb,
    jsHeapSource: jsHeapUsedMb === UNKNOWN ? 'unavailable' : 'performance.memory',
    wasmMemorySource: wasmLinearMemoryMb === UNKNOWN ? 'unavailable' : 'wasm-linear-memory',
  };
}
