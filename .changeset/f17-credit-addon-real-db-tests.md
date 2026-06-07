---
"web": patch
---

test(tokens): prove `creditAddonTokens` add-on top-up against in-process Postgres (F17)

The previous mock-based tests for the add-on token purchase path only asserted
that the interpolated SQL string contained `ON CONFLICT` / `DO NOTHING` and that
the package's token count appeared among the bound values — they never asserted
that the balance actually moved, that exactly one purchase row was written, or
that a redelivered Stripe webhook credits nothing. New `creditAddonTokens.db.test.ts`
runs the real single-CTE statement against PGlite (Postgres-in-WASM) and asserts
on the resulting rows: exact credited balance per package (spark 1000 / blaze
5000 / inferno 20000), one purchase row with the correct tokens/amount_cents,
add-on-to-existing-balance accumulation, sequential re-fire idempotency, distinct
payment-intent stacking, and per-user isolation. No production code changes.
