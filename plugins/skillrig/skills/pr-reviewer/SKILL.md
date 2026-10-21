---
name: pr-reviewer
description: Use when reviewing a pull request, a staged diff, or an agent-authored patch and the output must be high-signal. Covers review order, blocking versus non-blocking findings, test adequacy, security and migration checks, comment templates with evidence, and when to stop reviewing and ask for a rewrite.
license: MIT
compatibility: Any Git repository. Examples use git, gh, and ripgrep. No runtime dependencies.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [code-review, git, pull-request, quality]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# PR Reviewer

A review is not a style conversation. It is a risk assessment with a diff attached. The deliverable is a short list of findings that change what the author will do, each backed by evidence.

A review with twenty nits and no blocking findings is usually a review that missed the risk.

## When to use

Use this skill when:

- Reviewing a pull request before merge.
- Reviewing an agent's patch before applying or committing it.
- Auditing a release branch or a security-sensitive change.
- Writing the review half of a Codex or CI review job.

## Workflow

### 1. Read the intent before the diff

Read the PR title, description, linked issue, and acceptance criteria. Write one sentence describing what the change is supposed to accomplish.

If the description is empty, infer intent from the diff, then state the assumption in the review. Do not silently invent requirements.

### 2. Check the scope

- Does the diff do one thing?
- Are there unrelated formatting changes, dependency bumps, or renames?
- Are generated files, lockfiles, or snapshots included with explanations?
- Is the target branch correct?

A large mixed diff is a review hazard. Ask for a split when a behavior change is buried under mechanical churn.

### 3. Read the tests first

Tests tell you what the author believes the change does.

- Does a test fail without the code change? If not, the test does not cover the change.
- Is the assertion about behavior or implementation?
- Are error paths covered, or only the happy path?
- Are there negative cases for validation, authorization, and empty input?
- Are time, randomness, network, and database dependencies controlled?
- Would the tests catch a revert?

Tests that only assert a mock was called are weak evidence. Tests that assert output for a given input are strong.

### 4. Review correctness

Trace one real input through the changed code.

- Boundary values: zero, one, empty, maximum, negative.
- Null and undefined in every new field.
- Error handling: swallowed exceptions, wrong exit codes, missing cleanup.
- Resource leaks: files, sockets, timers, subscriptions.
- Ordering and idempotency: retries, duplicate delivery.
- Concurrency: shared mutable state, check-then-act races.
- State machines: unreachable states, missing transitions.
- Data flow: units, currency, time zones, encoding.

### 5. Review security

- **Injection**: SQL, shell, template, header, log injection. Is input parameterized?
- **Authorization**: is every new endpoint and data path checked, not just authenticated?
- **Secrets**: any literal token, key, or credential in code, tests, config, or fixtures?
- **Path traversal**: user-controlled path joined without normalization and containment.
- **SSRF**: user-controlled URL fetched by the server.
- **Deserialization**: untrusted input into a parser that can execute.
- **File upload**: type, size, and storage path validated.
- **Dependency**: new package, version pin, install script reviewed.
- **Prompt injection**: untrusted text passed into an agent without delimiting or instruction isolation.

Security findings are blocking until disproven. Cite the line and the reachable path.

### 6. Review compatibility

- Public API: breaking change? New required field? Changed status code?
- Database: migration reversible? Locking? Backfill safe on a large table?
- Configuration: new required env var with no default?
- Data format: existing rows and clients still parseable?
- Rollout: can old and new versions run at the same time?
- Rollback: does reverting the code leave the database in a usable state?

### 7. Review performance and cost

Only raise it with evidence or a clear mechanism.

- New query inside a loop.
- Unbounded result set.
- Missing index for a new filter.
- Large payload loaded into memory.
- Synchronous work on a hot path.
- Retry storm or missing backoff.
- Model call added to a per-request path.

Measure or name the complexity. "This is slow" is not a finding.

### 8. Write the review

Use three severities:

- **Blocking**: must change before merge. Incorrect behavior, security, data loss, broken build, missing test for the core change.
- **Important**: should change, but the author may merge with a follow-up if they accept the risk. Missing edge case, weak error message, performance risk.
- **Nit**: optional. Style that tooling does not enforce, naming preferences, wording.

Comment template:

```markdown
**[Blocking] Retry loop can double-charge the customer** — `src/billing/charge.ts:118`

The handler retries on any 5xx, including the case where the charge succeeded but the response was lost. The second attempt uses the same idempotency key only when `requestId` is present, and it is optional here.

Evidence: `tests/billing/charge.test.ts` covers a timeout before submission, not after.

Suggested fix: require an idempotency key for this path, or query the provider before retrying.

Verification: add a test that simulates a lost response and asserts exactly one charge.
```

The template forces four things: location, mechanism, evidence, and a way to verify the fix.

## What not to comment on

- Formatting and import order that a formatter or linter enforces. Let CI fail it.
- Personal naming taste with no effect on behavior or searchability.
- "I would have done it differently" without a concrete risk.
- Generated code, unless the generation itself is wrong.
- Unchanged lines far from the diff, unless the change makes them dangerous.

## Examples

Good:

```markdown
**[Important] New index is not created concurrently** — `db/migrations/0043_add_orders_index.sql:1`

`CREATE INDEX` takes a write lock on `orders`, which has 40M rows. Deploys run during business hours and this will block writes for the duration of the build.

Suggested fix: `CREATE INDEX CONCURRENTLY`, and run it outside the transaction wrapper.
```

Bad:

```markdown
This looks fine but maybe we should think about performance.
```

Good:

```markdown
**[Blocking] The new endpoint skips the tenant check** — `src/api/reports.ts:64`

`getReport(id)` loads by primary key. Every other report handler calls `assertTenant(req, report.tenantId)` before returning. Without it, any authenticated user can read another tenant's report by guessing an id.

Reproduction: create reports in tenant A and B, then `GET /reports/<B-id>` with A's token.
```

Bad:

```markdown
Security issue here.
```

## Review output shape

```markdown
## Verdict
Request changes / Approve with follow-ups / Approve

## Blocking
- ...

## Important
- ...

## Nits
- ...

## Verified
- Ran `npm test -- --run` (passes, 214 tests).
- Ran the reproduction against the branch (no longer fails).
```

If you did not run anything, say so. "Not run" is honest; "tests pass" without execution is not.

## Guardrails

- Do not approve a change you do not understand. Ask a question instead.
- Do not block on nits. Say they are optional.
- Do not rewrite the author's branch unless asked.
- Do not claim a bug without a mechanism or a reproduction.
- Do not review a diff for a branch that has moved; fetch and re-check the base.
- Do not paste secrets or customer data into review comments.
- Do not use "LGTM" as a substitute for a verdict and a verification note.

## Verification checklist

- [ ] Intent stated in one sentence.
- [ ] Scope is coherent and the base branch is correct.
- [ ] Tests fail without the change and cover error paths.
- [ ] Security paths reviewed.
- [ ] Migration and rollback reviewed when data changes.
- [ ] Findings have file, line, mechanism, and evidence.
- [ ] Severity labels are consistent.
- [ ] Verification commands and outcomes recorded.
- [ ] Final verdict is explicit.

## References

- `references/review-checklist.md` contains language-agnostic correctness, security, and migration checklists.
