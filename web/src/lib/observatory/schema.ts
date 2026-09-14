/**
 * Forge Observatory — versioned runtime schema (#9751).
 *
 * Zod (v4) schemas mirroring `types.ts`. This is the authoritative runtime
 * contract shared by ingestion, snapshots, the API, fixtures and views. The
 * validator in `validator.ts` layers the semantic rules that a shape schema
 * cannot express (zero-denominator states, formula-version identity,
 * single-environment snapshots).
 *
 * SCHEMA_VERSION is bumped when the wire shape changes. FORMULA_VERSIONS are
 * bumped independently when a metric's computation changes — a fixture frozen
 * under an old formula must still expose that it used the old formula, which is
 * why the identity lives in every record rather than being implicit.
 */
import { z } from 'zod';

/** Wire-shape version. Bump on any structural change to the schemas below. */
export const SCHEMA_VERSION = '1.0.0';

/**
 * Registered formula identity per metric. A record's `formulaVersion` must
 * equal the entry for its metric, or the validator rejects it. Bumping a value
 * here is a deliberate scope change and forces every fixture to be re-frozen.
 */
export const FORMULA_VERSIONS = {
  completeness: 'completeness@1',
  friction: 'friction@1',
  latency: 'latency@1',
  uptime: 'uptime@1',
} as const;

/**
 * Minimum sample counts per metric. Below the minimum a value is
 * `insufficient_sample`, never a reported number. Downstream tickets consume
 * these rather than inventing local defaults.
 */
export const MINIMUM_SAMPLE_SIZE = {
  completeness: 1,
  friction: 5,
  latency: 20,
  uptime: 10,
} as const;

/**
 * Source-specific freshness TTLs in seconds. A `measured` value older than its
 * TTL becomes `stale`. Keyed by the metric's canonical source.
 */
export const FRESHNESS_TTL_SECONDS = {
  'capability-contract': 60 * 60 * 24, // completeness: 24h
  'journey-telemetry': 60 * 60 * 6, //    friction: 6h
  'latency-monitor': 60 * 60, //          latency: 1h
  'synthetic-monitor': 60 * 15, //        uptime: 15m
} as const;

/** Expected window durations in milliseconds, for half-open [start,end) checks. */
export const WINDOW_DURATION_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;

export const zMetricName = z.enum(['completeness', 'friction', 'latency', 'uptime']);
export const zEnvironment = z.enum(['production', 'preview', 'local']);
export const zWindowLabel = z.enum(['24h', '7d', '30d']);
export const zConfidence = z.enum(['verified', 'inferred', 'unavailable']);
export const zApplicability = z.enum(['applicable', 'not_applicable']);
export const zMetricDirection = z.enum(['higher_is_better', 'lower_is_better']);
export const zMetricUnit = z.enum(['ratio', 'percent', 'milliseconds', 'count']);

/** ISO-8601 UTC timestamp. Zod v4 `z.iso.datetime` enforces the format. */
const zIsoUtc = z.iso.datetime({ offset: false });

// Versioned identity regexes. Each ID is prefixed and (where mutable)
// version-stamped, so a scope change is visible in the string itself.
const CAPABILITY_ID_RE = /^cap:[a-z0-9-]+\.[a-z0-9-]+@\d+$/;
const ARTIFACT_ID_RE = /^art:[0-9a-f]{8,64}$/;
const JOURNEY_ID_RE = /^jrn:[a-z0-9-]+@\d+$/;
const DEPENDENCY_ID_RE = /^dep:[a-z0-9-]+@\d+$/;
const OBSERVATION_ID_RE = /^obs:[0-9A-Za-z_-]{8,64}$/;
const SNAPSHOT_ID_RE = /^snap:[0-9A-Za-z_-]{8,64}$/;

export const zCapabilityId = z.string().regex(CAPABILITY_ID_RE, 'invalid capability id');
export const zArtifactId = z.string().regex(ARTIFACT_ID_RE, 'invalid artifact id');
export const zJourneyId = z.string().regex(JOURNEY_ID_RE, 'invalid journey id');
export const zDependencyId = z.string().regex(DEPENDENCY_ID_RE, 'invalid dependency id');
export const zObservationId = z.string().regex(OBSERVATION_ID_RE, 'invalid observation id');
export const zSnapshotId = z.string().regex(SNAPSHOT_ID_RE, 'invalid snapshot id');

export const zTimeWindow = z
  .object({
    label: zWindowLabel,
    start: zIsoUtc,
    end: zIsoUtc,
  })
  // Half-open [start, end): end must be strictly after start.
  .refine((w) => Date.parse(w.end) > Date.parse(w.start), {
    message: 'window end must be strictly after start (half-open [start, end))',
    path: ['end'],
  });

export const zEvidenceRef = z
  .object({
    capabilityId: zCapabilityId.optional(),
    artifactId: zArtifactId.optional(),
    journeyId: zJourneyId.optional(),
    dependencyId: zDependencyId.optional(),
    observationIds: z.array(zObservationId).optional(),
  })
  // A metric must reference at least one subject, or it is anchored to nothing.
  .refine(
    (e) => Boolean(e.capabilityId || e.artifactId || e.journeyId || e.dependencyId),
    { message: 'evidence must reference at least one subject id' },
  );

const zMetricValueBase = z.object({
  metric: zMetricName,
  unit: zMetricUnit,
  direction: zMetricDirection,
  environment: zEnvironment,
  window: zTimeWindow,
  source: z.string().min(1).max(120),
  releaseSha: z.string().regex(/^[0-9a-f]{7,64}$/, 'invalid release sha').nullable(),
  observedAt: zIsoUtc,
  ingestedAt: zIsoUtc,
  confidence: zConfidence,
  applicability: zApplicability,
  formulaVersion: z.string().min(1).max(60),
});

export const zMeasuredMetricValue = zMetricValueBase.extend({
  state: z.literal('measured'),
  applicability: z.literal('applicable'),
  value: z.number().finite(),
  numerator: z.number().finite().nonnegative().optional(),
  denominator: z.number().finite().positive().optional(),
  sampleSize: z.number().int().nonnegative(),
  freshnessTtlSeconds: z.number().int().positive(),
  // Measured evidence must have real provenance.
  confidence: z.enum(['verified', 'inferred']),
});

export const zStaleMetricValue = zMetricValueBase.extend({
  state: z.literal('stale'),
  value: z.null(),
  lastObservedValue: z.number().finite(),
  lastObservedAt: zIsoUtc,
  sampleSize: z.number().int().nonnegative(),
  freshnessTtlSeconds: z.number().int().positive(),
});

export const zInsufficientSampleMetricValue = zMetricValueBase.extend({
  state: z.literal('insufficient_sample'),
  applicability: z.literal('applicable'),
  value: z.null(),
  sampleSize: z.number().int().nonnegative(),
  minimumSampleSize: z.number().int().positive(),
});

export const zNotApplicableMetricValue = zMetricValueBase.extend({
  state: z.literal('not_applicable'),
  applicability: z.literal('not_applicable'),
  value: z.null(),
});

export const zUnknownMetricValue = zMetricValueBase.extend({
  state: z.literal('unknown'),
  value: z.null(),
});

export const zMetricValue = z.discriminatedUnion('state', [
  zMeasuredMetricValue,
  zStaleMetricValue,
  zInsufficientSampleMetricValue,
  zNotApplicableMetricValue,
  zUnknownMetricValue,
]);

export const zLatencyDistribution = z
  .object({
    p50Ms: z.number().finite().nonnegative(),
    p95Ms: z.number().finite().nonnegative(),
    p99Ms: z.number().finite().nonnegative(),
    budgetMs: z.number().finite().positive(),
    withinBudget: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
  })
  .refine((d) => d.p95Ms >= d.p50Ms && d.p99Ms >= d.p95Ms, {
    message: 'latency percentiles must be monotonic: p50 <= p95 <= p99',
  })
  .refine((d) => d.withinBudget <= d.eligible, {
    message: 'withinBudget cannot exceed eligible operations',
  });

export const zObservation = z
  .object({
    observationId: zObservationId,
    metric: zMetricName,
    environment: zEnvironment,
    window: zTimeWindow,
    evidence: zEvidenceRef,
    source: z.string().min(1).max(120),
    releaseSha: z.string().regex(/^[0-9a-f]{7,64}$/, 'invalid release sha').nullable(),
    observedAt: zIsoUtc,
    ingestedAt: zIsoUtc,
    confidence: zConfidence,
    applicability: zApplicability,
    formulaVersion: z.string().min(1).max(60),
    numerator: z.number().finite().nonnegative().optional(),
    denominator: z.number().finite().nonnegative().optional(),
    sampleSize: z.number().int().nonnegative(),
    latencyDistribution: zLatencyDistribution.optional(),
  })
  .refine((o) => o.numerator === undefined || o.denominator === undefined || o.numerator <= o.denominator, {
    message: 'numerator cannot exceed denominator',
    path: ['numerator'],
  });

export const zSnapshot = z.object({
  snapshotId: zSnapshotId,
  environment: zEnvironment,
  builtAt: zIsoUtc,
  schemaVersion: z.string().min(1).max(20),
  values: z.array(zMetricValue),
});
