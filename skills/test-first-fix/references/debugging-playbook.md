# Debugging playbook

## First ten minutes

1. Read the error from the top. Note the type, message, and first project frame.
2. Write the exact reproduction command.
3. Check `git status` and `git log -3`. Confirm what changed.
4. Confirm the runtime version the failing process actually uses.
5. Run the smallest test that fails.
6. Write down one hypothesis before editing anything.

## Environment checks

| Symptom | Check |
| --- | --- |
| Works locally, fails in CI | Node/Python version, lockfile, env vars, OS, locale, time zone |
| Module not found | Install command, workspace hoisting, case-sensitive paths |
| Permission denied | File mode, mount options, sandbox policy, antivirus |
| Command not found | `PATH`, shell profile, CI step ordering |
| Works on rerun | Shared state, port collision, eventual consistency |
| Slow only in one place | Disk, network, DNS, proxy, cold cache |

Print the environment in the failing job, not just in your shell:

```bash
node --version
npm --version
pwd
env | cut -d= -f1 | sort
```

`env | cut -d= -f1` shows variable names without values. Do not dump secrets.

## Time and date

- Store and compare UTC. Convert at the edges.
- Test around midnight, month boundaries, leap day, and DST transitions.
- A test that runs at 23:59 local time may fail in another time zone.
- `Date.now()` in a loop is a moving target. Inject a clock.

## Concurrency

- Two writers to one file or row: look for lost updates.
- Port already in use: bind to port 0 in tests and read the assigned port.
- Shared temp directory: use a unique directory per test.
- Async ordering: await every promise; do not rely on timers.
- Unhandled rejection: attach a handler and fail the test.

## Data and encoding

- UTF-8 vs UTF-16 vs BOM.
- Windows CRLF vs LF in fixtures and snapshots.
- JSON numbers losing precision above 2^53.
- Floating-point money. Use integer cents.
- Empty string vs null vs undefined in validation.
- Case-insensitive filesystems hiding a case bug.

## Production debugging

Do not reproduce in production unless there is no alternative.

1. Confirm the blast radius and the affected version.
2. Collect logs, metrics, and traces around the first failure.
3. Check recent deploys, config changes, and dependency upgrades.
4. Reproduce with production-shaped data in a safe environment.
5. Add temporary read-only instrumentation if needed.
6. Fix, verify, and remove the instrumentation.
7. Write the timeline while it is fresh.

Evidence to keep:

- Trace or request id.
- Exact timestamps in UTC.
- Deployed commit and image digest.
- Error counts before and after the change.
- The command or query used to measure.

## Bisect recipe

```bash
git bisect start
git bisect bad HEAD
git bisect good v1.4.0
# For each checkout:
npm ci
npm test -- --run path/to/failing.test.ts
git bisect good   # or bad
git bisect reset
```

If install is slow, cache dependencies or bisect only the source directory with a prebuilt environment. Record the first bad commit and read its diff before assuming it is the cause.

## Minimal failing case

- Inline the input.
- Remove network calls.
- Replace the database with an in-memory fixture when the bug is not database-specific.
- Reduce the number of modules on the path.
- Keep the assertion that matters.
- Confirm the reduced case still fails.

## When to stop and ask

- The reproduction requires production credentials or customer data.
- The fix requires a schema change or a data migration.
- Two owners disagree about intended behavior.
- The bug is a security issue. Escalate through the security process, not a public issue.
