---
"web": patch
---

feat(analytics): server-side LLM observability via PostHog `$ai_generation` (PF-907, #8817)

Adds an env-guarded, dormant-by-default, consent-gated server capture of PostHog `$ai_generation` events on the three routes that run a model server-side (`/api/chat`, `/api/generate/localize`, `/api/generate/pacing`), powering PostHog's per-generation cost/token/latency/model/error dashboards. Capture is a dependency-free `fetch` (no `posthog-node`, no OTel span processor) fired via `after()`, and is **private by construction** — it never sends the content fields `$ai_input` / `$ai_output_choices`, only non-content metrics. Fully dormant unless `POSTHOG_LLM_CAPTURE === "true"` AND a project key is set; independently suppressed unless the user consented to analytics (PF-30, via a new server-readable `forge-cookie-consent` cookie). No behavior change when dormant.
