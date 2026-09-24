# Incident Response — Single-Owner Runbook

> **Last updated:** 2026-09-24

## Status

**There is no paging service and no on-call rotation, by decision.** See
`docs/decisions/2026-09-24-no-paging-or-on-call.md`. SpawnForge is a
single-owner project: there is no PagerDuty, no Opsgenie, no rotation, and no
Primary/Secondary escalation. An earlier version of this ticket (#7710 /
PF-168) proposed exactly that; the owner closed that direction on 2026-09-24.

Production errors and health-check failures reach the owner only through
whatever notification the Sentry project (`tristan-nolan` / `spawnforge-ai`)
is configured to send from its own dashboard settings. This repository cannot
prove what that configuration currently is — Sentry alert-rule actions and
notification routing are dashboard state, not code — so this document does
not claim a specific channel or destination exists. If you need to know what
actually fires today, check the Sentry project's **Alerts → Alert Rules** and
**Settings → Notifications** directly.

If this ever changes (a second engineer joins, a paging tool is provisioned),
that is a new decision and gets its own ADR — do not add paging or rotation
language back into this file without one.

## Severity Model (Response Expectations)

This reuses the canonical P0/P1/P2 labels from `docs/production-support.md`,
`docs/operations/monitoring-setup.md` and `docs/sentry-alert-rules.md`, but
here they describe **what to look at first and what "done" means**, not an
escalation or paging tier — there is nothing to escalate to.

| Severity | What it means | What to do |
|----------|---------------|-------------|
| **P0** | Site unreachable, DB down, auth broken, revenue-path (Stripe) broken | Stop other work. Confirm via `/api/health`, then work the matching runbook in `docs/production-support.md` § 5 (Runbooks) or `docs/operations/incident-runbook.md`. Consider `docs/operations/deploy-migration-rollback.md` if a deploy or migration is the suspect. |
| **P1** | A core feature degraded (AI generation failing, elevated 5xx) but the site is otherwise up | Confirm via Sentry issue volume and `/api/health`'s per-service report. Fix or roll back; no immediate drop-everything response required. |
| **P2** | Non-critical: rate-limit pressure, CDN cache-hit rate low, elevated warnings | Triage when convenient. File or update a ticket; does not need same-day action. |

Thresholds, where they already exist, are defined once in
`docs/production-support.md` (§ 12, Sentry Configuration Reference) — this
document does not restate or invent new ones.

## First Response, By Surface

Start here regardless of severity — these are the real, checkable surfaces in
this repository:

1. **`/api/health`** (`web/src/app/api/health/route.ts`) — per-service status.
   `curl -sS https://spawnforge.ai/api/health | python3 -m json.tool`. Only DB
   and Clerk-auth failures return HTTP 503; everything else can be degraded
   under a 200.
2. **The synthetic health monitor** (`GET /api/cron/health-monitor`) — runs
   every ~15 minutes against production and reports non-healthy services to
   Sentry. Its activation state and known gaps are tracked separately in
   `docs/guides/health-monitor-cron.md` — read that before trusting its
   silence as "all healthy".
3. **Sentry** (org `tristan-nolan`, project `spawnforge-ai`) — search
   Issues for the affected time window; check the fingerprint groups defined
   in `web/src/lib/monitoring/sentryConfig.ts` and documented in
   `docs/sentry-alert-rules.md`.
4. **Vercel logs** (`vercel logs <deployment-url> --since 1h`, or the Vercel
   dashboard) — request-level detail Sentry does not carry.
5. **`gh run list --workflow=cd.yml --limit=5`** and `label:ci-failure`
   issues — an automated rollback, a red security-alerts cron, or a
   post-deploy smoke failure all file or comment on an issue with that label
   (see `docs/production-support.md` § 11, "Where automated failures land").

## Mitigation

- **Site/DB/auth down, or a bad deploy is suspected:** work
  `docs/operations/incident-runbook.md`'s Recovery Procedures, or the matching
  runbook in `docs/production-support.md` § 5.
- **Rollback needed:** `docs/operations/incident-runbook.md` § Rollback
  Procedure (Vercel Instant Rollback), or, if a database migration already
  applied and rolling back code alone is not enough,
  `docs/operations/deploy-migration-rollback.md`.
- **Data loss suspected:** `docs/operations/backup-recovery.md` (Neon
  point-in-time recovery).

## Resolution

- Confirm `/api/health` reports normally and the specific Sentry issue stops
  recurring.
- For a P0 or P1, write a short note of what happened and why — this project
  has no formal postmortem process; a paragraph in the closing ticket or PR is
  sufficient.

## If You Are Not the Owner

You do not have paging access or an escalation path to reach the owner faster
than any other channel they check. Do not assume a page will bring a response
within minutes — none is configured. If you are filing an issue or a PR about
an incident, state severity using the table above and link the Sentry issue
or `/api/health` output you used to determine it; that is what lets the owner
triage asynchronously.
