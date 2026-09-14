---
"web": minor
---

Add the shared validator foundation for intentional game completion modes. The pre-play/verify winnability gate now accepts an (internal-only) `completionMode` — `win`, `endless`, `sandbox`, or `narrative` — and, for `endless`/`sandbox`/`narrative`, no longer demands a win condition, while still fully validating any win condition that IS present in every mode. The human Play button, the AI play action, and orchestrator verification all read this one field, so they gate identically. No scene sets the mode in this release: there is no manual control or AI operation that authors it yet, so every scene reads `undefined` and keeps the classic `win` behavior unchanged. The creator- and AI-facing controls that choose a mode, and the persistence that saves it across reopen, land in a follow-up (#9998).
