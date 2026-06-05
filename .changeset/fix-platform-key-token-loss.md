---
"web": patch
---

Fix silent token loss when a platform API key is misconfigured. `resolveApiKey` now validates the platform key is present *before* deducting tokens, so a missing key (server misconfiguration) fails without charging the user for a call that can never run. The non-cached generation path also converts a non-`ApiKeyError` resolution failure into a structured 500 with Sentry capture, instead of re-throwing it as an uninstrumented unhandled rejection (#8597).
