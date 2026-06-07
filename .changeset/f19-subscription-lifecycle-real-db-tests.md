---
"web": patch
---

Convert `subscriptionLifecycle.db.test.ts` from a fully-mocked substring suite to real-DB behavioral tests (PGlite, replaying production migrations) and fix the `invoice.paid` rollover double-credit bug it exposed.

The prior `.db`-named suite mocked the entire DB client and asserted only SQL *shape* — it could pass while the SQL was semantically wrong. The rewrite drives every `subscription-lifecycle` handler (`findUserByStripeCustomer`, subscription create/update/delete, `handleInvoicePaid`, `handleInvoicePaymentFailed`) against an in-process Postgres and asserts on the resulting `users` / `credit_transactions` rows.

This surfaced three real money-path bugs in `handleInvoicePaid`, all on the Stripe `invoice.paid` redelivery path (at-least-once delivery):

- **Rollover double-credit (#8708):** the renewal-rollover path re-ran an un-gated `addon_tokens` relative increment, permanently inflating the purchased-token balance while the audit log showed a single rollover row. The rollover audit INSERT and the addon UPDATE are now merged into one data-modifying CTE so the UPDATE credits only what the INSERT actually inserted (`RETURNING amount`, `COALESCE(..., 0)`), matching the codebase's `reverseAddonTokens` idiom.

- **Monthly-reset over-grant (#8611):** the cycle-reset UPDATE unconditionally set `monthly_tokens_used = 0`, so a redelivery that landed after the user had spent part of the freshly-granted allocation silently refunded that spend — letting a user burn the monthly allocation twice per cycle for the price of a webhook retry. The reset is now gated on `NOT EXISTS` of the renewal grant row (`source = renewal:<tier>`, `reference_id = <invoiceId>`); since the grant INSERT runs after the reset within the same transaction, the first fire still resets while a redelivery is skipped, preserving interleaved spend and not re-stamping `billing_cycle_start`.

- **Rollover leak on a no-rollover first fire (#8709):** when the first fire had no remaining tokens (`remaining == 0`), the rollover statement was skipped, so its `renewal_rollover:<tier>` anchor was never written — yet the reset + grant still marked the invoice processed. A redelivery after the user spent part of the fresh allocation then saw `remaining > 0`, re-enabled the rollover, found no anchor to suppress it, and credited a free rollover into `addon_tokens`. The rollover is now gated on the same always-written `renewal:<tier>` grant row as the reset (#8611), not its own conditionally-written anchor, so a redelivery cannot create a rollover even when the fresh read shows remaining tokens.

First-fire behavior is unchanged for all three; redelivery is now a no-op on balance and on the used-counter.
