---
"web": patch
---

The platform Anthropic key can now come from Anthropic Workload Identity Federation instead of the long-lived `ANTHROPIC_API_KEY`. With `ANTHROPIC_WIF_FEDERATION_RULE_ID`, `ANTHROPIC_WIF_ORGANIZATION_ID` and `ANTHROPIC_WIF_SERVICE_ACCOUNT_ID` all set, the server exchanges its Vercel OIDC token for a short-lived Anthropic token and uses it for direct-backend chat and for the localization and pacing generators. Any failed exchange is reported to Sentry and falls back to `ANTHROPIC_API_KEY`. With any of the three unset nothing changes and no extra network call is made. A partial configuration logs a startup warning. Setup: `docs/guides/anthropic-wif-setup.md`.
