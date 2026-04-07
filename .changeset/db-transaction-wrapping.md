---
"web": patch
---

Use atomic UPDATE...WHERE...RETURNING guards to eliminate TOCTOU race conditions in token deductions. Add CTE-based idempotency guards for refund operations with accurate return semantics. Fix `||` vs `??` for priceTokens default in marketplace route.
