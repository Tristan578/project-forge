---
"web": patch
---

Fix charge-refund token reversal throwing on fractional refund ratios, and convert reverseAddonTokens tests to a real in-process Postgres (PGlite)

The fallback (non-purchase) refund path interpolated the JS refund ratio directly into `FLOOR(addon_tokens * ${refundRatio})`. The neon-http driver binds params as untyped text, so Postgres resolved the multiplication against the integer column and threw `invalid input syntax for type integer` for any partial refund (e.g. ratio `0.5`). The ratio is now cast `::float8`. The previous mock-only tests asserted on SQL substrings and bound values and never executed the CTE, so they missed it; the converted suite runs the real arithmetic, the `refunded_cents` claim guard, and the `NOT EXISTS`/unique-index idempotency against PGlite and asserts on resulting row state.
