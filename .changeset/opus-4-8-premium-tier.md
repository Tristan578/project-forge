---
"web": minor
---

ai: bump the premium/deep model tier from Opus 4.7 to Opus 4.8.

`AI_MODEL_PREMIUM` / `GATEWAY_MODEL_PREMIUM` (and the `AI_MODEL_DEEP` / `GATEWAY_MODEL_DEEP` aliases that follow them) now resolve to `claude-opus-4-8`, so the premium chat path and the deep-generation tier (GDD, world builder, cutscene — gated behind `NEXT_PUBLIC_USE_DEEP_GENERATION`) route to Opus 4.8. Same `$5/$25` per-1M pricing and 1M context as 4.7; no API or env changes.

Also updates the Vercel AI Gateway `MODEL_MAP` key so the gateway premium lookup resolves the new id (a stale key would have silently downgraded the premium path to Sonnet *after* billing at the premium tier).
