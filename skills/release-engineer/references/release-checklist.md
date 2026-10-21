# Release checklists

## Library

- [ ] Public API diff reviewed against the previous release.
- [ ] Semver bump matches the diff.
- [ ] Deprecations announced in the previous release.
- [ ] README examples still run.
- [ ] Types or stubs included.
- [ ] License and notices included.
- [ ] Package contents reviewed with `npm pack --dry-run`.
- [ ] Clean install from the packed tarball works.
- [ ] Changelog credit for external contributors.
- [ ] Provenance or signature attached.

## CLI

- [ ] `--version` prints the released version.
- [ ] `--help` works on a clean install.
- [ ] Shell completion or man page regenerated if present.
- [ ] Windows, macOS, and Linux install paths tested for the changed code.
- [ ] Binaries built for every advertised platform and checksummed.
- [ ] Upgrade from the previous version works in place.
- [ ] Uninstall leaves no dangerous residue.

## Container image

- [ ] Base image pinned by digest.
- [ ] Image built for each advertised architecture.
- [ ] Runs as non-root.
- [ ] No secrets in layers or history.
- [ ] Health check defined.
- [ ] Image digest recorded in the release notes.
- [ ] Image signature or attestation published.
- [ ] Rollback tag points at the previous digest.

## GitHub Release

- [ ] Tag exists and points at the release commit.
- [ ] Changelog copied into the release body.
- [ ] Checksums attached.
- [ ] Source archives available.
- [ ] Pre-release flag set for rc and beta.
- [ ] Discussions or issue links updated.
- [ ] Release is not marked latest until rollout passes.

## Emergency release

When the normal process is too slow for a security or availability incident:

1. Confirm the incident and the minimum fix.
2. Branch from the last known good release, not from an unreviewed main.
3. Apply only the fix. No refactors.
4. Run the focused tests and the security regression test.
5. Get one independent reviewer if a human is available.
6. Publish a patch, with a clear changelog.
7. Verify from a clean environment.
8. Backport the fix to main immediately.
9. Hold a review after the incident and restore normal gates.

An emergency release is still a release. The only steps you may skip are cosmetic.

## Rollback

```bash
# npm
npm dist-tag add skillrig@1.4.3 latest

# container
docker pull registry.example.com/app@sha256:<previous-digest>
kubectl set image deployment/app app=registry.example.com/app@sha256:<previous-digest>

# GitHub release
# Mark the broken release as a pre-release and publish a fixed patch.
```

Check after rollback:

- Version reported by the running service.
- Error rate and latency back to baseline.
- Data written by the new version still readable by the old version.
- Users on the broken version have an upgrade path.

## Versioning edge cases

- **Reverting a feature**: publish a patch if the feature was never in a stable release; minor or major if users may depend on it.
- **Security fix**: patch, even if it changes behavior, and document the behavior change.
- **Dependency major upgrade**: treat as potentially breaking for users who rely on the dependency's types.
- **Support policy change**: major.
- **Documentation-only release**: patch if published, or no release if docs are served from main.

## Evidence to attach

- Commit SHA.
- Artifact hash.
- CI run URL.
- Test counts and duration.
- Smoke test output.
- Canary metrics window.
- Rollback command.
