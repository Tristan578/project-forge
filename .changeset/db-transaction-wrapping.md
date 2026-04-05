---
"spawnforge": patch
---

Wrap credit/token DB mutations in neonSql.transaction to eliminate TOCTOU race conditions. Add CTE-based idempotency guards for refund operations. Fix `||` vs `??` for priceTokens default in marketplace route.
