---
"web": patch
---

Stop silently discarding explicit zeros in numeric defaults (#8938). A tutorial step declaring `delay: 0` ("advance immediately") waited 500ms instead. Audio and SFX generation requested with `durationSeconds: 0` were quietly rewritten to the 30s/5s defaults, even though the API routes deliberately pass an explicit `0` through — so the two layers disagreed and the caller was billed for an asset of a length they did not ask for. A HUD text element with a zero or negative `fontSize` now falls back to the default rather than emitting invalid CSS the browser discards. `@typescript-eslint/prefer-nullish-coalescing` is enabled so the `||`-treats-0-as-missing pattern cannot come back.
