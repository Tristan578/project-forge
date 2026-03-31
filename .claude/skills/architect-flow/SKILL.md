---
name: architect-flow
description: Spec-first architecture workflow for SpawnForge features. Use when planning new features, designing multi-system changes, or asked "how should we build X?" — produces a spec in specs/ before any code is written.
paths: "specs/**"
---

# Architect Flow Protocol

When triggered, you must refuse to write code immediately. Follow these steps:

1. **Analysis:** Ask 3 critical questions about the feature (Edge cases? State management? Performance?).
2. **Drafting:** Generate a markdown file in `specs/` (e.g., `specs/feature-name.md`).
   - Define the JSON Event Schema (Rust <-> TS).
   - Define the Bevy Systems required.
   - Define the React Components required.
3. **Review:** Output the file path and ask: "Does this spec match your vision?"
4. **Handoff:** Only after the user says "Approved" do you proceed to coding.
