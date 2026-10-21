---
name: release-engineer
description: Use when cutting a release or publishing a package: choosing a semver bump, writing the changelog, tagging the exact commit, building reproducibly, publishing with provenance, verifying the published artifact from a clean environment, and planning rollback. Covers npm, GitHub Releases, and container images.
license: MIT
compatibility: Requires git and the project's package manager. Registry examples use npm and GitHub. Signing requires an existing GPG or SSH signing key.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [release, semver, publishing, supply-chain]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Release Engineer

A release is a promise that a specific artifact, built from a specific commit, works for the people who install it. Every step exists to keep that promise verifiable.

Most release incidents come from one of four gaps: the tag points at the wrong commit, the published artifact differs from the tested one, the changelog hides a breaking change, or there is no rollback path.

## When to use

Use this skill when:

- Publishing a package, CLI, container image, or GitHub Release.
- Deciding whether a change is major, minor, or patch.
- Writing or repairing a changelog.
- Setting up automated releases with provenance.
- A release is broken and you need to roll back or publish a fix.

## Workflow

### 1. Preflight

```bash
git status
git fetch --tags
git log --oneline -10
```

Confirm:

- Working tree clean, on the release branch, up to date with the remote.
- CI green on the exact commit you intend to release.
- No open blocking issues for the milestone.
- Dependency lockfile committed.
- Version in the manifest is the version you intend to publish.
- No secrets in the tree or in test fixtures.

If any check fails, stop. A release is a bad place to discover a dirty tree.

### 2. Choose the version

Semantic versioning for a public API:

| Change | Bump | Example |
| --- | --- | --- |
| Bug fix, no API change | patch | 1.4.2 → 1.4.3 |
| New backward-compatible feature | minor | 1.4.2 → 1.5.0 |
| Breaking change | major | 1.4.2 → 2.0.0 |
| Pre-release | suffix | 2.0.0-rc.1 |
| Build metadata | suffix | 1.4.3+build.7 |

Rules that prevent pain:

- Removing or renaming an export is breaking.
- Changing a default is breaking if callers depend on it.
- Raising the minimum runtime is breaking for users on the old runtime.
- Changing error types or status codes can be breaking.
- A 0.x project may use minor for breaking changes, but say so in the README.
- Never reuse a published version. Publish a new patch instead.

### 3. Write the changelog

Group by impact, not by commit:

```markdown
## [1.5.0] - 2026-10-21

### Added
- `skillrig budget` reports always-on token cost per skill. (#214)

### Changed
- Installer now refuses to overwrite an unmanaged directory unless `--force`. (#219)

### Fixed
- Tar reader no longer strips the top-level folder from `.skm` bundles. (#221)

### Security
- Scan blocks skills that pipe remote content into a shell. (#226)

### Breaking
- Node.js 18 is no longer supported. Minimum is 20.11.
```

Rules:

- Write for users, not for the commit log.
- Every breaking change needs a migration note.
- Link the issue or pull request when the project does that.
- Credit external contributors.
- Do not include internal ticket ids that users cannot resolve.
- Do not claim a fix that is not in the artifact.

### 4. Build the exact artifact

```bash
npm ci
npm run build
npm test
npm pack --dry-run
```

Check:

- The build uses the lockfile, not a floating install.
- The toolchain version matches CI.
- The package includes the files users need and excludes secrets, tests, and local config.
- The artifact hash is recorded.

```bash
sha256sum dist/*.tgz
```

For containers, pin the base image by digest and record the image digest after the build.

### 5. Tag the exact commit

```bash
git tag -s v1.5.0 -m "v1.5.0"
git push origin v1.5.0
```

- Use an annotated, signed tag when the project supports it.
- Tag the commit that CI tested, not a later merge.
- Verify: `git show v1.5.0 --stat` and `git rev-list -n 1 v1.5.0`.

If the tag is wrong, delete it before anyone consumes it. After publication, never move a tag; publish a new patch.

### 6. Publish

```bash
npm publish --access public --provenance
```

- Enable provenance or attestations where the registry supports them.
- Use a short-lived CI token, not a personal long-lived token.
- Publish from CI when possible, so the artifact matches the pipeline.
- If publishing manually, publish the exact artifact you tested, not a fresh build.

### 7. Verify from a clean environment

This step catches the majority of packaging mistakes.

<!-- skillrig-ignore-block: global-install -- clean-room verification inside a throwaway container -->
```bash
docker run --rm -it node:22 bash
npm install --global skillrig@1.5.0
skillrig --version
skillrig search test
```

Check:

- The version string is the released one.
- The binary or entry point exists.
- Required files are present.
- A minimal example from the README works.
- The install does not execute unexpected scripts.
- The package size is in the expected range.

### 8. Roll out

- Canary or staged rollout for services.
- Feature flags off by default for risky behavior changes.
- Watch error rate, latency, and saturation for a defined window.
- Keep the previous artifact available for rollback.
- Write the rollback command before you need it.

### 9. Close the loop

- Publish the GitHub Release with the changelog and checksums.
- Update docs, migration guides, and examples.
- Announce in the channels users actually read.
- Bump to the next development version.
- Close the milestone.
- Record the release in the incident log if anything went wrong.

## Examples

Good release commit sequence:

```bash
# version bump and changelog in one commit
npm version 1.5.0 --no-git-tag-version
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v1.5.0"
git push origin main

# wait for CI on that commit
gh run watch

# tag the tested commit
git tag -s v1.5.0 -m "v1.5.0"
git push origin v1.5.0
```

Bad release sequence:

```bash
npm version patch
npm publish
git push --tags
```

No test on the tagged commit, no changelog, no verification, and the tag may point somewhere else.

## Failure modes

| Failure | Consequence | Prevention |
| --- | --- | --- |
| Tag on a later commit | Users get untested code | Tag the CI-tested SHA |
| Version not bumped | Cache serves old files | Check `npm view` before publish |
| Missing files in package | Install breaks | `npm pack --dry-run`, clean install |
| Secret in artifact | Credential leak | Secret scanning, `.npmignore` review |
| Breaking change in patch | Silent breakage | Semver review in the PR |
| No provenance | Cannot verify origin | Publish from CI with provenance |
| No rollback artifact | Long outage | Keep the previous version |
| Moving a published tag | Unreproducible builds | Never move; publish a new patch |

## Guardrails

- Do not publish from a dirty working tree.
- Do not reuse or overwrite a published version.
- Do not publish with a personal long-lived token when CI tokens are available.
- Do not skip the clean-environment install test.
- Do not mark a release "stable" before the canary window passes.
- Do not delete a release that users may have installed; yank or deprecate it instead.
- Do not include `.env`, credentials, test fixtures with real data, or local paths in the package.

## Verification checklist

- [ ] Tests pass on the exact tagged commit.
- [ ] Version follows semver and is not already published.
- [ ] Changelog has added, changed, fixed, security, and breaking sections as needed.
- [ ] Artifact built from the lockfile and hashed.
- [ ] Tag is annotated and points at the tested commit.
- [ ] Provenance or attestation is present.
- [ ] Clean-environment install and smoke test pass.
- [ ] Rollback path and previous artifact are available.
- [ ] Release notes published.
- [ ] Next development version set.

## References

- `references/release-checklist.md` contains copyable checklists for libraries, CLIs, containers, and emergency releases.
