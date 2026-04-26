---
"web": minor
---

Add Opus 4.7 deep-generation tier behind `NEXT_PUBLIC_USE_DEEP_GENERATION` flag. When enabled, GDD, world-builder, and cutscene generators route to `claude-opus-4-7` for higher-fidelity output. Default off. Every call emits `ai_deep_generation_eval` to PostHog for A/B analysis. Decision memo: `docs/decisions/2026-05-01-opus-deep-tier.md`.
