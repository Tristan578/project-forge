---
name: architect-flow
description: Spec-first architecture workflow for SpawnForge features. Use when planning new features, designing multi-system changes, or asked "how should we build X?" — produces a spec in specs/ before any code is written.
paths: "specs/**"
---

# Architect Flow Protocol

Before writing code, draft `specs/<feature-name>.md` (the project is spec-first). The spec defines the JSON event schema (Rust <-> TS), the Bevy systems required, and the React components required, and lists the open questions that matter for this feature — typically edge cases, state ownership, and performance.

Share the spec path with the user and wait for their approval before implementing.
