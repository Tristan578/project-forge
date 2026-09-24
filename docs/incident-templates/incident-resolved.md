# Incident Resolved — Resolution Template

> Use this template once the fix is deployed, validated, and the incident is confirmed closed.
> Post to: the #incidents Slack channel, if one is configured. Link to the tracking issue.

---

## [RESOLVED] {TITLE}

**Status:** Resolved
**Resolved at:** {YYYY-MM-DD HH:MM UTC}
**Duration:** {N hours N minutes} (detected {YYYY-MM-DD HH:MM UTC})
**Owner:** {NAME} (the project owner, who handles the incident end to end)

---

### Summary

{SERVICE_NAME} experienced {degraded performance / a complete outage / elevated error rates} for approximately **{N hours N minutes}** between **{HH:MM UTC}** and **{HH:MM UTC}**.

All affected services are now operating normally.

---

### What happened

<!-- Plain language. No jargon. What broke, why it broke, and how we fixed it. -->

{PLAIN_LANGUAGE_DESCRIPTION_OF_WHAT_HAPPENED}

---

### Impact

| Metric | Value |
|--------|-------|
| Duration | {N hours N minutes} |
| Affected users | {All / ~N users / Subset} |
| Affected features | {list} |
| Errors served | {N requests affected, or N/A} |
| Data loss | {None / describe if any} |

---

### What we are doing to prevent this from happening again

1. {prevention action — e.g., "Add alerting for X metric"}
2. {prevention action — e.g., "Add circuit breaker to Y service"}
3. {prevention action — e.g., "Improve runbook for Z scenario"}

A short write-up of what happened will be linked from the tracking issue.

---

### Thank you

We apologize for the disruption. Thank you for your patience while we resolved this issue.

If you are still experiencing problems, please contact support at support@spawnforge.ai.

Live service status (updates automatically from the health checks): https://spawnforge.ai/health

---

## Internal Notes (not for publication)

### Root cause (technical)

{DETAILED_TECHNICAL_ROOT_CAUSE}

### Fix applied

{DESCRIPTION_OF_FIX_APPLIED}
Deployed via: {PR link / deployment link}

### Validation steps completed

- [ ] Error rates returned to baseline
- [ ] Latency p99 returned to baseline
- [ ] Manual smoke test passed
- [ ] Owner signed off on recovery

### Timeline (complete)

| Time (UTC) | Event |
|------------|-------|
| {HH:MM} | First symptoms observed (by monitoring / user report) |
| {HH:MM} | Incident declared, {NAME} assigned as commander |
| {HH:MM} | Root cause identified |
| {HH:MM} | Fix deployed |
| {HH:MM} | Recovery confirmed |
| {HH:MM} | Incident closed |

### Follow-up tickets

- [ ] Postmortem: {ticket link}
- [ ] Prevention action 1: {ticket link}
- [ ] Prevention action 2: {ticket link}
