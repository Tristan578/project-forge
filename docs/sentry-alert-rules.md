# Sentry Alert Rules

This document defines the recommended Sentry alert rules for SpawnForge.
Rules are grouped into three tiers based on user-impact and response urgency.

## Tier System

| Tier | Response SLA | Who Gets Paged |
|------|-------------|----------------|
| P1 (Critical) | 15 min | On-call engineer, PagerDuty |
| P2 (High) | 2 hours | Engineering Slack channel |
| P3 (Medium) | Next business day | Weekly triage queue |

---

## P1 — Critical Alerts (page immediately)

### P1-1: Auth failure spike
- **Condition:** Issue `auth-error` event count > 50 in a 5-minute window
- **Fingerprint match:** `auth-error *`
- **Why P1:** Users cannot log in or access their projects — immediate revenue impact.
- **Actions:** Page on-call. Check Clerk status page. Check `/api/auth` 5xx rate in Vercel logs.

### P1-2: WASM engine crash (high volume)
- **Condition:** Issue `wasm-command-failure` event count > 100 in a 10-minute window
- **Fingerprint match:** `wasm-command-failure *`
- **Why P1:** Engine is core product. High-volume crashes mean the editor is broken for all users.
- **Actions:** Check CDN (`engine.spawnforge.ai`) for stale WASM binary. Roll back engine CDN if needed.

### P1-3: Payment / billing error
- **Condition:** Any new issue matching `stripe` or `billing` in the title, severity >= error
- **Why P1:** Failed charges result in direct revenue loss and user churn.
- **Actions:** Check Stripe dashboard for webhook failures. Inspect `/api/billing` logs.

---

## P2 — High-Priority Alerts (resolve within 2 hours)

### P2-1: AI provider error rate elevated
- **Condition:** Issue `ai-provider-error <provider>` event count > 20 in a 15-minute window, per provider
- **Fingerprint match:** `ai-provider-error *`
- **Why P2:** AI generation is a key paid feature. Provider outages degrade the experience but are usually temporary.
- **Actions:** Check provider status pages. Verify circuit-breaker state in production logs (`/api/chat`, `/api/generate/*`).
- **Separate alert per provider:** anthropic, openai, meshy, elevenlabs, suno.

### P2-2: Rate-limit error spike
- **Condition:** Issue `rate-limit-error` event count > 30 in a 5-minute window
- **Fingerprint match:** `rate-limit-error`
- **Why P2:** Could indicate an abusive client, misconfigured limits, or a legitimate traffic spike that needs capacity review.
- **Actions:** Identify top IP/user from Sentry tags. Check Upstash Redis quota. Adjust rate-limit thresholds if needed.

### P2-3: Generation failure rate elevated
- **Condition:** Issue `generation-failure *` event count > 15 in a 10-minute window
- **Fingerprint match:** `generation-failure *`
- **Why P2:** Asset generation failures affect paid users directly.
- **Actions:** Check per-provider generation route logs. Verify API keys are active. Check response-time distributions for timeouts.

### P2-4: New unhandled exception (any)
- **Condition:** A brand-new issue (first seen < 1 hour ago) with severity = error and event count > 5 in 10 minutes
- **Why P2:** A freshly shipped regression before it affects many users.
- **Actions:** Identify the release tag on the issue. Roll back if the release is < 1 hour old.

---

## P3 — Medium-Priority Alerts (weekly triage)

### P3-1: WASM command failure (low volume)
- **Condition:** Issue `wasm-command-failure *` event count 10–100 in a 24-hour window
- **Fingerprint match:** `wasm-command-failure *`
- **Why P3:** Low-volume command failures are usually edge-case usage. Track for trends.
- **Actions:** Add to weekly triage. Identify which command type is failing. File a ticket if reproducible.

### P3-2: Auth error (low volume)
- **Condition:** Issue `auth-error *` event count 5–50 in a 24-hour window
- **Why P3:** Small numbers of auth errors are expected (expired tokens, bad requests). Spike threshold is P1.
- **Actions:** Review error codes. Flag if `invalid_token` or `token_expired` codes are rising.

### P3-3: Generation failure (low volume)
- **Condition:** Issue `generation-failure *` event count 5–15 in a 24-hour window
- **Why P3:** Occasional generation failures are expected (network flakiness, provider blips).
- **Actions:** Track trend over time. If one generation type accounts for > 80% of failures, investigate that provider.

### P3-4: Performance regression
- **Condition:** Any transaction with p95 latency > 5 seconds that was previously < 2 seconds
- **Why P3:** UX degrades gradually — important to catch before it becomes user-reported.
- **Actions:** Profile with Sentry Performance. Check Vercel function duration charts.

### P3-5: Replay error rate
- **Condition:** Error rate in replay sessions > 15% in a 24-hour window
- **Why P3:** High error rates in recorded sessions indicate widespread UX breakage.
- **Actions:** Watch replays for the top 3 issues. Prioritise fixes accordingly.

---

## Fingerprint Reference

The fingerprinting rules in `web/src/lib/monitoring/sentryConfig.ts` produce these
fingerprint patterns. Use them to filter issues in Sentry or to target alert conditions.

| Pattern | Description |
|---------|-------------|
| `rate-limit-error` | Any HTTP 429 or rate-limit message, regardless of endpoint |
| `auth-error <code>` | Auth failure grouped by code: `401`, `403`, `unauthorized`, `forbidden`, `token_expired`, `invalid_token`, `auth_error` |
| `ai-provider-error <provider>` | AI API error grouped by provider slug: `anthropic`, `openai`, `google`, `meshy`, `elevenlabs`, `suno`, `replicate`, `stability` |
| `wasm-command-failure <type>` | Engine command failure grouped by command slug (e.g. `spawn_entity`, `update_material`) |
| `generation-failure <type>` | Asset generation failure grouped by type: `sprite`, `model`, `sfx`, `music`, `voice`, `texture`, `skybox`, `unknown` |

---

## Alert Configuration Notes

- All P1/P2 alerts should have **Slack integration** posting to `#engineering-alerts`.
- P1 alerts should additionally trigger **PagerDuty** for the on-call rotation.
- Set a **minimum event count of 2** on all rules to suppress one-off noise.
- Use **"first seen"** trigger (not "any event") for new-regression rules so alerts fire once per deployment, not per event.
- Attach the `release` tag to all alerts so engineers can immediately identify which deploy introduced the issue.
