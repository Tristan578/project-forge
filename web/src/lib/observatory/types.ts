/**
 * Forge Observatory — shared metric contract types (#9751).
 *
 * This module is the single typed contract for the four Observatory metrics
 * (completeness, friction, latency, uptime). Ingestion, snapshots, the API,
 * fixtures and views all consume THESE types rather than inventing local
 * shapes. The full metric dictionary — formulas, windows, TTLs, minimum sample
 * counts, inclusion/exclusion rules and display direction — lives in
 * `specs/forge-observatory.md`; the runtime schema that enforces this module is
 * `schema.ts`, and the validator is `validator.ts`.
 *
 * Design invariants (all pinned by tests):
 *  - Applicability, data quality / freshness, and measured health are THREE
 *    separate axes. A metric can be applicable, stale, and carry a last-good
 *    value all at once — that is a stale record, not a healthy one.
 *  - The four non-measured states (Unknown, Stale, InsufficientSample,
 *    NotApplicable) are a discriminated union keyed on `state`, DISTINCT from a
 *    numeric zero. A zero is a measured 0/N; "no evidence" is a state.
 *  - Confidence is a provenance category (verified / inferred / unavailable),
 *    never an unexplained numeric probability.
 *  - Incompatible metrics are never averaged into one health number.
 */

/** The four Observatory metrics. Each is defined in `specs/forge-observatory.md`. */
export type MetricName = 'completeness' | 'friction' | 'latency' | 'uptime';

/**
 * Deployment environments are graded separately and NEVER pooled together —
 * a production snapshot may not mix in preview or local evidence.
 */
export type Environment = 'production' | 'preview' | 'local';

/** Half-open UTC observation windows. */
export type WindowLabel = '24h' | '7d' | '30d';

/**
 * Provenance category for a value. NOT a numeric probability.
 *  - verified:    measured directly from a real dependency / real traffic.
 *  - inferred:    derived from a proxy or substituted signal.
 *  - unavailable: no provenance; only valid on non-measured states.
 */
export type Confidence = 'verified' | 'inferred' | 'unavailable';

/**
 * The measured-health axis, as a discriminated union tag. `measured` is the
 * only state that carries a numeric `value`; every other state carries
 * `value: null` and explains why, so a zero is never confused with "no data".
 */
export type MetricState =
  | 'measured'
  | 'stale'
  | 'insufficient_sample'
  | 'not_applicable'
  | 'unknown';

/** The applicability axis, independent of whether a value was measured. */
export type Applicability = 'applicable' | 'not_applicable';

/**
 * Display direction, normalized in the dictionary so downstream views never
 * invent their own. `higher_is_better` for completeness/uptime;
 * `lower_is_better` for friction and raw latency.
 */
export type MetricDirection = 'higher_is_better' | 'lower_is_better';

/** Unit of the reported `value`. Ratios are in [0,1]; percents in [0,100]. */
export type MetricUnit = 'ratio' | 'percent' | 'milliseconds' | 'count';

/**
 * Versioned identity strings. Every ID is prefixed and version-stamped so a
 * scope change is visible in the ID itself. Validated by regex in `schema.ts`.
 *  - CapabilityId: `cap:<domain>.<name>@<v>`   e.g. `cap:scene.spawn@1`
 *  - ArtifactId:   `art:<hex digest>`          content digest, immutable
 *  - JourneyId:    `jrn:<name>@<v>`            e.g. `jrn:first-game@2`
 *  - DependencyId: `dep:<name>@<v>`            e.g. `dep:upstash-redis@1`
 *  - ObservationId:`obs:<id>`                  ULID/UUID of one evidence record
 *  - SnapshotId:   `snap:<id>`                 ULID/UUID of one snapshot
 */
export type CapabilityId = string & { readonly __brand: 'CapabilityId' };
export type ArtifactId = string & { readonly __brand: 'ArtifactId' };
export type JourneyId = string & { readonly __brand: 'JourneyId' };
export type DependencyId = string & { readonly __brand: 'DependencyId' };
export type ObservationId = string & { readonly __brand: 'ObservationId' };
export type SnapshotId = string & { readonly __brand: 'SnapshotId' };

/** A half-open UTC window [start, end). ISO-8601 timestamps. */
export interface TimeWindow {
  label: WindowLabel;
  /** Inclusive lower bound, ISO-8601 UTC. */
  start: string;
  /** Exclusive upper bound, ISO-8601 UTC. */
  end: string;
}

/**
 * References to the evidence a metric was computed from. At least one of the
 * subject IDs is present; a metric about a capability carries `capabilityId`,
 * a journey metric carries `journeyId`, etc.
 */
export interface EvidenceRef {
  capabilityId?: CapabilityId;
  artifactId?: ArtifactId;
  journeyId?: JourneyId;
  dependencyId?: DependencyId;
  /** Observation records this value was pooled from, for audit. */
  observationIds?: ObservationId[];
}

/**
 * Fields shared by every MetricState. These describe WHERE and WHEN evidence
 * came from and HOW it is interpreted — independent of the numeric value.
 */
export interface MetricValueBase {
  metric: MetricName;
  unit: MetricUnit;
  direction: MetricDirection;
  environment: Environment;
  window: TimeWindow;
  /** Named source system, e.g. `synthetic-monitor`, `capability-contract`. */
  source: string;
  /** Release the evidence was gathered against; null for release-agnostic. */
  releaseSha: string | null;
  /** When the underlying evidence was observed (ISO-8601 UTC). */
  observedAt: string;
  /** When the evidence was ingested into the Observatory (ISO-8601 UTC). */
  ingestedAt: string;
  /** Provenance category for the value or state. */
  confidence: Confidence;
  /** Applicability axis — independent of `state`. */
  applicability: Applicability;
  /** Formula identity, e.g. `completeness@1`. Must match the registry. */
  formulaVersion: string;
}

/** A directly measured value: the only state carrying a numeric `value`. */
export interface MeasuredMetricValue extends MetricValueBase {
  state: 'measured';
  applicability: 'applicable';
  /** The metric value. Ratio in [0,1]; percent in [0,100]; ms >= 0; count >= 0. */
  value: number;
  /** Ratio numerator (e.g. verified requirements). Omitted for latency ms. */
  numerator?: number;
  /** Ratio denominator (e.g. applicable requirements). Must be > 0 here. */
  denominator?: number;
  /** Number of underlying data points. Must meet the metric's minimum. */
  sampleSize: number;
  /** How long this value stays fresh from `observedAt`, in seconds. */
  freshnessTtlSeconds: number;
}

/**
 * A previously measured value that is now past its freshness TTL. It RETAINS
 * the last observed value for context but explicitly does not claim current
 * health — `value` is null on the health axis; the history sits in
 * `lastObservedValue`.
 */
export interface StaleMetricValue extends MetricValueBase {
  state: 'stale';
  value: null;
  lastObservedValue: number;
  lastObservedAt: string;
  sampleSize: number;
  freshnessTtlSeconds: number;
}

/** Applicable, but too few data points to report a trustworthy value. */
export interface InsufficientSampleMetricValue extends MetricValueBase {
  state: 'insufficient_sample';
  applicability: 'applicable';
  value: null;
  sampleSize: number;
  minimumSampleSize: number;
}

/** The metric does not apply to this subject (e.g. uptime on a non-runtime artifact). */
export interface NotApplicableMetricValue extends MetricValueBase {
  state: 'not_applicable';
  applicability: 'not_applicable';
  value: null;
}

/** Evidence was expected but is missing or could not be resolved. */
export interface UnknownMetricValue extends MetricValueBase {
  state: 'unknown';
  value: null;
}

/**
 * The metric value discriminated union. Switch on `state`; only `measured`
 * carries a numeric `value`.
 */
export type MetricValue =
  | MeasuredMetricValue
  | StaleMetricValue
  | InsufficientSampleMetricValue
  | NotApplicableMetricValue
  | UnknownMetricValue;

/**
 * A raw evidence record. An observation carries the counts and provenance for
 * ONE metric about ONE subject in ONE environment/window; the metric value is
 * derived from it (see `deriveMetricValue` in `validator.ts`).
 */
export interface Observation {
  observationId: ObservationId;
  metric: MetricName;
  environment: Environment;
  window: TimeWindow;
  evidence: EvidenceRef;
  source: string;
  releaseSha: string | null;
  observedAt: string;
  ingestedAt: string;
  confidence: Confidence;
  applicability: Applicability;
  formulaVersion: string;
  /**
   * Ratio numerator for ratio metrics (completeness/friction/uptime/budget).
   * Absent for raw-latency distribution observations.
   */
  numerator?: number;
  /** Ratio denominator. Zero denominator must resolve to a non-measured state. */
  denominator?: number;
  /** Underlying data points backing this observation. */
  sampleSize: number;
  /** Optional raw latency distribution (milliseconds), when metric === 'latency'. */
  latencyDistribution?: LatencyDistribution;
}

/** Raw latency percentiles plus a budget-compliance ratio, shown separately. */
export interface LatencyDistribution {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** Operation budget in ms the compliance ratio is measured against. */
  budgetMs: number;
  /** Completed eligible operations within budget. */
  withinBudget: number;
  /** All eligible operations (includes timeouts, which never count as within). */
  eligible: number;
}

/**
 * A point-in-time collection of metric values for ONE environment. A snapshot
 * may not mix environments — the validator rejects any value whose
 * `environment` differs from the snapshot's.
 */
export interface Snapshot {
  snapshotId: SnapshotId;
  environment: Environment;
  /** Snapshot build time (ISO-8601 UTC). */
  builtAt: string;
  /** The schema version this snapshot was produced under. */
  schemaVersion: string;
  values: MetricValue[];
}
