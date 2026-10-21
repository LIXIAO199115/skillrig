# Pull request review checklist

## Intent and scope

- [ ] Title and description state the problem and the approach.
- [ ] Linked issue or acceptance criteria exist.
- [ ] Diff does one thing.
- [ ] No unrelated formatting or dependency churn.
- [ ] Generated files and lockfiles are explained.
- [ ] Target branch is correct.
- [ ] No merge commits or conflict markers left behind.

## Correctness

- [ ] Empty, null, zero, one, negative, and maximum inputs handled.
- [ ] Error paths return the right status or exception.
- [ ] Resources closed on every path, including errors.
- [ ] Retries are idempotent.
- [ ] Ordering assumptions documented and tested.
- [ ] Currency uses integers, time uses UTC, units are explicit.
- [ ] New branches are reachable and old branches are still needed.
- [ ] No swallowed exceptions.
- [ ] No debug logs left at info level.

## Tests

- [ ] A test fails without the production change.
- [ ] Core behavior asserted, not only mock calls.
- [ ] Negative and authorization cases covered.
- [ ] Time, randomness, network, and database controlled.
- [ ] Test names describe behavior.
- [ ] No `.only`, `.skip`, or commented tests added.
- [ ] No sleeps used to avoid synchronization.
- [ ] Snapshots reviewed, not blindly updated.

## Security

- [ ] Inputs validated at the boundary.
- [ ] Queries parameterized.
- [ ] Shell arguments passed as arrays, never interpolated strings.
- [ ] Authorization checked per resource, not only per route.
- [ ] No secret in code, tests, fixtures, logs, or error messages.
- [ ] User-controlled paths normalized and contained.
- [ ] User-controlled URLs restricted by scheme and host.
- [ ] Uploads limited by size, type, and destination.
- [ ] New dependencies reviewed for install scripts and license.
- [ ] Untrusted text is delimited before entering an agent prompt.
- [ ] HTML escaped or sanitized before rendering.
- [ ] CSRF and SameSite considered for state-changing requests.
- [ ] Rate limits or quotas on expensive endpoints.

## Data and migrations

- [ ] Migration is forward-only or has a tested down path.
- [ ] No long lock on a large table.
- [ ] Backfill batched and resumable.
- [ ] New columns nullable or defaulted.
- [ ] Old and new code can run during rollout.
- [ ] Index creation uses the concurrent form where supported.
- [ ] Rollback does not lose data written by the new code.
- [ ] Backup or snapshot taken for destructive changes.

## Compatibility

- [ ] Public API additions are backward compatible.
- [ ] Removed fields and endpoints have a deprecation path.
- [ ] New required configuration has a default or a startup check.
- [ ] Serialized data remains readable by older clients.
- [ ] Minimum runtime version still supported.
- [ ] Feature flag default is safe.

## Performance

- [ ] No query in a loop.
- [ ] Result sets bounded.
- [ ] Indexes match new filters and joins.
- [ ] Payload size bounded.
- [ ] No blocking work on a hot path.
- [ ] Retries have backoff and a cap.
- [ ] Expensive endpoint has a measured budget.

## Operations

- [ ] Logs include a correlation id and no secrets.
- [ ] Metrics or traces added for new critical paths.
- [ ] Alerts do not fire on normal behavior.
- [ ] Rollback procedure documented for risky changes.
- [ ] Runbook updated when a new failure mode exists.

## Review comment quality

- [ ] File and line included.
- [ ] Mechanism explained.
- [ ] Evidence or reproduction included.
- [ ] Suggested direction is concrete.
- [ ] Verification step named.
- [ ] Severity label present.
- [ ] No personal attack, sarcasm, or vague concern.

## Final verdict

- [ ] Verdict is one of: request changes, approve with follow-ups, approve.
- [ ] Verification commands and results are listed.
- [ ] Unverified areas are named.
