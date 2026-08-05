---
"web": minor
---

Add Sentry profiling and business metrics for the generation surface.

Profiling is wired across the Node server and browser runtimes (`profileLifecycle: 'trace'`, sampled at 10% in production), with the `Document-Policy: js-profiling` header enabling the browser profiler.

`/api/generate/*` now emits three business metrics through the shared handler factory — request volume faceted by outcome, end-to-end latency, and tokens actually charged on success. All metric emission fails open so observability can never take down the generate routes.
