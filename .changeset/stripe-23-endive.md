---
"web": patch
---

Upgrade the Stripe SDK from 22.6.2 to 23.1.0 and move SpawnForge's pinned Stripe API version from `2026-08-26.dahlia` to `2026-10-28.endive`, the version 23.1.0 types against. None of Endive's breaking changes touch the calls SpawnForge makes: checkout sessions don't send `payment_method_types`, nothing sends `billing_cycle_anchor`, and the Radar hold check reads `review` and `outcome.type`, not Payment Evaluation scores. Webhook payloads still follow the Dashboard endpoint's own API version, and the `invoice.paid` handler keeps reading both subscription shapes.
