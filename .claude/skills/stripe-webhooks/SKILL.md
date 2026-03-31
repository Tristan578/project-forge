---
name: stripe-webhooks
description: SpawnForge Stripe webhook patterns — idempotent refunds, CTE atomic claims, neonSql transaction ordering, token billing. Auto-loads when editing billing code.
user-invocable: false
paths: "web/src/lib/billing/**, web/src/app/api/webhooks/stripe/**"
---

# Stripe Webhook Patterns — SpawnForge

## Critical patterns (from real bugs)

### 1. Atomic CTE claim for refunds (PF-7514)
Never read `refundedCents` in JS then update in a separate query. Use a single CTE:
```sql
WITH old AS (SELECT id, refunded_cents, tokens, amount_cents FROM token_purchases WHERE id = $1)
UPDATE token_purchases SET refunded_cents = $2 FROM old
WHERE token_purchases.id = $1 AND old.refunded_cents < $2
RETURNING old.tokens, old.amount_cents, ($2 - old.refunded_cents) AS increment_cents
```
If 0 rows returned → concurrent request already claimed. Return immediately.

### 2. neonSql transaction ordering
INSERT audit record BEFORE UPDATE user balance — PostgreSQL sees prior statements' effects within `neonSql.transaction([...])`.

### 3. Idempotent refundTokens
Check `metadata->>'refundedUsageId'` before crediting. Without this, server + client both refunding the same failed job doubles credits.

### 4. Never use db.transaction()
neon-http driver throws. Use `getNeonSql()` → `neonSql.transaction([...statements])`.

## References
- See [references/billing-patterns.md](references/billing-patterns.md) for complete patterns
