# Incident Detected — Initial Alert Template

> Use this template within **15 minutes** of detecting a P0 or P1 incident.
> Post to: the #incidents Slack channel, if one is configured. There is no manually updated status page; https://spawnforge.ai/health shows live service status on its own.

---

## [INCIDENT] {TITLE} — {SEVERITY}

**Status:** Investigating
**Severity:** {P0 / P1 / P2}
**Detected at:** {YYYY-MM-DD HH:MM UTC}
**Incident Commander:** {NAME}
**Bridge channel:** #{SLACK_INCIDENT_CHANNEL}

---

### What is affected?

<!-- List affected services and features. Be specific — users need to know if THEY are impacted. -->

| Service | Status | User Impact |
|---------|--------|-------------|
| {service_name} | Degraded / Down | {user-facing description} |

**Affected users:** {All users / Subset — describe who}

---

### What do we know so far?

<!-- Brief 2-3 sentence summary. Do not speculate. Only state confirmed facts. -->

{DESCRIPTION OF WHAT IS KNOWN}

---

### What are we doing?

We are actively investigating. Next update in **{15 / 30} minutes** or when we have more information.

---

### Who should I contact?

Updates will be posted here as they happen. SpawnForge is run by a single owner, so there is no one else to contact directly; https://spawnforge.ai/health shows live service status.

Live service status (updates automatically from the health checks): https://spawnforge.ai/health

---

## Internal Notes (not for publication)

**Incident ID:** INC-{YYYYMMDD}-{N}
**Alert triggered by:** {monitoring alert / user report / owner observation}
**Responder:** {NAME} (the project owner; there is no one to escalate to)

### Timeline

| Time (UTC) | Event |
|------------|-------|
| {HH:MM} | Incident detected |
| {HH:MM} | {NAME} begins investigation |

### Current hypotheses

1. {hypothesis}
2. {hypothesis}

### Actions taken

- [ ] {action}
- [ ] Notify the project owner (no on-call/paging service — see `docs/operations/incident-response.md`)
- [ ] Confirm https://spawnforge.ai/health reflects the incident
- [ ] Open incident bridge channel
