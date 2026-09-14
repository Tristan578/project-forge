/**
 * Forge Observatory — runtime validator (#9751).
 *
 * Wraps the `schema.ts` zod schemas with the semantic rules a shape schema
 * cannot express, and derives a metric value from a raw observation. Every
 * public function returns a discriminated `ValidationResult` rather than
 * throwing, so callers (ingestion, snapshot builder, API, fixtures) handle
 * rejection explicitly.
 *
 * Rejections enforced here, beyond shape:
 *  - Formula-version mismatch: a record's `formulaVersion` must equal the
 *    registered formula for its metric.
 *  - Zero-denominator without a non-measured state: a ratio with denominator 0
 *    must be `insufficient_sample`, never a measured value (a measured value
 *    cannot even carry denominator 0 — the schema forbids it — but an
 *    Observation can, and `deriveMetricValue` routes it to insufficient_sample).
 *  - Measured value / ratio consistency: a measured ratio's `value` must equal
 *    numerator / denominator.
 *  - Mixed environments in one snapshot: every value's `environment` must equal
 *    the snapshot's.
 *  - A stale record never claims current health (schema pins `value: null`).
 */
import type { ZodType } from 'zod';
import {
  zObservation,
  zSnapshot,
  zMetricValue,
  FORMULA_VERSIONS,
  MINIMUM_SAMPLE_SIZE,
  FRESHNESS_TTL_SECONDS,
} from './schema';
import type {
  Observation,
  Snapshot,
  MetricValue,
  MetricName,
  MetricUnit,
  MetricDirection,
} from './types';

/** Discriminated validation outcome. `ok: false` carries human-readable errors. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly errors: string[] };

/** Ratio equality tolerance for the measured-value consistency check. */
const RATIO_EPSILON = 1e-9;

/**
 * Metrics whose measured `value` must equal `numerator / denominator`. Latency
 * is included: its measured value is itself a ratio (budget compliance,
 * `withinBudget / eligible`), and `deriveMetricValue` populates
 * numerator/denominator for it exactly like the other three metrics.
 */
const RATIO_METRICS: ReadonlySet<MetricName> = new Set([
  'completeness',
  'friction',
  'uptime',
  'latency',
]);

/** Normalized display direction per metric (see `specs/forge-observatory.md`). */
const METRIC_DIRECTION: Record<MetricName, MetricDirection> = {
  completeness: 'higher_is_better',
  friction: 'lower_is_better',
  uptime: 'higher_is_better',
  latency: 'higher_is_better', // budget-compliance ratio; raw ms shown separately
};

/** Canonical source per metric, used to look up the freshness TTL. */
const METRIC_SOURCE: Record<MetricName, keyof typeof FRESHNESS_TTL_SECONDS> = {
  completeness: 'capability-contract',
  friction: 'journey-telemetry',
  latency: 'latency-monitor',
  uptime: 'synthetic-monitor',
};

function flattenZodErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '(root)';
    return `${path}: ${i.message}`;
  });
}

function parseWith<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    return { ok: false, errors: flattenZodErrors(result.error) };
  }
  return { ok: true, data: result.data };
}

/** True when a record's declared formula matches the registered one for its metric. */
function formulaMatches(metric: MetricName, formulaVersion: string): boolean {
  return FORMULA_VERSIONS[metric] === formulaVersion;
}

/**
 * Validate a single metric value: shape, formula identity, and measured-ratio
 * consistency. Does NOT check environment membership — that is a snapshot-level
 * concern handled by `validateSnapshot`.
 */
export function validateMetricValue(input: unknown): ValidationResult<MetricValue> {
  const shape = parseWith(zMetricValue, input);
  if (!shape.ok) return shape;
  const value = shape.data;
  const errors: string[] = [];

  if (!formulaMatches(value.metric, value.formulaVersion)) {
    errors.push(
      `formulaVersion: expected ${FORMULA_VERSIONS[value.metric]} for ${value.metric}, got ${value.formulaVersion}`,
    );
  }

  if (value.state === 'measured' && RATIO_METRICS.has(value.metric)) {
    if (value.numerator === undefined || value.denominator === undefined) {
      errors.push('measured ratio metric requires numerator and denominator');
    } else if (Math.abs(value.value - value.numerator / value.denominator) > RATIO_EPSILON) {
      errors.push(
        `value ${value.value} does not equal numerator/denominator ${value.numerator}/${value.denominator}`,
      );
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: value };
}

/** Validate a raw observation: shape + formula identity. */
export function validateObservation(input: unknown): ValidationResult<Observation> {
  const shape = parseWith(zObservation, input);
  if (!shape.ok) return shape;
  const obs = shape.data;
  if (!formulaMatches(obs.metric, obs.formulaVersion)) {
    return {
      ok: false,
      errors: [
        `formulaVersion: expected ${FORMULA_VERSIONS[obs.metric]} for ${obs.metric}, got ${obs.formulaVersion}`,
      ],
    };
  }
  return { ok: true, data: obs as Observation };
}

/**
 * Validate a snapshot: shape, then each value's formula identity and — the
 * point of a snapshot — that every value shares the snapshot's environment.
 * Mixed-environment evidence can never be pooled into one healthy result.
 */
export function validateSnapshot(input: unknown): ValidationResult<Snapshot> {
  const shape = parseWith(zSnapshot, input);
  if (!shape.ok) return shape;
  const snapshot = shape.data;
  const errors: string[] = [];

  snapshot.values.forEach((value, index) => {
    if (value.environment !== snapshot.environment) {
      errors.push(
        `values.${index}.environment: ${value.environment} does not match snapshot environment ${snapshot.environment}`,
      );
    }
    const perValue = validateMetricValue(value);
    if (!perValue.ok) {
      perValue.errors.forEach((e) => errors.push(`values.${index}.${e}`));
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data: snapshot as Snapshot };
}

/**
 * Derive a metric value from a validated observation, applying the dictionary's
 * inclusion rules. A zero (or absent) denominator, or a sample below the
 * metric's minimum, resolves to `insufficient_sample` — never a measured zero.
 * A not-applicable observation resolves to `not_applicable`.
 *
 * The caller is responsible for freshness (a value observed before now minus
 * its TTL is `stale`); this function produces the fresh measured/insufficient/
 * not-applicable value.
 */
export function deriveMetricValue(input: unknown): ValidationResult<MetricValue> {
  const validated = validateObservation(input);
  if (!validated.ok) return validated;
  const obs = validated.data;

  const unit: MetricUnit = 'ratio';
  const direction = METRIC_DIRECTION[obs.metric];
  const ttl = FRESHNESS_TTL_SECONDS[METRIC_SOURCE[obs.metric]];
  const base = {
    metric: obs.metric,
    unit,
    direction,
    environment: obs.environment,
    window: obs.window,
    source: obs.source,
    releaseSha: obs.releaseSha,
    observedAt: obs.observedAt,
    ingestedAt: obs.ingestedAt,
    confidence: obs.confidence,
    formulaVersion: obs.formulaVersion,
  };

  if (obs.applicability === 'not_applicable') {
    return {
      ok: true,
      data: { ...base, state: 'not_applicable', applicability: 'not_applicable', value: null },
    };
  }

  const minimum = MINIMUM_SAMPLE_SIZE[obs.metric];

  // Resolve numerator/denominator: ratio metrics use the observation's counts;
  // latency uses its budget-compliance counts.
  let numerator: number | undefined;
  let denominator: number | undefined;
  if (obs.metric === 'latency') {
    numerator = obs.latencyDistribution?.withinBudget;
    denominator = obs.latencyDistribution?.eligible;
  } else {
    numerator = obs.numerator;
    denominator = obs.denominator;
  }

  if (
    numerator === undefined ||
    denominator === undefined ||
    denominator === 0 ||
    obs.sampleSize < minimum
  ) {
    return {
      ok: true,
      data: {
        ...base,
        state: 'insufficient_sample',
        applicability: 'applicable',
        value: null,
        sampleSize: obs.sampleSize,
        minimumSampleSize: minimum,
      },
    };
  }

  if (obs.confidence === 'unavailable') {
    return {
      ok: false,
      errors: ['a measured value cannot have confidence "unavailable"'],
    };
  }

  return {
    ok: true,
    data: {
      ...base,
      state: 'measured',
      applicability: 'applicable',
      confidence: obs.confidence,
      value: numerator / denominator,
      numerator,
      denominator,
      sampleSize: obs.sampleSize,
      freshnessTtlSeconds: ttl,
    },
  };
}
