---
name: dependency-audit
description: Use when reviewing a project's dependencies for security, maintenance, license, or bloat risk before adding a package, upgrading a major version, responding to an advisory, or preparing a release. Covers direct and transitive inventory, install scripts, provenance, remediation order, and lockfile hygiene.
license: MIT
compatibility: Examples use npm and pnpm with Node.js 20+. Equivalent commands are listed for pip, cargo, and Go.
metadata:
  version: 1.0.0
  author: SkillRig
  category: security
  tags: [dependencies, supply-chain, npm, audit]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Dependency Audit

Every dependency is code you ship and a maintainer you trust. The question is not "does it have a vulnerability today" but "what happens when it does, and how fast can I get out".

This skill covers the decision to add, keep, upgrade, or remove a dependency, plus the evidence to record.

## When to use

Use this skill when:

- Adding a new package to a project.
- An advisory names a package in your tree.
- Upgrading a major version or replacing a dependency.
- Preparing a release or a security review.
- A dependency pulls in an unexpected install script.
- The lockfile has unexplained churn.

## Workflow

### 1. Inventory

```bash
npm ls --all --depth=2
npm ls --omit=dev --all
npm explain <package>
```

For pnpm:

```bash
pnpm list --depth 2
pnpm why <package>
```

Record:

- Direct dependencies and why each exists.
- Transitive packages that run install scripts.
- Packages with native builds or downloaded binaries.
- Packages with no recent release.
- Duplicate major versions of the same package.
- Git, file, or URL dependencies.

### 2. Evaluate a new dependency

Ask in order:

1. **Can we avoid it?** A 20-line function is cheaper than a package with 40 transitive dependencies.
2. **Is it maintained?** Check the last release, open issues, and whether security reports get answered.
3. **Is it what it claims?** Read the package's repository, not only the README on the registry.
4. **Who publishes it?** Check maintainers, publish history, and whether the package name is a typosquat.
5. **What does it install?** Inspect `scripts` in `package.json` for `preinstall`, `install`, `postinstall`.
6. **What does it pull in?** Check the transitive tree and total install size.
7. **What is the license?** Confirm it is compatible with your distribution.
8. **Is there provenance?** Prefer packages published from CI with attestations.

```bash
npm view <package> name version time.modified maintainers repository license dist.integrity
npm view <package> scripts
npm view <package> dependencies
```

Popularity is not a security signal. A popular package is a larger target and a larger blast radius.

### 3. Run the advisory scan

```bash
npm audit --omit=dev
npm audit --json > audit.json
```

```bash
pnpm audit --prod
```

```bash
pip-audit
cargo audit
govulncheck ./...
```

Read the advisory, not only the severity label:

- Which function is affected?
- Is it reachable in your code path?
- Is the fix a patch, a major upgrade, or removal?
- Is there a maintained fork or a workaround?

A critical advisory in an unreachable dev-only path is not the same risk as a moderate advisory in request parsing.

### 4. Inspect install scripts

```bash
npm ci --ignore-scripts
```

Then run only the scripts the build actually needs, explicitly. This blocks a compromised dependency from executing at install time.

List scripts in the tree:

```bash
npm query ':attr(scripts)' | head -100
```

Review any script that downloads a binary, writes outside the package, or reads environment variables.

### 5. Remediate in order

1. **Remove** the dependency if it is unused or replaceable.
2. **Update** within the current major, if the advisory has a patch.
3. **Replace** with a maintained alternative when the package is abandoned.
4. **Mitigate** with a runtime control when no fix exists: disable the feature, sandbox the process, restrict network.
5. **Accept** with an owner, a rationale, and an expiry date. Never accept silently.

```bash
npm update <package>
npm install <package>@<fixed-version>
```

Do not run `npm audit fix --force` on a production branch. It can apply breaking major upgrades without review.

### 6. Lockfile hygiene

- Commit the lockfile.
- Install with `npm ci` or `pnpm install --frozen-lockfile` in CI.
- Keep one registry. Mixed public and private registries need scoped configuration.
- Verify `integrity` fields are present.
- Review lockfile diffs for new transitive packages, registry changes, and removed integrity hashes.
- Avoid git and URL dependencies unless the commit is pinned and reviewed.

```bash
git diff --stat -- package-lock.json pnpm-lock.yaml yarn.lock
```

### 7. Record the decision

```markdown
Package: <name>@<version>
Added because: <specific need>
Alternatives considered: <name and why rejected>
Maintenance: last release <date>, open advisories <count>
Install scripts: none / reviewed (<what>)
Transitive packages added: <count>
License: MIT
Owner: <team or person>
Review date: <YYYY-MM-DD>
```

For an accepted risk:

```markdown
Advisory: GHSA-xxxx
Reachability: not reachable; the affected parser is not used
Compensating control: network egress blocked for the worker
Expiry: 2026-12-31
Owner: <name>
```

## Examples

Good addition decision:

```text
Need: parse a 200 MB CSV without loading it into memory.
Chosen: csv-stream@4.2.1, one transitive dependency, MIT, last release 3 months ago, no install scripts.
Alternative rejected: papaparse, because it buffers the full input by default.
```

Bad addition decision:

```text
Need: parse CSV.
Chosen: the first npm result.
```

## Common traps

- Typosquatting: `cros-env` vs `cross-env`, `lodahs` vs `lodash`.
- Dependency confusion: an internal package name that also exists publicly.
- Abandoned packages with no security response.
- Packages that vendor binaries in the tarball.
- Postinstall scripts that phone home.
- `latest` floating in production.
- Duplicate major versions increasing attack surface and bundle size.
- A dev-only advisory treated as production risk, or the reverse.

## Guardrails

- Do not install a package to "see what it does" on a host with credentials.
- Do not run `npm audit fix --force` without reviewing every major bump.
- Do not ignore install scripts in CI.
- Do not trust stars, downloads, or a single maintainer as a security control.
- Do not remove a lockfile to resolve a conflict. Resolve the conflict.
- Do not accept a risk without an owner and an expiry.
- Do not paste private registry tokens into an audit tool or ticket.

## Verification checklist

- [ ] Direct dependencies have a stated purpose.
- [ ] New transitive packages reviewed in the lockfile diff.
- [ ] Advisory scan run for production and development scopes.
- [ ] Install scripts identified and blocked by default.
- [ ] Reachability assessed for each relevant advisory.
- [ ] Fix applied and tested, not only bumped.
- [ ] License compatible.
- [ ] Risk acceptances documented with owner and expiry.
- [ ] CI installs from the lockfile.
- [ ] No unexplained registry or integrity changes.

## References

- `references/audit-workflow.md` contains a triage table, command reference, and an acceptance record template.
