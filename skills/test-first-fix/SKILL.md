---
name: test-first-fix
description: Use when fixing a bug, a failing test, or a reproducible defect in code. Turns a report into a minimal failing test, proves the failure reason, applies the smallest fix, and verifies with the full relevant suite. Also use for flaky tests and regressions after a dependency or model-driven change.
license: MIT
compatibility: Requires a test runner the project already uses. Examples use Node's built-in test runner; the workflow is language-agnostic.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [testing, debugging, tdd, regression]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Test-First Fix

A bug fix is a claim that behavior changed in a specific way. Without a failing test, you cannot tell whether the behavior changed, whether it changed for the stated reason, or whether it will stay changed.

The sequence is fixed: reproduce, isolate, fail, fix, pass, broaden. Skipping a step produces a patch that looks right and fails later.

## When to use

Use this skill when:

- A user reports incorrect behavior with a reproducible path.
- A test fails and the cause is not obvious.
- A change caused a regression.
- A test passes locally and fails in CI, or the reverse.
- An agent proposes a fix without showing a failing test.

Do not use this skill for pure refactors with existing coverage. Use it when behavior is in question.

## Workflow

### 1. Capture the report as facts

Write down, before touching code:

- Exact command that triggers the bug.
- Expected output and actual output.
- Runtime, package manager, OS, and commit.
- Input that matters, minimized.
- Whether it fails every time or intermittently.

```bash
git rev-parse HEAD
node --version
npm --version
```

If the report cannot be reproduced, stop and ask for the missing input. Do not guess at a fix for an unreproduced bug.

### 2. Shrink the reproduction

Remove everything that is not required. The target is the smallest input and shortest path that still fails. Shrinking usually reveals the cause before you write any code.

For a CLI:

```bash
printf '{"amount": 0}' | node cli.mjs --format json
```

For a function test, call the function directly and skip the framework around it.

### 3. Write a failing test

Add the test at the lowest level that still exercises the bug. Assert on behavior, not on implementation details.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAmount } from '../src/split.mjs';

test('splitAmount keeps cents when splitting three ways', () => {
  const parts = splitAmount(100, 3);
  assert.equal(parts.reduce((sum, part) => sum + part, 0), 100);
  assert.deepEqual(parts, [34, 33, 33]);
});
```

Name the test after the broken behavior. Run it alone:

```bash
node --test test/split.test.mjs
```

### 4. Prove the failure is the right failure

Read the assertion output. It must fail because of the bug, not because of a typo, a missing import, or an environment problem.

A test that fails with `TypeError: splitAmount is not a function` proves nothing about cent allocation. Fix the test setup first.

### 5. Form one hypothesis

State it as a sentence:

> The split rounds each share down independently, so the remainder is dropped instead of being distributed.

Find the exact line. Read the surrounding code and its callers. Check the input types and units. Check assumptions about ordering, time zones, floating point, and empty collections.

If you have more than one hypothesis, rank them and test the cheapest first. Do not change code while testing a hypothesis.

### 6. Apply the smallest fix

Change one thing. Keep the diff reviewable. Do not refactor adjacent code, rename variables, or reformat the file.

Run the single test:

```bash
node --test test/split.test.mjs
```

Then run the module and the full suite:

```bash
node --test
npm run lint
```

### 7. Broaden verification

- Run the tests that cover direct callers.
- Run the full suite once.
- Run the reproduction from step 1, not only the test.
- If the bug involved time, run with a fixed clock or a different time zone.
- If the bug involved concurrency, run the test repeatedly.
- If the bug involved a browser, check the real browser, not only the unit test.

### 8. Prevent the next one

Add a regression test that is specific enough to fail if the fix is reverted. If the bug came from a missing invariant, add an assertion where the invariant is established.

Update the changelog or issue with the root cause and the verification command.

## Flaky tests

Never paper over a flake with retries. First classify it.

- **Order dependence.** Run the test alone and after the suspect test.
- **Shared state.** Look for module-level caches, singletons, database rows, environment variables.
- **Time.** Check clocks, time zones, DST, and timeouts.
- **Concurrency.** Look for unsynchronized writes, ports, temp files.
- **Network.** Mock or isolate the endpoint; never depend on the public internet in unit tests.
- **Randomness.** Seed the generator and record the seed.
- **Resource limits.** Check file descriptors, memory, and test timeouts.

A flaky test is a bug in the test or the code. Retrying it reduces the signal.

## Debugging techniques that pay off

- **Bisect history.** `git bisect start`, mark good and bad commits, run the failing test as the check.
- **Delta debugging.** Remove inputs and code paths until the failure disappears; the last removed piece matters.
- **Trace instead of print.** A debugger or structured trace shows state without editing the code under test.
- **Assert the invariant early.** A failing assertion at the source beats a wrong value three layers later.
- **Compare working and broken runs.** Diff the inputs, versions, environment, and call order.
- **Read the error twice.** The first line names the failure; the stack names the path; the cause often hides in the middle.

## Examples

Bug report: "CSV export sometimes writes 99 cents for a $1.00 order split three ways."

Weak fix:

```js
// Give the remainder to the first element.
parts[0] += total - parts.reduce((sum, part) => sum + part, 0);
```

This hides the rounding rule in one call site and leaves the other callers wrong.

Better fix:

```js
export function splitAmount(totalCents, ways) {
  const base = Math.floor(totalCents / ways);
  const remainder = totalCents - base * ways;
  return Array.from({ length: ways }, (_, index) => base + (index < remainder ? 1 : 0));
}
```

The function now owns the invariant: the parts always sum to the total. The test asserts the invariant and the distribution.

## Guardrails

- Do not edit a test to make it pass unless the test itself is wrong. If it is wrong, fix the test in a separate commit with an explanation.
- Do not mix a behavior fix with a refactor.
- Do not delete or skip a failing test to get a green run.
- Do not claim a fix without the command and its output.
- Do not add retries to hide a flake.
- Do not test private helpers when a public behavior is available.

## Verification checklist

- [ ] Reproduction command recorded before the fix.
- [ ] Failing test added and fails for the stated reason.
- [ ] Test fails on the original code and passes on the fix.
- [ ] Fix is minimal and scoped.
- [ ] Full relevant suite passes.
- [ ] Original manual reproduction now succeeds.
- [ ] Regression test remains in the suite.
- [ ] Root cause documented in the issue or changelog.

## References

- `references/debugging-playbook.md` contains environment, concurrency, and production-debugging checklists.
