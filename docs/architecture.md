# Architecture

SkillRig is a small, auditable system with one invariant: **nothing enters an agent directory unless its bytes match a hash that came from somewhere trustworthy, and nothing is executed on the way in.**

This document describes how the pieces fit together. It is written for people who intend to modify the code, not for end users.

## Design constraints

1. **Zero runtime dependencies.** Every published feature uses Node built-ins: `node:crypto`, `node:zlib`, `node:fs`, `node:http`, `node:test`. This removes the largest supply-chain surface a package manager can have — its own dependency tree.
2. **Node 20.11+ and ESM.** No build step, no transpiler, no bundler. The files in `src/` are the files that run.
3. **Offline-first registry.** The signed index ships inside the package. `search`, `info`, `verify`, and every curated install work without a network. Only upstream entries and `owner/repo` sources touch GitHub.
4. **No execution of untrusted content.** Install, scan, audit, and publish read bytes. They never invoke a skill's shell script, JS file, or prompt.
5. **Fail closed.** Missing signatures, digest mismatches, unsafe paths, unknown agents, and security gates produce non-zero exits.

## Module map

```
bin/skillrig.mjs          executable shim; maps errors to exit codes
src/cli.mjs               argument parsing, 22 commands, human and JSON output
src/index.mjs             public library surface (re-exports core)

src/core/
  errors.mjs              SkillRigError, UsageError, SecurityError, IntegrityError + exit codes
  util.mjs                package root, atomic writes, tree hashes, safe paths, ANSI colour, tables
  semver.mjs              strict-enough semver comparison and validation
  frontmatter.mjs         dependency-free YAML subset parser for SKILL.md
  manifest.mjs            SKILL.md contract, field normalisation, directory-name check
  agents.mjs              agent path table (80 agents) plus runtime detection
  quality.mjs             deterministic 100-point authoring score
  security.mjs            22 rules + structural checks, suppression grammar, SARIF
  net.mjs                 fetch with retries/timeouts, GitHub API, blob and tarball cache
  tar.mjs                 streaming tar reader/writer on zlib, path-traversal defence
  registry.mjs            Ed25519 sign/verify, index search, entry construction
  source.mjs              resolve registry / GitHub / local / bundle specs into skill objects
  config.mjs              ~/.skillrig/config.json with safe defaults
  lockfile.mjs            project and global lockfiles, per-file hashes, drift verification
  installer.mjs           target resolution, conflict checks, atomic replace, security gate
  agentsmd.mjs            managed AGENTS.md block with markers and staleness detection
  mcp.mjs                 MCP stdio JSON-RPC server exposing 12 tools

src/data/agents.json      generated agent path catalogue
skills/                   18 curated skills, each with SKILL.md
packs/                    5 JSON pack definitions
registry/index.json       signed catalogue (generated)
registry/index.json.sig   Ed25519 signature record
registry/keys/            public key (the private key never enters the repo)
```

## Data flow: install

```
spec  ──► source.resolveSkills ──► skill {manifest, files, body, source, integrity}
                                        │
                                        ▼
                             security.scanFiles (threshold gates)
                                        │
                                        ▼
                       installer.resolveTargets (agent × scope → dirs)
                                        │
                                        ▼
                     conflict check ──► atomic write to temp dir
                                        │
                                        ▼
                          rename over target (backup on Windows)
                                        │
                                        ▼
                          lockfile.upsert + optional AGENTS.md sync
```

`resolveSkills` accepts six source forms:

| Source | Resolution |
| --- | --- |
| `codex-cli-workflows` | signed registry entry; curated files load from the package, upstream from a pinned commit |
| `owner/repo` | GitHub tree at the default branch; every valid skill in the repository |
| `owner/repo@skill` | one directory, discovered by walking the tree |
| `./my-skill` or `./SKILL.md` | local tree, hashed in place |
| `my-skill.skm` | signed tar.gz bundle, integrity checked before parsing |
| `pack/codex-starter` | pack expansion, then each member through the same pipeline |

The source resolver returns a **skill object**:

```js
{
  manifest,        // parsed and normalised frontmatter
  files,           // Map<relativePath, { data: Buffer, mode?: number }>
  body,            // SKILL.md body without frontmatter
  source,          // { type, repo, ref, path, url, commit }
  integrity,       // sha256 tree hash over path + content
  entry            // registry entry when the source came from the index
}
```

Everything downstream — scanning, installing, budget, AGENTS.md, MCP — consumes that object and nothing else. This is the main seam for new sources.

## The integrity chain

There are three independent checks.

### 1. Registry signature

`registry/index.json` is serialised deterministically by the build script. `scripts/sign-registry.mjs` signs the exact bytes with Ed25519 and writes:

```json
{
  "schemaVersion": 1,
  "algorithm": "ed25519",
  "keyId": "a159f773dbf9d466",
  "digest": "sha256:32f794…",
  "signature": "base64…",
  "signedAt": "2026-10-21T16:03:54.591Z"
}
```

`loadRegistry` verifies digest, signature, and key id before parsing any entry. A modified index fails closed even if it is syntactically valid JSON.

### 2. Skill tree hash

```
treeHash(files) =
  sha256( concat( path + "\0" + sha256(content) + "\n" for each file, sorted by path ) )
```

The hash covers every file under the skill directory, including references and scripts, but excludes OS noise (`.git`, `node_modules`, `__pycache__`) and SkillRig metadata. The algorithm is the same for curated skills, local directories, bundles, and upstream tarballs, so hashes are comparable across install paths.

For bundles and registry entries, the expected hash is compared **before** frontmatter parsing. A tampered archive therefore produces `IntegrityError` (exit 4), not a misleading "invalid skill" message.

### 3. Installed-file hashes

Every install writes a lockfile:

- project scope → `<repo>/.skillrig.lock.json`
- global scope → `~/.skillrig/lock.json`

```json
{
  "lockfileVersion": 1,
  "generatedBy": "skillrig@1.2.0",
  "updatedAt": "2026-10-21T16:04:00.000Z",
  "skills": {
    "codex-cli-workflows": {
      "version": "1.0.0",
      "source": { "type": "bundled", "path": "skills/codex-cli-workflows" },
      "integrity": "sha256:…",
      "installs": [
        {
          "agent": "codex",
          "scope": "project",
          "path": "…/.codex/skills/codex-cli-workflows",
          "integrity": "sha256:…",
          "files": { "SKILL.md": "sha256:…" },
          "installedAt": "…"
        }
      ]
    }
  }
}
```

`list`, `verify --installed`, `doctor`, and `audit` recompute the file map and report `ok`, `modified`, `missing`, or `extra`. The lockfile is the source of truth for **what SkillRig manages**; anything else in an agent directory is reported as unmanaged, not deleted.

## Multi-agent model

`src/data/agents.json` is a catalogue of 80 agents, each with a project path, a global path, documentation, and optional alternate locations. Codex, for example:

```
project  .codex/skills/        alternate  .agents/skills/
global   ~/.codex/skills/      alternate  ~/.agents/skills/
```

Target resolution de-duplicates by absolute path: installing for `codex` and `agents` when both resolve to the same directory results in one write with two aliases in the lockfile. This matters on Windows, where paths are case-insensitive; the de-duplication key is lower-cased.

The universal `.agents/skills/` target is special: it is read by a growing number of agents and is the cheapest way to share one installation across tools.

## Security scanner

`scanFiles` runs three passes:

1. **Line rules** — 22 deterministic regex rules across eight categories, with a negation-aware downgrade (`do not run curl | bash` is lower severity than `curl | bash`).
2. **Structural checks** — sensitive file names, executable permissions, hidden Unicode, HTML comments that hide instructions, broad `allowed-tools`.
3. **Suppression pass** — parses `skillrig-ignore` markers, records both active and suppressed findings, and never discards the suppressed ones.

Findings carry `ruleId`, `severity`, `file`, `line`, `excerpt`, `title`, and an optional suppression reason. Scores are a pure function of findings, so the same input always produces the same grade.

Install runs the scan before writing. A critical or high finding blocks unless the user passes `--allow-risky`; the override is recorded in the lockfile entry's security summary. `scan --sarif` emits SARIF 2.1.0 for code scanning.

See [security-model.md](security-model.md) for the rule table and threat model.

## Registry build pipeline

```
registry/sources.json ──► scripts/crawl.mjs ──► registry/upstream.json
                                                      │
skills/*/SKILL.md ───────────────┐                    │
packs/*.json ────────────────────┤                    │
                                 ▼                    ▼
                     scripts/build-registry.mjs ──► registry/index.json
                                                      │
                     ~/.skillrig/keys/*.private.pem ──► registry/index.json.sig
                                                      │
                    ┌─────────────────────────────────┼──────────────────────┐
                    ▼                                 ▼                      ▼
          plugins/skillrig/              .agents/plugins/marketplace.json   site/data.js
```

The crawler:

- resolves each source's default branch to a commit SHA and records it,
- reads the git tree through the GitHub API (one request per repository, not per file),
- caches blobs by SHA on disk, so re-crawls are cheap,
- honours a license allowlist and records `licenseStatus`,
- scans every skill and marks blocked entries,
- skips oversized files and binary content,
- never clones a repository or runs repository code.

The build merges curated, upstream, and pack entries, applies deterministic ordering, computes counts, and writes a single canonical JSON document. Signing is a separate step so that CI can verify a registry without access to the private key.

## Locking and concurrency

- Writes are staged in a sibling temp directory and renamed into place.
- On Windows, an existing target is renamed to a backup before the replacement, then removed; a failed rename restores the backup.
- Lockfiles are written with `atomicWriteFile` (temp file + rename).
- Two concurrent installs can still race at the final rename. The lockfile is last-writer-wins; `doctor` detects the resulting drift. A cross-process lock is intentionally out of scope for 1.0 because the common case is a single interactive install.

## Error and exit-code model

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | general failure, failed doctor check, or remove found nothing |
| 2 | usage error (bad flag, unknown agent, missing argument) |
| 3 | security gate failed |
| 4 | integrity or drift failure |

`bin/skillrig.mjs` prints a single-line error by default and the stack trace when `SKILLRIG_DEBUG=1`. Commands that support `--json` never mix human text into stdout.

## Extension points

| To add… | Change |
| --- | --- |
| A new agent | `src/data/agents.json` plus an override if paths need normalising; regenerate `docs/agents.md` |
| A new source type | `source.mjs`: return the standard skill object; everything else composes |
| A scanner rule | `security.mjs` `RULES`, a test, and the rule table in the docs |
| A pack | `packs/<name>.json`; run `npm run build` |
| A registry source | `registry/sources.json`; run `npm run crawl && npm run build` |
| A site section | `scripts/build-site.mjs` for data, `site/` for presentation |

## Testing strategy

Tests use `node:test` against real temporary directories. There is no mocking framework and no network:

- manifests and frontmatter: parser and validation edge cases,
- security: each rule, negation, suppression scopes, SARIF shape,
- registry: signing, tamper detection, search, counts,
- bundles: tar round-trip, traversal rejection, integrity-before-parse,
- install: multi-agent de-duplication, drift detection, conflict refusal,
- agents.md: managed block replacement and staleness,
- CLI: exit codes, JSON shapes, pack resolution, update scope preservation,
- MCP: initialize, tool listing, tool calls, unknown-tool errors.

The site and registry build scripts are exercised by `npm run build` in CI.

## Why not a database, server, or daemon

A package manager that needs a service to install a text file has inverted the risk it claims to reduce. The registry is a signed JSON file; the installer is a CLI; the marketplace is static HTML. The only long-running process is the optional MCP server, and it speaks stdio with no network listener. This keeps the attack surface and the operational burden small enough for one maintainer to defend.
