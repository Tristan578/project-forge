---
"web": patch
---

Fix recordStepUsage hardcoding token source as 'monthly' -- now propagates the actual source (monthly/addon/mixed) from the reservation record for accurate audit trails.
