# No paging service, no on-call rotation

- **Date:** 2026-09-24
- **Status:** Accepted
- **Context:** #7710 / PF-168 (proposed PagerDuty + a weekly on-call rotation); closed by owner decision 2026-09-24

## Decision

SpawnForge will not stand up a paging service (PagerDuty, Opsgenie, or
equivalent) or an on-call rotation. This is a single-owner project. Production
alerts are handled by the owner directly, from whatever notifications the
Sentry project (`tristan-nolan` / `spawnforge-ai`) is configured to send, plus
the synthetic health monitor (`GET /api/cron/health-monitor`,
`docs/guides/health-monitor-cron.md`) reporting non-healthy services to
Sentry. There is no Primary/Secondary rotation, no escalation policy, and no
"page fires within N minutes" guarantee.

## Context

Issue #7710 (PF-168) asked for a documented weekly on-call rotation, a
PagerDuty escalation policy (Primary → Secondary after 15 minutes → Engineering
lead after a further 15 minutes), and Sentry-wired alert routing to that
pager. That story assumes a multi-engineer team. It does not — this project
has had exactly one contributor across the sessions that kept revisiting this
ticket, and every prior attempt to write the rotation doc ran into the same
problem: there is no second person to be Secondary, and no service to page
either of them with. Writing the rotation anyway would have described
something that does not exist as though it did, which is exactly what
`.claude/rules/lessons-learned.md` #17 exists to prevent.

## Consequences

- `docs/operations/incident-response.md` replaces the on-call-rotation
  document originally scoped by #7710. It documents the severity model as
  response expectations only, and first-response steps against real repo
  surfaces (`/api/health`, the health-monitor cron, Sentry, Vercel logs,
  existing runbooks) — no escalation, no paging.
- `docs/operations/incident-runbook.md`, `docs/operations/monitoring-setup.md`,
  `docs/sentry-alert-rules.md` and `docs/production-support.md` must not
  describe paging, an on-call rotation, or escalation to a Secondary as
  existing or planned. Where they previously said "Page on-call" or similar,
  they now say "notify" and point at this ADR or at
  `docs/operations/incident-response.md`.
- A mention of paging or on-call inside this ADR, inside
  `docs/operations/incident-response.md`'s own "Status" section, or inside
  `.claude/rules/lessons-learned.md`'s history of this exact mistake is not a
  violation of the decision — those are the record of the decision, not a
  claim that paging exists.
- **Reopening this decision requires a new ADR**, not an edit to this one —
  written when a second engineer actually joins and a paging tool is actually
  provisioned, not in anticipation of either.

## References

- `docs/operations/incident-response.md` — the resulting runbook
- `.claude/rules/lessons-learned.md` #17 — "Do not assert facts about the
  OPERATING environment you did not check"
- `docs/guides/health-monitor-cron.md` — the one automated detector that does
  exist
