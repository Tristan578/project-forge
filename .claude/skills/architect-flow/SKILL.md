---
name: architect-flow
description: Use this skill when the user requests a new feature, a complex refactor, or asks "how should we build X?". It enforces a specification-driven workflow.
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
