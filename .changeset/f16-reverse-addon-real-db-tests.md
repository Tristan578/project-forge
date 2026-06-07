---
"web": patch
---

Fix charge-refund token reversal throwing on fractional refund ratios, and convert reverseAddonTokens tests to a real in-process Postgres (PGlite)

The fallback (non-purchase) refund path interpolated the JS refund ratio directly into `FLOOR(addon_tokens * ${refundRatio})`. The neon-http driver binds params as untyped text, so Postgres resolved the multiplication against the integer column and threw `invalid input syntax for type integer` for any partial refund (e.g. ratio `0.5`). The ratio is now cast `::float8`. The previous mock-only tests asserted on SQL substrings and bound values and never executed the CTE, so they missed it; the converted suite runs the real arithmetic, the `refunded_cents` claim guard, and the `NOT EXISTS`/unique-index idempotency against PGlite and asserts on resulting row state.

Also fixes an incremental-refund money bug the real-DB suite exposed (#8706): Stripe fires `charge.refunded` once per refund with a stable `charge.id` and a cumulative `amount_refunded`, but both reversal paths keyed the audit row's `reference_id` on `chargeId` alone. A legitimate incremental partial-then-larger refund of one charge therefore collided on `idx_credit_txn_idempotent` — on the purchase path the duplicate-key error rolled back the whole CTE, permanently lost the second clawback, and 500'd the webhook into an infinite Stripe retry; on the fallback path the second tranche silently no-op'd and under-deducted. The audit `reference_id` is now a per-tranche key (`${chargeId}:${amountRefunded}`), with `ON CONFLICT … DO NOTHING` on the purchase-path INSERT as defence-in-depth, so successive incremental refunds each record their own row while a true redelivery (same cumulative amount) remains an exact no-op.
