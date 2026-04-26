---
"spawnforge": patch
---

Bump `stripe` from 22.0.1 to 22.1.0 and pin Stripe API version to `2026-04-22.dahlia` (was `2026-03-25.dahlia`).

The 22.1.0 release adds support for new account capabilities (`app_distribution`, `sunbit_payments`), new account-session components (`balance_report`, `payout_reconciliation_report`), and new `BalanceTransaction.type` enum values (`fee_credit_funding`, `inbound_transfer_reversal`, `inbound_transfer`). None of those surfaces are consumed by SpawnForge today, so the bump is non-breaking for current usage.

Tests in `web/src/app/api/billing/{checkout,portal,status}/route.test.ts` were updated to assert the new pinned version. The webhook route comment about `invoice.parent` vs `invoice.subscription` was retargeted to the new pin date.
