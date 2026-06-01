---
"web": patch
---

Make token refunds idempotent under concurrency. `refundTokens` and `refundTokenAmount` guarded their refund INSERT with `WHERE NOT EXISTS`, a READ COMMITTED snapshot check rather than a lock, so two concurrent refunds for the same usage could both credit the user. The refund INSERTs now use a UNIQUE partial index plus `ON CONFLICT DO NOTHING`, so the credit fires exactly once even under concurrent retries.
