# Sentry Alert Rules — SpawnForge

This document defines the recommended Sentry alert rules for the SpawnForge
production environment. Actual rules must be created in the Sentry dashboard
(Organization: `tristan-nolan`, Project: `spawnforge-ai`).

Fingerprinting must be enabled first — see
`web/src/lib/monitoring/sentryConfig.ts`. The rules below reference the
fingerprint groups and tags set by that module.

---

## Alert Priority Levels

| Level | SLA | Channel | Meaning |
|-------|-----|---------|---------|
| P1 | Page immediately (< 5 min) | PagerDuty + Slack #incidents | Production revenue or auth is broken |
| P2 | Alert in 15 min | Slack #alerts | Core AI feature degraded |
| P3 | Daily digest | Slack #monitoring | Trending issues, no immediate action needed |

---

## P1 — Page Immediately

### 1. Auth failures spike
**Trigger:** Issue count for fingerprint `auth-error` > 10 in a 1-minute window.
**Why P1:** Auth failures at this rate typically mean our Clerk integration,
Neon DB, or Stripe webhook is down — users cannot log in or pay.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `fingerprint:auth-error` |
| Threshold | > 10 per minute |
| Action | PagerDuty + Slack #incidents |

### 2. Payment webhook failures
**Trigger:** Any error in `/api/stripe/*` routes over the last 5 minutes.
**Why P1:** Failed webhooks silently break subscription upgrades and can cause
revenue loss and double-charges.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `url:*/api/stripe/*` |
| Threshold | > 0 per 5 minutes |
| Action | PagerDuty + Slack #incidents |

---

## P2 — Alert in 15 Minutes

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
| Action | Slack #alerts — include `ai_provider` tag in message |
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
| Action | Slack #alerts — include `wasm_command` tag in message |

### 5. AI generation failure rate spike
**Trigger:** Issue count for fingerprint `generation-failure` > 10 in a
10-minute window.
**Why P2:** Generation routes call external providers (Meshy, ElevenLabs,
Suno, DALL-E). A spike means one provider is down, quota is exhausted, or
content safety is triggering too aggressively.

| Field | Value |
|-------|-------|
| Metric | `issue.count` |
| Filter | `fingerprint:generation-failure` |
| Threshold | > 10 per 10 minutes |
| Action | Slack #alerts — include `generation_type` tag |

---

## P3 — Daily Digest

### 6. Rate limit hits trending up (weekly)
**Trigger:** 7-day volume for fingerprint `rate-limit-exceeded` increases by
more than 25 % week-over-week.
**Why P3:** A gradual increase in rate limit hits is expected as the product
grows. A sudden 25 %+ spike might indicate a scripted abuse pattern or a
poorly-tuned limit that needs to be raised for legitimate users.

| Field | Value |
|-------|-------|
| Metric | 7-day issue count |
| Filter | `fingerprint:rate-limit-exceeded` |
| Threshold | > 25 % WoW increase |
| Action | Daily digest email + Slack #monitoring |

### 7. Error rate above baseline (catch-all)
**Trigger:** Total unhandled error count exceeds a rolling 7-day average by
> 50 % in a 1-hour window.
**Why P3:** Acts as a backstop for any error class that does not match a
specific fingerprint rule.

| Field | Value |
|-------|-------|
| Metric | Total `issue.count` |
| Filter | (none — all errors) |
| Threshold | > 150 % of 7-day rolling average, evaluated hourly |
| Action | Slack #monitoring |

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
5. Configure the **Action** — PagerDuty integration for P1, Slack webhook for P2/P3.
6. Set the **Environment** to `production` for all P1/P2 rules.
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

- Review P3 thresholds quarterly as traffic grows.
- If a new AI provider is added, verify `extractProvider()` in `sentryConfig.ts`
  recognises its name before going to production.
- After any major release that changes error patterns, check the P2 thresholds
  have not become too sensitive (false-positive pages are expensive to team trust).
