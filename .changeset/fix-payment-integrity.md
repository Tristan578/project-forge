---
"web": patch
---

Fix payment-integrity gaps in webhook idempotency and marketplace downloads.

- Webhook idempotency (#8637): `claimEvent` now uses `INSERT ... ON CONFLICT DO UPDATE` guarded on row expiry (`setWhere: expiresAt < NOW()`), so a claim left behind by a crash between claim and finalize becomes re-claimable once its 5-minute in-flight TTL lapses — restoring the documented "crash mid-claim auto-expires so Stripe can redeliver" guarantee that the previous `DO NOTHING` conflict silently broke. The health-monitor cron now opportunistically prunes expired claim rows so the table cannot grow unbounded; the prune is best-effort and never fails the cron.
- Marketplace downloads (#8636): a paid asset download is now gated on the buyer's completed deduction credit-transaction, not merely the existence of the purchase row. A crash between the purchase-row insert and the balance deduction could otherwise leave an orphan row that handed the buyer the paid asset for free. Free purchases and owners are unaffected.
- Marketplace purchases (#8636): the paid-purchase flow (idempotency-gate row + buyer balance deduction + buyer/seller credit-transactions + download-count increment) now runs as ONE atomic `neonSql.transaction([...])` instead of separately-committed statements. A crash mid-flow could previously leave the buyer charged with no deduction row — permanently denying the download gate while the orphan purchase row turned every retry into a 409 (paid, but can never download). The whole charge is gated in SQL on the buyer being solvent right now, so a partial charge is impossible, and a pre-fix orphan purchase row is now recoverable on retry.
