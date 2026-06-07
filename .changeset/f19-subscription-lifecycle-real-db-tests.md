---
"web": patch
---

Convert `subscriptionLifecycle.db.test.ts` from a fully-mocked substring suite to real-DB behavioral tests (PGlite, replaying production migrations) and fix the `invoice.paid` rollover double-credit bug it exposed.

The prior `.db`-named suite mocked the entire DB client and asserted only SQL *shape* — it could pass while the SQL was semantically wrong. The rewrite drives every `subscription-lifecycle` handler (`findUserByStripeCustomer`, subscription create/update/delete, `handleInvoicePaid`, `handleInvoicePaymentFailed`) against an in-process Postgres and asserts on the resulting `users` / `credit_transactions` rows.

This surfaced six real money-path bugs across the subscription handlers, all on the Stripe webhook redelivery path (at-least-once delivery). First-fire behavior is unchanged for every fix; redelivery is now a no-op on balance and on the used-counter.

`handleInvoicePaid`:

- **Rollover double-credit (#8708):** the renewal-rollover path re-ran an un-gated `addon_tokens` relative increment, permanently inflating the purchased-token balance while the audit log showed a single rollover row. The rollover audit INSERT and the addon UPDATE are now merged into one data-modifying CTE so the UPDATE credits only what the INSERT actually inserted (`RETURNING amount`, `COALESCE(..., 0)`), matching the codebase's `reverseAddonTokens` idiom.

- **Monthly-reset over-grant (#8611):** the cycle-reset UPDATE unconditionally set `monthly_tokens_used = 0`, so a redelivery that landed after the user had spent part of the freshly-granted allocation silently refunded that spend — letting a user burn the monthly allocation twice per cycle for the price of a webhook retry. The reset is now gated on `NOT EXISTS` of the renewal grant row; since the grant INSERT runs after the reset within the same transaction, the first fire still resets while a redelivery is skipped, preserving interleaved spend and not re-stamping `billing_cycle_start`.

- **Rollover leak on a no-rollover first fire (#8709):** when the first fire had no remaining tokens (`remaining == 0`), the rollover statement was skipped, so its `renewal_rollover:<tier>` anchor was never written — yet the reset + grant still marked the invoice processed. A redelivery after the user spent part of the fresh allocation then saw `remaining > 0`, re-enabled the rollover, found no anchor to suppress it, and credited a free rollover into `addon_tokens`. The rollover is now gated on the same always-written renewal grant row as the reset, not its own conditionally-written anchor.

- **Tier-keyed idempotency anchor (#8710):** all three gates keyed on the tier-specific `renewal:<tier>` source, but `<tier>` is read mutably from `user.tier` at processing time. A tier change between an invoice's original delivery and a redelivery made the redelivery's anchor (`renewal:pro`) differ from the committed one (`renewal:creator`), re-opening every gate → double rollover **and** a duplicate monthly grant (the grant's `ON CONFLICT` keys on source, so the differing source dodged it). All gates now match `source LIKE 'renewal:%'` (tier-independent, and excludes the `renewal_rollover:%` rows because the literal `:` cannot match the `_`), and the grant INSERT gains the same `NOT EXISTS` gate so a cross-tier redelivery cannot write a second grant.

`handleSubscriptionCreated`:

- **Unconditional cycle reset (#8711):** the reset UPDATE set `monthly_tokens_used = 0` with no idempotency gate, so a redelivery after the user spent part of the initial allocation refunded that spend. Both the reset UPDATE and the grant INSERT are now gated on `NOT EXISTS` of the `subscription_created:%` anchor for the subscription id (tier-independent), so a redelivery is a no-op.

`handleSubscriptionDeleted`:

- **Re-zero + duplicate audit row (#8712):** the cancellation reset was unconditional (re-zeroing any post-cancellation starter spend on redelivery) and the audit source embedded `previousTier`, which `findUserByStripeCustomer` re-reads as `starter` on redelivery — so the differing source (`cancellation:starter->starter`) dodged the exact-source `ON CONFLICT` and wrote a bogus duplicate audit row with a phantom amount. The handler is now a single atomic CTE (`WITH audit AS (INSERT … RETURNING id) UPDATE … WHERE EXISTS (SELECT 1 FROM audit)`): the audit INSERT is gated on the tier-independent `cancellation:%` anchor and arbitrates the reset, so on redelivery neither the duplicate row nor the re-zero occurs.
