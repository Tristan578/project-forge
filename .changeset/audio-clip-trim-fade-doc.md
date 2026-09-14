---
"web": minor
---

Add a native, editable audio clip document. An imported or generated sound can now be trimmed, gained, faded in/out and given loop bounds directly in the Audio inspector, with sample-accurate timing, per-field validation, and undo/redo. Edits are stored as a small reversible document and never touch the source asset's bytes, so the same clip renders, plays and exports identically. The clip document persists in the scene manifest without changing how older scenes load.
