---
"web": patch
---

Stop `/api/health` reporting green on key presence alone (#9719). "AI Providers" is now `degraded` — naming the unconfigured capabilities in a public-safe `summary` — whenever a chat backend resolves but any generation capability has neither a platform key nor a gateway route, and `healthy` only when every capability is configured. "Payments (Stripe)" performs one credit-free authenticated `GET /v1/balance` (Stripe's documented Retrieve balance) with a 3s timeout and reports real latency: `degraded` on an auth failure, 5xx, timeout or network error; `down` only when the key is unset. The capability-to-env-var table moves into `lib/config/providers` (`CAPABILITY_ENV_VARS`) and is shared by `/api/capabilities` and the probe.
