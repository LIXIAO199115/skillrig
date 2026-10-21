---
name: incident-postmortem
description: Use after a production incident, outage, data-loss event, or near miss to write a blameless postmortem with a verified timeline, measured impact, contributing factors, and action items that have owners and dates. Also use to review an incident report for unsupported claims or missing follow-up.
license: MIT
compatibility: Any engineering team. Works with incidents tracked in issues, documents, or a status page.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [incident, postmortem, reliability, operations]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Incident Postmortem

A postmortem is not a story about who made a mistake. It is an evidence-backed account of how the system failed, what it cost, and what will change so the same failure has less impact next time.

Write it while the evidence is fresh. Logs expire, dashboards roll over, and people's memories reconstruct causes that did not exist.

## When to use

Use this skill when:

- A production incident affected users, data, or revenue.
- A near miss could have done so.
- A rollback or emergency release happened.
- A monitoring gap delayed detection.
- You are reviewing someone else's incident write-up.

## Workflow

### 1. Separate facts from narrative

Facts: timestamps, error rates, deploy SHAs, alert times, customer reports, commands run.

Narrative: why someone chose an action, what they believed at the time, what the runbook said.

Collect facts first. Add narrative only when it is attributed and relevant to prevention.

### 2. Build the timeline in UTC

```markdown
| Time (UTC) | Event | Evidence |
| --- | --- | --- |
| 10:02 | Deploy `a1b2c3d` starts | CI log |
| 10:05 | Deploy completes | CD log |
| 10:07 | Error rate exceeds 5% | Dashboard, saved query |
| 10:09 | Alert fires | PagerDuty |
| 10:14 | On-call acknowledges | Incident channel |
| 10:20 | Rollback starts | CD log |
| 10:26 | Error rate back to baseline | Dashboard |
```

Rules:

- One timezone, UTC.
- Every row has evidence. A memory is not evidence.
- Include detection, response, mitigation, and recovery.
- Note the gap between impact start and detection; that is usually the most actionable number.
- Distinguish when the incident started from when it was noticed.

### 3. Measure impact

Quantify what you can; label estimates.

- Duration: from first affected request to recovery.
- Users affected: count or percentage.
- Requests failed: count, error classes.
- Data: rows lost, corrupted, delayed, or exposed.
- Revenue: only with a documented calculation.
- SLO: error budget consumed.
- Support load: tickets, messages.
- Scope: regions, plans, tenants.

```markdown
Impact: 18 minutes, 42% of checkout requests failed (approximately 9,800 attempts), no data loss, one enterprise tenant escalated.
```

If you cannot measure it, say so and describe how you would measure it next time.

### 4. Identify causes without blame

Use a chain:

- **Trigger**: the change or event that started it.
- **Cause**: the defect or condition that turned the trigger into an incident.
- **Contributing factors**: why it was not caught, contained, or recovered faster.

Example:

```markdown
Trigger: a deploy at 10:02 changed the database connection pool size.
Cause: the new pool exhausted the database's max_connections under peak load, so new requests failed to acquire a connection.
Contributing factors:
- The staging environment has one-tenth the traffic, so the pool never saturated.
- The connection metric had no alert.
- The rollback required a manual config change not covered by the deploy rollback.
```

Avoid "human error" as a root cause. Ask what made the error easy, invisible, or unrecoverable. That question produces fixes; a name produces defensiveness.

### 5. Evaluate detection and response

- How was the incident detected? Alert, customer, internal test?
- Time to detect, acknowledge, mitigate, recover.
- Did the runbook exist? Was it correct?
- Was the rollback path known and tested?
- Did communication reach the right people?
- Did any control make things worse?

### 6. Write action items that change outcomes

A good action item is specific, verifiable, owned, and dated:

```markdown
- [ ] Add an alert for database connections above 80% of max_connections, with a runbook link. Owner: @db-oncall. Due: 2026-10-28. Verify: alert fires in staging load test.
- [ ] Add a staging load test at 1x production peak for checkout. Owner: @platform. Due: 2026-11-15.
- [ ] Make pool size part of the deploy rollback. Owner: @checkout. Due: 2026-10-25.
```

Bad action items:

- "Be more careful."
- "Improve monitoring."
- "Add more tests."
- "Review the process."

Track action items in the team's normal issue tracker with the postmortem linked. Review them at the next incident review. An unowned action item is a wish.

### 7. Review

Before publishing:

- Every timeline row has evidence.
- Impact numbers have a method.
- Causes distinguish trigger, cause, and contributing factors.
- No individual is blamed.
- Action items have owners and dates.
- Sensitive customer data is removed.
- The document states what went well, not only what failed.

## Template

```markdown
# Incident: <short description>

Status: draft / reviewed / final
Severity: SEV-1 / SEV-2 / SEV-3
Date: YYYY-MM-DD
Duration: HH:MM
Owner: <name>
Reviewers: <names>

## Summary

Two or three sentences: what happened, who was affected, how it was fixed.

## Impact

- Duration:
- Users:
- Requests:
- Data:
- SLO:

## Timeline (UTC)

| Time | Event | Evidence |
| --- | --- | --- |

## Root cause

Trigger:
Cause:
Contributing factors:

## Detection and response

- Detected by:
- Time to detect:
- Time to mitigate:
- Time to recover:
- What worked:
- What slowed us down:

## Action items

| Action | Owner | Due | Verification |
| --- | --- | --- | --- |

## Lessons

What we will change in design, operations, or process.

## Appendix

Queries, dashboards, logs, links.
```

## Examples

Vague:

```markdown
The service went down because of a bad deploy. We rolled it back. We will improve monitoring.
```

Specific:

```markdown
A deploy raised the connection pool from 20 to 100 per instance. With 12 instances, the database hit max_connections during the 10:05 traffic peak. New requests failed with `too many clients already`.

Impact: 18 minutes, 42% of checkout requests failed, no data loss.

Rollback reverted the code but not the pool setting, which was injected from an environment variable; the on-call corrected it manually at 10:24.

Actions: alert on connection utilization, add pool size to the rollback checklist, load-test at production peak.
```

## Guardrails

- Do not name and shame. Describe conditions and decisions.
- Do not claim a cause without evidence.
- Do not round impact numbers to make them look better or worse.
- Do not publish customer identifiers, tokens, or internal URLs.
- Do not close the incident without owners and dates for actions.
- Do not treat a near miss as a non-event.
- Do not let the postmortem become a design document. Link to the follow-up design.

## Verification checklist

- [ ] Timeline in UTC with evidence per row.
- [ ] Detection, response, mitigation, recovery times recorded.
- [ ] Impact measured or explicitly estimated with a method.
- [ ] Trigger, cause, and contributing factors separated.
- [ ] No individual blamed.
- [ ] What worked recorded.
- [ ] Action items have owners, dates, and verification.
- [ ] Sensitive data removed.
- [ ] Reviewed by someone who was not on call.
- [ ] Actions tracked and scheduled for review.

## References

- `references/postmortem-checklist.md` contains a review rubric and an action-item quality scale.
