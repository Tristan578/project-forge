# Incident Identified — Root Cause Identified Template

> Use this template once the root cause is identified and a fix is in progress.
> The incident is NOT resolved yet — the fix may still be deploying or being validated.

---

## [UPDATE] {TITLE} — Root Cause Identified

**Status:** Fix In Progress
**Last updated:** {YYYY-MM-DD HH:MM UTC}
**Incident Commander:** {NAME}
**Time since detection:** {N hours N minutes}

---

### Root cause (brief)

<!-- One or two sentences for the public update. Plain language — no jargon. -->

We have identified the cause of the issue: {PLAIN_LANGUAGE_ROOT_CAUSE_SUMMARY}.

---

### What is affected

| Service | Status | Notes |
|---------|--------|-------|
| {service_name} | {Degraded / Down / Recovering} | {note} |

---

### What we are doing to fix it

<!-- Describe the fix approach without exposing sensitive implementation details. -->

Our engineering team is {deploying a fix / rolling back / applying a configuration change} and we expect to resolve the issue by **{HH:MM UTC}** (approximately **{N minutes / hours}** from now).

This estimate may change as we validate the fix. We will update this page if the ETA shifts.

---

### Will I lose any data?

{No, your data is safe. / We are assessing potential data impact and will update this section shortly.}

---

### Workaround

{No workaround is available at this time. / You can work around this issue by: {describe workaround}.}

---

Next update by **{HH:MM UTC}** or when the fix is deployed.

Status page: https://status.spawnforge.ai

---

## Internal Notes (not for status page)

### Root cause (technical detail)

{DETAILED_TECHNICAL_ROOT_CAUSE}

**Contributing factors:**
- {factor}
- {factor}

**Why monitoring did not catch it sooner:**
{explanation}

### Fix plan

| Step | Owner | ETA | Done? |
|------|-------|-----|-------|
| {step} | {name} | {HH:MM} | [ ] |
| Deploy fix | {name} | {HH:MM} | [ ] |
| Validate recovery | {name} | {HH:MM} | [ ] |

### Rollback plan (if fix fails)

{ROLLBACK_STEPS}

### Timeline (cumulative)

| Time (UTC) | Event |
|------------|-------|
| {HH:MM} | Incident detected |
| {HH:MM} | Root cause identified |
| {HH:MM} | Fix underway |
