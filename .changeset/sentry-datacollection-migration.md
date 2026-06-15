---
'web': patch
---

Migrate Sentry off the deprecated `sendDefaultPii: false` to the `dataCollection` framework (bump `@sentry/nextjs` 10.55→10.57; `sendDefaultPii` is `@deprecated` in 10.57 and removed in v11). The replacement object is **exhaustive** in all three configs (server, edge, client) — once any `dataCollection` key is set, Sentry falls back to permissive DEFAULTS for every omitted field, so a partial object would silently re-enable PII. Every field is opted out, which is equivalent-or-stricter than the legacy false path (cookies/queryParams/headers go from PII deny-list to fully off; `stackFrameVariables` goes `true`→`false`, finally expressing the F04 "no stack-frame locals" intent in a first-class control). Preserves the F03/F04 audit posture; `scrubSentryEvent` remains as defence-in-depth.
