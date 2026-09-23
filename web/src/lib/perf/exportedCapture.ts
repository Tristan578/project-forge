/**
 * Exported-runtime harness state -> {@link PerformanceReport} (#10013,
 * operation `performance.FR-3.OP-01`).
 *
 * The exported game's harness (`lib/export/perfHarnessFragment.ts`) leaves its
 * raw run in `window.__forgePerf`. A driver — the local GPU E2E capture, or an
 * evidence run — reads that object out of the page and calls
 * {@link buildExportedRunReport}, which validates it, builds the manifest
 * (exact browser version from client hints, GPU adapter, backend, cache state
 * from resource timing, fixture checksum of the scene the driver injected) and
 * produces the report with the same code as an editor capture.
 *
 * A run is refused rather than reported when it did not complete, or when the
 * engine refused the fixture scene: a measurement of an empty world must never
 * be filed under a fixture's name.
 */
import { z } from 'zod';
import {
  UNKNOWN,
  buildMeasurementManifest,
  computeSceneFixtureChecksum,
  readExactBrowserVersion,
  type CacheState,
  type Unknown,
} from '@/lib/config/measurementManifest';
import { detectCacheState, readMemoryAvailability } from './frameCapture';
import { buildPerformanceReport, type PerformanceReport, type RawFrameCapture } from './performanceReport';

const zNullableNumber = z.number().finite().nullable();

/** Runtime schema for `window.__forgePerf` as the harness leaves it. */
export const zHarnessState = z.object({
  harnessVersion: z.literal(1),
  status: z.enum(['armed', 'recording', 'collecting', 'complete', 'failed']),
  protocol: z.object({ warmupMs: z.number().int().nonnegative(), captureMs: z.number().int().positive() }),
  initStartMs: zNullableNumber,
  firstFrameMs: zNullableNumber,
  frameTimestampsMs: z.array(z.number().finite()),
  hiddenDuringCapture: z.boolean(),
  backend: z.enum(['webgpu', 'webgl2', 'unknown']),
  sceneLoad: z.object({ success: z.boolean(), error: z.string().nullable() }).nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  env: z
    .object({
      userAgent: z.string().nullable(),
      deviceMemory: zNullableNumber,
      viewport: z.object({ width: z.number(), height: z.number(), devicePixelRatio: z.number() }),
      memory: z.object({ usedJSHeapSize: z.number(), jsHeapSizeLimit: z.number() }).nullable(),
      wasmMemoryBytes: zNullableNumber,
      resources: z.array(
        z.object({ name: z.string(), transferSize: z.number(), encodedBodySize: z.number(), decodedBodySize: z.number() }),
      ),
      fullVersionList: z.array(z.object({ brand: z.string(), version: z.string() })).nullable(),
      gpu: z
        .union([
          z.object({ vendor: z.string(), architecture: z.string(), device: z.string(), description: z.string() }),
          z.object({ renderer: z.string() }),
        ])
        .nullable(),
    })
    .nullable(),
});

/** Parsed harness state. */
export type HarnessState = z.infer<typeof zHarnessState>;

/** Inputs to {@link buildExportedRunReport}. */
export interface ExportedRunInput {
  /** `window.__forgePerf`, read out of the page. */
  harness: unknown;
  /** The parsed scene the driver injected as `window.__forgeSceneData`. */
  fixtureScene: unknown;
  profileKey: string;
  /** Git SHA of the build that produced the runtime and export template. */
  buildSha: string | Unknown;
  /**
   * Cache state the driver guarantees (e.g. a fresh browser profile is cold).
   * When omitted, detected from the engine binary's resource timing.
   */
  declaredCacheState?: CacheState | Unknown;
  reportId?: string;
  now?: () => Date;
}

function gpuDescription(gpu: NonNullable<HarnessState['env']>['gpu']): string | Unknown {
  if (!gpu) return UNKNOWN;
  if ('renderer' in gpu) return gpu.renderer.trim() || UNKNOWN;
  const description = gpu.description.trim();
  if (description) return description;
  return [gpu.vendor, gpu.architecture, gpu.device].map((p) => p.trim()).filter(Boolean).join(' ') || UNKNOWN;
}

/**
 * Turn a completed exported-runtime harness run into a performance report.
 * @param input Harness state, injected scene and run identity.
 * @returns The report, or why the run cannot be reported.
 */
export async function buildExportedRunReport(
  input: ExportedRunInput,
): Promise<{ ok: true; report: PerformanceReport } | { ok: false; error: string }> {
  const parsed = zHarnessState.safeParse(input.harness);
  if (!parsed.success) {
    return { ok: false, error: `The page did not expose a valid perf harness state (was it opened with ?forgePerf=1?): ${parsed.error.issues[0]?.message ?? 'invalid'}` };
  }
  const h = parsed.data;
  if (h.status === 'failed') return { ok: false, error: `The exported game failed to start: ${h.error ?? 'unknown error'}` };
  if (h.status !== 'complete' || !h.env || !h.completedAt) {
    return { ok: false, error: `The capture has not completed (status: ${h.status}).` };
  }
  if (!h.sceneLoad?.success) {
    return { ok: false, error: `The fixture scene was not loaded by the engine: ${h.sceneLoad?.error ?? 'no load result recorded'}` };
  }

  const env = h.env;
  const fullVersionList = env.fullVersionList;
  const nav = {
    userAgent: env.userAgent ?? undefined,
    deviceMemory: env.deviceMemory ?? undefined,
    userAgentData: fullVersionList ? { getHighEntropyValues: async () => ({ fullVersionList }) } : undefined,
  };
  const manifest = buildMeasurementManifest({
    nav,
    win: { innerWidth: env.viewport.width, innerHeight: env.viewport.height, devicePixelRatio: env.viewport.devicePixelRatio },
    backend: h.backend === 'unknown' ? UNKNOWN : h.backend,
    browserVersion: await readExactBrowserVersion(nav),
    gpuDriver: gpuDescription(env.gpu),
    fixtureChecksum: computeSceneFixtureChecksum(input.fixtureScene),
    cacheState: input.declaredCacheState ?? detectCacheState(env.resources),
    buildSha: input.buildSha,
  });

  const firstInteractive =
    h.initStartMs !== null && h.firstFrameMs !== null && h.firstFrameMs >= h.initStartMs
      ? Math.round((h.firstFrameMs - h.initStartMs) * 10) / 10
      : UNKNOWN;
  const raw: RawFrameCapture = {
    captureProtocolVersion: 1,
    source: 'exported-runtime',
    protocol: h.protocol,
    frameTimestampsMs: h.frameTimestampsMs,
    firstInteractiveMs: firstInteractive,
    firstInteractiveBasis: 'exported-init-to-first-frame',
    hiddenDuringCapture: h.hiddenDuringCapture,
    memory: readMemoryAvailability(
      env.memory ? { memory: env.memory } : {},
      env.wasmMemoryBytes !== null ? { buffer: { byteLength: env.wasmMemoryBytes } } : undefined,
    ),
    startedAt: h.startedAt ?? h.completedAt,
    completedAt: h.completedAt,
  };
  return {
    ok: true,
    report: buildPerformanceReport({ raw, manifest, profileKey: input.profileKey, reportId: input.reportId, now: input.now }),
  };
}
