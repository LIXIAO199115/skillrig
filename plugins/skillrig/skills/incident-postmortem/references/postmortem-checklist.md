# Postmortem review rubric

## Evidence

- [ ] Timeline uses one timezone, preferably UTC.
- [ ] Every event has a log, dashboard, alert, or command output.
- [ ] Impact start and detection time are separate.
- [ ] Deploy SHAs, config values, and versions are recorded.
- [ ] Customer reports are described, not quoted with personal data.
- [ ] Estimates are labeled and their method is stated.

## Analysis

- [ ] Trigger, cause, and contributing factors are distinct.
- [ ] The cause is a mechanism, not a person.
- [ ] Detection and response are evaluated.
- [ ] What worked is recorded.
- [ ] Near misses and lucky breaks are named.
- [ ] The analysis explains why existing controls did not prevent or contain the failure.
- [ ] Alternative explanations were considered.

## Actions

- [ ] Every action changes a system, a test, an alert, a runbook, or a process.
- [ ] Each has a single owner.
- [ ] Each has a due date.
- [ ] Each has a verification method.
- [ ] Actions are tracked in the normal issue system.
- [ ] Actions are prioritized; the list is not a wish list.
- [ ] Completion is reviewed at a later date.

## Writing

- [ ] Summary readable by someone outside the team.
- [ ] No blame, sarcasm, or speculation presented as fact.
- [ ] Acronyms expanded on first use.
- [ ] Links work.
- [ ] Sensitive data removed.
- [ ] Length is proportional to severity.

## Action quality scale

| Level | Example | Verdict |
| --- | --- | --- |
| 0 | "Be more careful" | Not an action |
| 1 | "Improve monitoring" | Too vague |
| 2 | "Add connection alerts" | Better, still unowned |
| 3 | "Add alert at 80% connections, owner @db, due date" | Acceptable |
| 4 | Level 3 plus a verification test and a runbook link | Strong |

Prefer level 3 and 4 actions. A short list of strong actions beats a long list of intentions.

## Severity guide

| Severity | Typical impact |
| --- | --- |
| SEV-1 | Full outage, data loss, or security exposure across customers |
| SEV-2 | Major feature unavailable or severe degradation for many users |
| SEV-3 | Limited impact, workaround available, or a near miss |

Severity definitions belong to the team. Record the definition used.

## Review meeting

Keep it under 45 minutes:

1. Read the summary and impact.
2. Walk the timeline, asking for evidence.
3. Challenge the cause once: "what else could explain this?"
4. Agree on actions and owners.
5. Set a follow-up date.
6. Thank the responders.

Do not turn the meeting into a design review. Schedule that separately.
