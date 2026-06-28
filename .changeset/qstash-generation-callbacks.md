---
"web": patch
---

feat(generation): durable server-side generation callbacks via Upstash QStash (PF-906, #8816)

Adds an env-guarded, dormant-by-default durable completion path for async asset generation (Meshy/Suno/Replicate). When `QSTASH_TOKEN` is set, each async generate route publishes a self-rescheduling QStash callback that polls the provider and finalizes the `generation_jobs` row + issues the refund-on-failure server-side — so a failed/timed-out/empty job is refunded even if the user closed the tab. When unset, the existing client poller is the only path and behavior is unchanged. Refund stays idempotent, so the durable and client paths never double-credit.
