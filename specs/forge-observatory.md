# Forge Observatory — Metric Contracts and Evidence Schema

Status: accepted (first assurance foundation)
Issue: #9751 (parent epic #9750)
Owns the shared contract consumed by #9752, #9753, #9754, #9906.
Module: `web/src/lib/observatory/` — `types.ts`, `schema.ts`, `validator.ts`, `fixtures/`.

## Purpose

The Observatory tells **measured health apart from missing evidence**. This
document is the metric dictionary: it defines the four metrics, the evidence
that backs them, the windows and freshness rules that bound them, and the
identity and versioning rules that keep a value auditable. Downstream tickets
(ingestion, snapshots, API, views) consume the schema and these rules rather
than inventing local defaults.

The governing principle: **applicability, data quality / freshness, and measured
health are three separate axes.** A metric can be applicable, stale, and still
carry a last-observed value — that is a stale record, not a healthy one. A
zero (`0 / N`) is a measured result; "no evidence" is a *state*, never a zero
and never green.

## The three axes

| Axis | Field | Values |
|---|---|---|
| Applicability | `applicability` | `applicable`, `not_applicable` |
| Data quality / freshness + health | `state` | `measured`, `stale`, `insufficient_sample`, `not_applicable`, `unknown` |
| Provenance | `confidence` | `verified`, `inferred`, `unavailable` |

`state` is a discriminated union. Only `measured` carries a numeric `value`;
every other state carries `value: null` and explains itself. `confidence` is a
documented provenance **category**, never an unexplained numeric probability:

- `verified` — measured directly from a real dependency or real traffic.
- `inferred` — derived from a proxy or substituted signal.
- `unavailable` — no provenance; valid only on non-measured states. A measured
  value with `unavailable` confidence is rejected.

## Metric dictionary

All four primary metrics are reported as a **ratio in [0, 1]** (`unit: "ratio"`).
Companion distributions (raw latency percentiles, retry/abandonment counts) are
shown **separately** and are never folded into the ratio.

### Completeness — `completeness@1`

- **Formula:** `verified applicable requirements / all applicable requirements`
  in a versioned capability contract. Equal-weight requirements.
- **Direction:** higher is better.
- **Supporting evidence only:** code coverage and closed issues. They are never
  the numerator.
- **Worked example:** 4 verified of 5 applicable requirements ⇒ **0.80 (80%)**.
- **Minimum sample:** 1 applicable requirement.
- **Not applicable / zero eligible:** zero applicable requirements ⇒
  `insufficient_sample` (`value: null`), never 100%.

### Friction — `friction@1`

- **Primary rate:** `failed resolved attempts / resolved attempts`.
- **Direction:** lower is better.
- **Companion values (shown separately, never averaged in):** retries,
  abandonment, explicit cancellations, excess steps.
- **Worked example:** 2 failures of 10 resolved attempts ⇒ **0.20 (20%)** failure.
- **Minimum sample:** 5 resolved attempts.

### Latency — `latency@1`

- **Budget compliance (the ratio):** `completed eligible operations within the
  operation budget / all eligible operations`. Timeouts never count as within
  budget.
- **Direction:** higher is better (more operations inside budget).
- **Distributions (shown separately):** raw p50 / p95 / p99, monotonic
  (`p50 ≤ p95 ≤ p99`). These are displayed, not compliance-scored.
- **Worked example:** 95 within budget of 100 eligible ⇒ **0.95 (95%)** compliance.
- **Minimum sample:** 20 operations.

### Uptime — `uptime@1`

- **Formula:** `successful eligible observations / total eligible observations`.
- **Direction:** higher is better.
- **Distinguish:** synthetic availability from request success — they are
  different observations and are not merged. Monitor coverage and gaps are
  reported alongside, not blended in.
- **Worked example:** 286 successful of 288 eligible synthetic checks ⇒ ~0.993.
- **Minimum sample:** 10 eligible observations.
- **Not applicable:** a non-runtime artifact ⇒ `not_applicable`, never 100%.

### No composite score

Incompatible metrics are **not** averaged into one health number. There is no
weighted composite score in the initial delivery. Aggregation, when defined, is
arithmetic over a **pooled denominator** — never an average of per-capability
percentages.

## Windows

Windows are **half-open UTC intervals `[start, end)`**: `start` inclusive, `end`
exclusive. A window whose `end` is not strictly after its `start` is invalid.

| Label | Duration |
|---|---|
| `24h` | 24 hours |
| `7d` | 7 days |
| `30d` | 30 days |

A boundary timestamp equal to `end` belongs to the *next* window, not this one.

## Environments

`production`, `preview`, and `local` are graded **separately** and never pooled.
A snapshot is single-environment: any value whose `environment` differs from the
snapshot's is rejected, so stale, malformed, or mixed-environment evidence can
never combine into a fresh healthy result.

## Freshness (TTL)

Freshness is source-specific. A `measured` value older than its TTL (from
`observedAt`) becomes `stale`: it retains `lastObservedValue` for context but
reports `value: null` on the health axis.

| Source | Metric | TTL |
|---|---|---|
| `capability-contract` | completeness | 24h |
| `journey-telemetry` | friction | 6h |
| `latency-monitor` | latency | 1h |
| `synthetic-monitor` | uptime | 15m |

## Minimum sample counts

Below the minimum, a value is `insufficient_sample` (`value: null`), never a
reported number: completeness 1, friction 5, latency 20, uptime 10.

## Evidence record fields

Every metric value carries, independent of the numeric value: `metric`, `unit`,
`direction`, `numerator` / `denominator` (ratio metrics), `sampleSize`,
`source`, `environment`, `releaseSha`, `observedAt`, `ingestedAt`, `window`,
`freshnessTtl`, `applicability`, `confidence`, and `formulaVersion`. A serialized
complete observation therefore always includes units, formula, denominator, time
window and evidence references.

## Versioned identity

Every subject ID is prefixed and (where mutable) version-stamped, so a scope
change is visible in the ID itself:

| Subject | Shape | Example |
|---|---|---|
| Capability | `cap:<domain>.<name>@<v>` | `cap:scene.spawn@1` |
| Artifact | `art:<hex digest>` | `art:deadbeef…` |
| Journey | `jrn:<name>@<v>` | `jrn:first-game@2` |
| Dependency | `dep:<name>@<v>` | `dep:upstash-redis@1` |
| Observation | `obs:<id>` | `obs:01J9…` |
| Snapshot | `snap:<id>` | `snap:01J9…` |

**Formula versions** (`completeness@1`, `friction@1`, `latency@1`, `uptime@1`)
are bumped independently of the schema version when a metric's computation
changes. Each record states its `formulaVersion`; a record whose formula does
not match the registered one for its metric is rejected. A fixture frozen under
an old formula keeps its original formula string, so evaluating versioned
fixtures exposes the scope change while retaining each fixture's original
formula. The wire-shape `SCHEMA_VERSION` (`1.0.0`) is bumped only on structural
change.

## Validation rules (enforced by `validator.ts`)

- Shape validation via the zod schema (`schema.ts`).
- **Formula-version mismatch** ⇒ rejected.
- **Zero (or absent) denominator** ⇒ derives to `insufficient_sample`; a
  measured value can never carry denominator 0.
- **Measured-ratio consistency** ⇒ a measured ratio's `value` must equal
  `numerator / denominator`.
- **Mixed environments in one snapshot** ⇒ rejected.
- **Stale** ⇒ `value: null`; last-good lives on `lastObservedValue`.
- **Half-open window** ⇒ `end` must be strictly after `start`, AND the span
  must equal the label's exact duration (see Windows table) — a mislabeled
  window is rejected, not just an inverted one.
- **Metric metadata contradiction** ⇒ `unit`, `direction`, `source` (and, on
  measured/stale values, `freshnessTtlSeconds`) must equal the dictionary's
  registered value for that metric; rejected otherwise.
- **Out-of-range value** ⇒ a measured `value` or stale `lastObservedValue`
  outside the range its `unit` permits (ratio: `[0,1]`) is rejected.
- **Minimum sample vs. denominator** ⇒ the minimum-sample gate is applied to
  the resolved denominator (eligible/resolved count), not a caller-supplied
  `sampleSize` alone; `sampleSize` itself can never be less than the
  denominator (or, for latency, `latencyDistribution.eligible`).
- **Schema version** ⇒ a snapshot's `schemaVersion` must equal the current
  `SCHEMA_VERSION`; any other value is rejected as a different wire contract.

## Golden fixtures

`web/src/lib/observatory/fixtures/` holds representative contract fixtures,
asserted by `__tests__/fixtures.test.ts`. Tests run with no database, live
vendor or dashboard.

| Fixture | Asserts |
|---|---|
| `completeness-verified.json` | 4/5 ⇒ 0.80 measured |
| `completeness-zero-eligible.json` | 0 eligible ⇒ null + insufficient |
| `friction-failed-resolved.json` | 2/10 ⇒ 0.20 measured |
| `latency-budget-compliance.json` | 95/100 ⇒ 0.95 measured |
| `uptime-eligible-observations.json` | 286/288 ⇒ ~0.993 measured |
| `stale-last-good-value.json` | stale keeps last-good, no current health |
| `mixed-environment-invalid.json` | prod+preview snapshot rejected |
| `formula-version-mismatch.json` | wrong formula rejected |

## Glossary

- **Eligible observation** — an observation that meets the metric's inclusion
  rules for its window and environment; the denominator counts eligible items.
- **Resolved attempt** — a user attempt that reached a terminal outcome
  (success or failure), the friction denominator; abandonment is a companion.
- **Budget compliance** — the fraction of eligible operations completing within
  the operation budget; timeouts are non-compliant.
- **Snapshot** — a single-environment, point-in-time collection of metric values.
- **Provenance** — the `confidence` category recording how a value was obtained.

## Ownership and scope

This ticket owns the versioned schema, validator, fixtures and this dictionary.
Domain integration and live evidence collection belong to their native epics and
the linked consuming stories (#9752, #9753, #9754, #9906). Acceptance thresholds
stated here are **requirements, not observed baseline measurements**. Scope
changes are made by bumping a `formulaVersion` (metric computation) or
`SCHEMA_VERSION` (wire shape) and re-freezing the affected fixtures.
