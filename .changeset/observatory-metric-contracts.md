---
"web": minor
---

Add the shared Forge Observatory metric contract (#9751): `web/src/lib/observatory/` now holds a versioned TypeScript schema, a runtime validator, and golden JSON fixtures for the four Observatory metrics (completeness, friction, latency, uptime), plus the metric dictionary in `specs/forge-observatory.md`. The contract separates applicability, freshness, and measured health as three axes so a stale value keeps its last-observed value without claiming current health, distinguishes explicit Unknown/Stale/InsufficientSample/NotApplicable states from any numeric zero, defines half-open UTC windows, per-source freshness TTLs, and minimum sample counts, and rejects zero-denominator, formula-version-mismatch, and mixed-environment records. This is the schema ingestion, snapshots, the API and views will consume; no runtime behavior changes yet.
