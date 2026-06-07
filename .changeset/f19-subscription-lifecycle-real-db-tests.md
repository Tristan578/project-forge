---
"web": patch
---

Convert `subscriptionLifecycle.db.test.ts` from a fully-mocked substring suite to real-DB behavioral tests (PGlite, replaying production migrations) and fix the `invoice.paid` rollover double-credit bug it exposed.

The prior `.db`-named suite mocked the entire DB client and asserted only SQL *shape* — it could pass while the SQL was semantically wrong. The rewrite drives every `subscription-lifecycle` handler (`findUserByStripeCustomer`, subscription create/update/delete, `handleInvoicePaid`, `handleInvoicePaymentFailed`) against an in-process Postgres and asserts on the resulting `users` / `credit_transactions` rows.

This surfaced a real money-path bug (#8708): on Stripe `invoice.paid` redelivery (at-least-once delivery), the renewal-rollover path re-ran an un-gated `addon_tokens` relative increment, permanently inflating the purchased-token balance while the audit log showed a single rollover row. The rollover audit INSERT and the addon UPDATE are now merged into one data-modifying CTE so the UPDATE credits only what the INSERT actually inserted (`RETURNING amount`, `COALESCE(..., 0)`), matching the codebase's `reverseAddonTokens` idiom. First-fire behavior is unchanged; redelivery is now a no-op on balance.
