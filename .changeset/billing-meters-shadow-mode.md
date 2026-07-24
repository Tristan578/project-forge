---
"web": minor
---

feat(billing): shadow-mode Stripe billing-meter usage reporting (PF-977/PF-978, #8969/#8970)

Adds infrastructure for reporting confirmed generation token usage to a Stripe
billing meter (`generation_tokens`), gated behind `BILLING_METERS_ENABLED`
(default off, dormant). No metered Price is attached in this rollout — this
is usage reporting only and never changes what a customer is charged.

- `web/scripts/provision-billing-meter.ts` — one-time, idempotent, owner-run
  script to create the Stripe meter in a given mode (test/live). Not run by
  any build/deploy step.
- `web/src/lib/billing/meterEvents.ts` — `reportGenerationUsage()`, a
  fire-and-forget reporter with claim-before-emit semantics against two new
  additive/nullable `token_usage` columns (`meter_attempted_at`,
  `metered_at`) added via `web/drizzle/0009_token_usage_meter_columns.sql`.
  Skips BYOK usage, unmetered rows, and no-ops entirely when the flag is off.
- Runbook: `docs/guides/billing-meters-setup.md`.

Wiring the reporter into `createGenerationHandler`'s request path is a
separate follow-up ticket (spec slice 3) — not included here.
