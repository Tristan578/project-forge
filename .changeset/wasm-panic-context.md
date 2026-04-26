---
"web": patch
---

Enrich WASM panic capture with editor state context. When the engine panics, Sentry now receives entity count, current selection, undo/redo flags, engine mode, and the last 20 dispatched commands alongside the stack trace — enough context to diagnose state-dependent crashes like #8462 from a single report. Each engine command also leaves a Sentry breadcrumb.
