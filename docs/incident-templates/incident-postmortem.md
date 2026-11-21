# Post-Incident Review (Postmortem) Template

> Complete this document within **5 business days** of incident resolution.
> Blameless postmortems focus on systems, processes, and tools — not individuals.
> Share with the Engineering team and link from the resolved incident ticket.

---

## Postmortem: {INCIDENT_TITLE}

**Incident ID:** INC-{YYYYMMDD}-{N}
**Severity:** {P0 / P1 / P2}
**Date:** {YYYY-MM-DD}
**Duration:** {N hours N minutes}
**Author(s):** {NAME(S)}
**Reviewers:** {NAME(S)}
**Status:** {Draft / In Review / Final}

---

## Executive Summary

<!-- 3–5 sentences. What broke, how long it lasted, what user impact was, and what we learned. -->

{EXECUTIVE_SUMMARY}

---

## Impact

| Metric | Value |
|--------|-------|
| Start time | {YYYY-MM-DD HH:MM UTC} |
| End time | {YYYY-MM-DD HH:MM UTC} |
| Duration | {N hours N minutes} |
| Users affected | {All / ~N users / Subset — describe} |
| Features affected | {list} |
| Error volume | {N errors / N% error rate increase} |
| Revenue impact | {None / ~$N / Unknown} |
| Data loss | {None / describe} |
| SLA breached | {Yes / No} — target: {99.9% / 99.5%} |

---

## Timeline

> All times in UTC. Include key events: first symptom, detection, escalation, root cause identified, fix deployed, recovery confirmed.

| Time (UTC) | Event | Who |
|------------|-------|-----|
| {HH:MM} | {event} | {name} |
| {HH:MM} | {event} | {name} |
| {HH:MM} | Incident detected | {monitoring / user / engineer} |
| {HH:MM} | Incident commander assigned | {name} |
| {HH:MM} | First update posted to status page | {name} |
| {HH:MM} | Root cause identified | {name} |
| {HH:MM} | Fix deployed to production | {name} |
| {HH:MM} | Recovery validated | {name} |
| {HH:MM} | Incident resolved, status page updated | {name} |

---

## Root Cause Analysis

### What happened

<!-- Detailed technical description. What was the proximate cause? -->

{DETAILED_DESCRIPTION}

### Why it happened

<!-- The underlying systemic cause(s). Use the "5 Whys" technique where useful. -->

**Why 1:** {observation}
**Why 2:** {observation}
**Why 3:** {observation}
**Why 4:** {observation}
**Why 5 (root cause):** {root cause}

### Contributing factors

<!-- Conditions that made the incident worse or harder to detect/resolve. -->

- {contributing factor}
- {contributing factor}

---

## Detection

**How was the incident detected?**
{monitoring alert / user report / engineer observation}

**Time to detection:** {N minutes from first symptom to incident declared}

**Detection gap:** Was there a delay between first symptom and detection? Why?
{explanation or N/A}

**Monitoring improvements needed?**
{yes/no — see action items}

---

## Response

**Time to first update:** {N minutes from detection to first status page update}
**Time to root cause:** {N minutes from detection to root cause identified}
**Time to fix deployed:** {N minutes from root cause to fix deployed}
**Time to recovery:** {N minutes from fix deployed to recovery confirmed}

**What went well:**
- {observation}
- {observation}

**What went poorly:**
- {observation}
- {observation}

**Where did we get lucky?**
- {observation}

---

## Action Items

> Each action item MUST have an owner and a due date. Create a ticket for every item.

| # | Action | Owner | Due date | Ticket |
|---|--------|-------|----------|--------|
| 1 | {action} | {name} | {YYYY-MM-DD} | {link} |
| 2 | {action} | {name} | {YYYY-MM-DD} | {link} |
| 3 | {action} | {name} | {YYYY-MM-DD} | {link} |

### Categories

**Prevent recurrence:**
- [ ] {action}

**Improve detection:**
- [ ] {action}

**Speed up response:**
- [ ] {action}

**Improve communication:**
- [ ] {action}

---

## Lessons Learned

<!-- What should every engineer on the team know after this incident? -->

1. {lesson}
2. {lesson}

---

## Appendix

### Relevant logs / graphs

{paste log excerpts or link to dashboards / runbooks}

### Related incidents

- {link to similar past incidents}

### References

- Incident ticket: {link}
- Deployment that caused the incident: {link}
- Fix PR: {link}
- Runbook updated: {yes / no — link}
