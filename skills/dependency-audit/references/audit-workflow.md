# Dependency audit workflow

## Command reference

```bash
# tree
npm ls --all --depth=2
npm ls --omit=dev --all
npm explain <package>
npm query ':attr(scripts)'

# registry metadata
npm view <package> version time.modified maintainers repository license
npm view <package> scripts dependencies peerDependencies
npm view <package> dist.integrity dist.tarball

# advisories
npm audit --omit=dev
npm audit --json > audit.json
pnpm audit --prod
pip-audit
cargo audit
govulncheck ./...

# reproducible install
npm ci
npm ci --ignore-scripts
pnpm install --frozen-lockfile

# stale and duplicate
npm outdated
npm dedupe --dry-run
```

## Triage table

| Signal | Risk | Action |
| --- | --- | --- |
| Critical advisory, reachable, fix available | High | Patch now |
| Critical advisory, dev-only, not reachable | Low–medium | Schedule, document |
| Abandoned package, no advisory | Medium | Plan replacement |
| Postinstall downloads a binary | High | Block scripts, review, pin |
| Typosquat-like name | High | Remove unless verified |
| Git or URL dependency | Medium–high | Pin commit, vendor if possible |
| Duplicate major versions | Medium | Deduplicate, check compatibility |
| License incompatible | High | Replace or obtain permission |
| Integrity missing in lockfile | Medium | Regenerate with a trusted registry |

## Install script review

A script is suspicious when it:

- Fetches from a URL that is not the package registry.
- Decodes or executes downloaded content.
- Reads tokens, SSH keys, or cloud metadata.
- Writes outside `node_modules` or the build directory.
- Runs on every install but is not needed for the build.

```bash
npm ci --ignore-scripts
npm rebuild <package>   # only for packages that genuinely need a build step
```

## Lockfile diff review

```bash
git diff -- package-lock.json | head -200
```

Look for:

- New packages you did not intend to add.
- Changed `resolved` URLs or registries.
- Removed `integrity` fields.
- Version jumps across majors.
- Git dependencies with floating refs.

## Acceptance record

```markdown
# Dependency risk acceptance

Package: <name>@<version>
Advisory: <id and link>
Severity: <registry severity>
Reachability: <how you proved it is or is not used>
Compensating control: <what limits the impact>
Owner: <name>
Created: <YYYY-MM-DD>
Expires: <YYYY-MM-DD>
Review trigger: next major release, or advisory update
```

## Replacement checklist

When replacing a package:

- [ ] Feature parity for the functions you use.
- [ ] License compatible.
- [ ] Smaller or equal transitive tree.
- [ ] Maintained in the last 12 months.
- [ ] Migration tests cover the changed behavior.
- [ ] Old package removed from the manifest and lockfile.
- [ ] Bundle or binary size measured before and after.

## CI policy example

```yaml
- name: Install without lifecycle scripts
  run: npm ci --ignore-scripts

- name: Build required native modules
  run: npm rebuild sharp

- name: Audit production dependencies
  run: npm audit --omit=dev --audit-level=high
```

`--audit-level=high` fails the job on high and critical advisories. Pair it with a documented exception list rather than lowering the level globally.
