---
"web": patch
---

Add a flag-gated generation agent loop (USE_GENERATION_AGENT) that wraps the
createGenerationHandler provider call with deterministic step + wall-clock
timeout caps, reducing the single-point-of-failure risk behind all
/api/generate/* routes. Default off; response contract (incl. usageId and the
provider-success-with-no-artifact -> failed mapping) is preserved byte-for-byte.
