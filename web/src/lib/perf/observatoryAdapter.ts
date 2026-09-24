/**
 * Performance report -> Forge Observatory evidence (#9751), for #9904's
 * "capture the evidence schema required by #9751 via an adapter".
 *
 * A fixture run becomes ONE `latency` observation:
 *  - each captured frame is one eligible operation, and a frame at or under
 *    the profile's frame budget is "within budget", so the Observatory's
 *    `latency@1` compliance ratio is the share of frames that met 60 fps;
 *  - the distribution carries the report's own p50/p95/p99;
 *  - `environment` is always `local`: a harness run on a developer machine is
 *    never production evidence, and the Observatory refuses to pool the two;
 *  - the fixture checksum is the artifact id, and the report's build SHA the
 *    release (null when the build has no git identity).
 *
 * The adapter refuses — rather than emitting a zero or a partial record — when
 * the report's frame time is unknown or the capture was throttled. The result
 * is checked with the Observatory's own `validateObservation`.
 */
import { UNKNOWN } from '@/lib/config/measurementManifest';
import { validateObservation, type ValidationResult } from '@/lib/observatory/validator';
import type { Observation } from '@/lib/observatory/types';
import { getDeviceProfile } from './deviceProfiles';
import type { PerformanceReport } from './performanceReport';

/** Capability every frame-time observation is filed under. */
export const FRAME_TIME_CAPABILITY_ID = 'cap:performance.frame-time@1';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayWindow(iso: string): { label: '24h'; start: string; end: string } {
  const at = Date.parse(iso);
  const start = Math.floor(at / DAY_MS) * DAY_MS;
  return { label: '24h', start: new Date(start).toISOString(), end: new Date(start + DAY_MS).toISOString() };
}

/**
 * Convert a report into an Observatory latency observation.
 * @param report A performance report.
 * @param options `ingestedAt` (defaults to now) and an optional observation id.
 * @returns The validated observation, or why none can be produced.
 */
export function toObservatoryObservation(
  report: PerformanceReport,
  options: { ingestedAt?: string; observationId?: string } = {},
): ValidationResult<Observation> {
  const frame = report.aggregates.frameTime;
  if (frame.p50Ms === UNKNOWN || frame.p95Ms === UNKNOWN || frame.p99Ms === UNKNOWN) {
    return { ok: false, errors: ['frame-time percentiles are unknown; no latency observation can be derived'] };
  }
  if (report.capture.hiddenDuringCapture) {
    return { ok: false, errors: ['the page was hidden during capture; throttled frames are not latency evidence'] };
  }
  const frameBudget = getDeviceProfile(report.profile.key)?.budgets.find((b) => b.metric === 'frameTimeP95Ms');
  if (!frameBudget) {
    return { ok: false, errors: [`profile ${report.profile.key} has no frame-time budget to measure compliance against`] };
  }

  const samples = report.samples.frameTimesMs;
  const withinBudget = samples.filter((s) => s <= frameBudget.limit).length;
  const checksum = report.fixture.checksum;
  const sha = report.manifest.buildSha;
  const observation = {
    observationId: options.observationId ?? `obs:${report.reportId.replace(/[^0-9A-Za-z_-]/g, '-')}`.slice(0, 68),
    metric: 'latency',
    environment: 'local',
    window: utcDayWindow(report.capture.completedAt),
    evidence: {
      capabilityId: FRAME_TIME_CAPABILITY_ID,
      ...(checksum !== UNKNOWN && /^[0-9a-f]{8,64}$/.test(checksum) ? { artifactId: `art:${checksum}` } : {}),
    },
    source: 'latency-monitor',
    releaseSha: sha !== UNKNOWN && /^[0-9a-f]{7,64}$/.test(sha) ? sha : null,
    observedAt: report.capture.completedAt,
    ingestedAt: options.ingestedAt ?? new Date().toISOString(),
    confidence: 'verified',
    applicability: 'applicable',
    formulaVersion: 'latency@1',
    sampleSize: samples.length,
    latencyDistribution: {
      p50Ms: frame.p50Ms,
      p95Ms: frame.p95Ms,
      p99Ms: frame.p99Ms,
      budgetMs: frameBudget.limit,
      withinBudget,
      eligible: samples.length,
    },
  };
  return validateObservation(observation);
}
