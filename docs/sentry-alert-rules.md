# Sentry Alert Rules — SpawnForge

This document defines the recommended Sentry alert rules for the SpawnForge
production environment. Actual rules must be created in the Sentry dashboard
(Organization: `tristan-nolan`, Project: `spawnforge-ai`).

Fingerprinting must be enabled first — see
`web/src/lib/monitoring/sentryConfig.ts`. The rules below reference the
fingerprint groups and tags set by that module.

---

## Alert Priority Levels

There is no paging service and no on-call rotation — see
`docs/decisions/2026-09-24-no-paging-or-on-call.md` and
`docs/operations/incident-response.md`. "Action" below means notifying the
owner, not paging one; channel names indicate which Sentry-to-Slack mapping
would carry the notification if one is configured — this document does not
assert that mapping exists.

| Level | SLA | Channel | Meaning |
|-------|-----|---------|---------|
| P0 | Notify immediately (< 5 min) | `#incidents`, if configured in Sentry | Production revenue or auth is broken |
| P1 | Notify (< 5 min), no page | `#incidents`, if configured in Sentry | Core AI feature degraded / elevated 5xx |
| P2 | Alert / daily digest | `#engineering-alerts`, if configured in Sentry | Trending issues, no immediate action |

---

## P0 — Notify Immediately

### 1. Auth failures spike
**Trigger:** Issue count for fingerprint `auth-error` > 10 in a 1-minute window.
**Why P0:** Auth failures at this rate typically mean our Clerk integration,
Neon DB, or Stripe webhook is down — users cannot log in or pay.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `fingerprint:auth-error` |
| Threshold | > 10 per minute |
| Action | Notify the owner via `#incidents`, if configured in Sentry |

### 2. Payment webhook failures
**Trigger:** Any error in `/api/stripe/*` routes over the last 5 minutes.
**Why P0:** Failed webhooks silently break subscription upgrades and can cause
revenue loss and double-charges.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `url:*/api/stripe/*` |
| Threshold | > 0 per 5 minutes |
| Action | Notify the owner via `#incidents`, if configured in Sentry |

---

## P1 — Notify (No Page)

### 5. AI generation failure rate spike
**Trigger:** Issue count for fingerprint `generation-failure` > 10 in a
10-minute window.
**Why P1:** Generation routes call external providers (Meshy, ElevenLabs,
Suno, DALL-E). A spike means one provider is down, quota is exhausted, or
content safety is triggering too aggressively.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `fingerprint:generation-failure` |
| Threshold | > 10 per 10 minutes |
| Action | Notify the owner (`#incidents`, if configured in Sentry; no page) — include `generation_type` tag |

---

## P2 — Notify / Daily Digest

### 3. AI provider down (timeout rate spike)
**Trigger:** Issue count for fingerprint `ai-provider-timeout` > 5 in any
5-minute window AND the last occurrence is within the past 5 minutes.
**Why P2:** Sustained timeouts mean the AI chat is broken for all users on the
affected provider. Failover should be considered immediately.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `fingerprint:ai-provider-timeout` |
| Threshold | > 5 per 5-minute window |
| Action | Notify the owner via `#engineering-alerts`, if configured in Sentry — include `ai_provider` tag in message |
| Note | Create one rule per provider by filtering `tags[ai_provider]` for finer routing |

### 4. WASM panic rate
**Trigger:** Issue count for fingerprint `wasm-command-failure` > 1 per minute.
**Why P2:** WASM panics crash the editor for affected users and require a
session reload. A rate above 1/min suggests a systematic regression, not a
one-off user action.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `fingerprint:wasm-command-failure` |
| Threshold | > 1 per minute |
| Action | Notify the owner via `#engineering-alerts`, if configured in Sentry — include `wasm_command` tag in message |

### 6. Rate limit hits trending up (weekly)
**Trigger:** 7-day volume for fingerprint `rate-limit-exceeded` increases by
more than 25 % week-over-week.
**Why P2:** A gradual increase in rate limit hits is expected as the product
grows. A sudden 25 %+ spike might indicate a scripted abuse pattern or a
poorly-tuned limit that needs to be raised for legitimate users.

| Field | Value |
|-------|-------|
| Metric | 7-day issue count |
| Filter | `fingerprint:rate-limit-exceeded` |
| Threshold | > 25 % WoW increase |
| Action | Daily digest email + `#engineering-alerts`, if configured in Sentry |

### 7. Error rate above baseline (catch-all)
**Trigger:** Total unhandled error count exceeds a rolling 7-day average by
> 50 % in a 1-hour window.
**Why P2:** Acts as a backstop for any error class that does not match a
specific fingerprint rule.

| Field | Value |
|-------|-------|
| Metric | Total `issue.count` |
| Filter | (none — all errors) |
| Threshold | > 150 % of 7-day rolling average, evaluated hourly |
| Action | Notify the owner via `#engineering-alerts`, if configured in Sentry |

---

## How to Create Rules in the Dashboard

1. Navigate to **Alerts → Alert Rules → Create Alert Rule** in the
   [Sentry project](https://sentry.io/organizations/tristan-nolan/projects/spawnforge-ai/).
2. Select **Issues** as the alert type.
3. Set the **Filter** using Sentry's issue query syntax.
   - Fingerprint filter: `issue.fingerprint:"rate-limit-exceeded"` (exact match)
   - Tag filter: `tags[ai_provider]:anthropic`
   - URL filter: `url:*/api/stripe/*`
4. Set the **Threshold** and **Time Window** as specified above.
5. Configure the **Action** — a Slack webhook, if one is configured for this
   project, for every tier. There is no paging integration to configure; see
   `docs/decisions/2026-09-24-no-paging-or-on-call.md`.
6. Set the **Environment** to `production` for all P0/P1 rules.
7. Assign the rule to the **Engineering** team.

---

## Fingerprint Reference

These fingerprints are set by `web/src/lib/monitoring/sentryConfig.ts`:

| Fingerprint | Tags Set | Description |
|-------------|----------|-------------|
| `['rate-limit-exceeded']` | `error_class: rate_limit` | Any 429 / rate limit response |
| `['auth-error', '<code>']` | `error_class: auth`, `auth_code` | Auth/token failures, grouped by error code |
| `['wasm-command-failure', '<command>']` | `error_class: wasm`, `wasm_command` | WASM engine command panics |
| `['generation-failure', '<type>']` | `error_class: generation`, `generation_type` | AI asset generation failures |
| `['ai-provider-timeout', '<provider>']` | `error_class: timeout`, `ai_provider` | Provider timeout / socket hang |
| `['ai-provider-error', '<provider>', '<ExceptionType>']` | `error_class: ai_provider`, `ai_provider` | Generic provider errors |

---

## Maintenance

- Review P2 thresholds quarterly as traffic grows.
- If a new AI provider is added, verify `extractProvider()` in `sentryConfig.ts`
  recognises its name before going to production.
- After any major release that changes error patterns, check the P1 thresholds
  have not become too sensitive (false-positive notifications are noisy and
  erode trust in the alerts — there is no paging cost, but a noisy channel
  still gets ignored).
