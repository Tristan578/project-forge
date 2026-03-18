# Incident Detected — Initial Alert Template

> Use this template within **15 minutes** of detecting a P0 or P1 incident.
> Post to: #incidents Slack channel + status page update.

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

Do not contact individual engineers directly. Monitor this channel and the status page for updates.

Status page: https://status.spawnforge.ai

---

## Internal Notes (not for status page)

**Incident ID:** INC-{YYYYMMDD}-{N}
**Alert triggered by:** {monitoring alert / user report / engineer observation}
**First responder:** {NAME}
**Escalated to:** {NAME or N/A}

### Timeline

| Time (UTC) | Event |
|------------|-------|
| {HH:MM} | Incident detected |
| {HH:MM} | {first responder} begins investigation |

### Current hypotheses

1. {hypothesis}
2. {hypothesis}

### Actions taken

- [ ] {action}
- [ ] Alert on-call engineer
- [ ] Post status page update
- [ ] Open incident bridge channel
