---
"web": patch
"@spawnforge/docs": patch
---

Publish `docs/capability-matrix.md` — one row per generation capability and per MCP command category, with a proven / implemented-unverified / partial / unavailable / excluded status for the editor UI, the in-app AI, game scripts and external MCP — and retire the README's "every capability is controllable via MCP" claim in favour of measured counts that link to it. Web: `capabilityMatrix.test.ts` fails when a `PROVIDER_CAPABILITIES` entry or a manifest category has no row, a cell is not one of the five statuses, or the docs-site copy drifts. Docs: the matrix is rendered at `/capability-matrix` from an in-root copy, and `known-limitations.md` is reconciled with it (dated 2026-09-05).
