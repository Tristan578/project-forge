---
"web": patch
---

Remediate four High-severity findings from the 2026-05-30 security & testing audit:

- **F01 (CI):** add an aggregating `ci-success` status check so branch protection covers every real gate (eslint/tsc/vitest/coverage, command-parity, build, docs/design gates, e2e) instead of only the no-op `ci-gate` path detector.
- **F02 (billing):** make add-on token crediting idempotent across Stripe webhook redelivery via a `UNIQUE` index on `token_purchases.stripe_payment_intent` and a single `INSERT ... ON CONFLICT DO NOTHING` + conditional balance `UPDATE` CTE. Redelivered events no longer double-credit users.
- **F03 (telemetry):** stop sending default PII to Sentry (IPs, cookies, headers, user data) and scrub residual secrets/PII (API keys, JWTs, bearer tokens, emails, IPs) from every event via `beforeSend`/`beforeSendTransaction`.
- **F04 (telemetry):** stop capturing stack-frame local variables on the server, which could hold decrypted BYOK provider keys and prompts.
