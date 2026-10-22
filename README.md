# SkillRig

**A signed skill registry and zero-dependency installer for Codex and 80 coding agents.**

**Live registry:** [lixiao199115.github.io/skillrig](https://lixiao199115.github.io/skillrig/) — search 15,275 entries, read the inspection ledger, copy install commands.

[![CI](https://github.com/LIXIAO199115/skillrig/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/LIXIAO199115/skillrig/actions/workflows/ci.yml)
[![CodeQL](https://github.com/LIXIAO199115/skillrig/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/LIXIAO199115/skillrig/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-14150f?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-14150f?style=flat-square)](package.json)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-f04e23?style=flat-square)](package.json)
[![Skills](https://img.shields.io/badge/skills-15%2C275-1f5c45?style=flat-square)](registry/index.json)
[![Agents](https://img.shields.io/badge/agents-80-1f5c45?style=flat-square)](docs/agents.md)
[![Registry](https://img.shields.io/badge/registry-ed25519%20signed-f04e23?style=flat-square)](registry/index.json.sig)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/LIXIAO199115/skillrig/badge)](https://securityscorecards.dev/viewer/?uri=github.com/LIXIAO199115/skillrig)

SkillRig is a package manager, security scanner, and curated registry for `SKILL.md` agent skills. It works with Codex, Claude Code, Cursor, Gemini CLI, Qwen Code, OpenCode, Qoder, and [72 more agents](docs/agents.md) — because they all read the same format.

It is also the world's largest **verified, signed, installable** skill registry. "Verified" has a fixed meaning here: a valid `SKILL.md`, a unique name after content deduplication, SHA-256 hashes over every selected file, a 22-rule security scan, and an entry inside an Ed25519-signed index. Raw scrape counts do not enter this number. The live [registry comparison](https://lixiao199115.github.io/skillrig/#record) and [stats.json](https://lixiao199115.github.io/skillrig/stats.json) publish the evidence and the current totals.

Most skill collections ask you to trust a git clone. SkillRig gives every install a paper trail: a signed index, per-file SHA-256 hashes, a security scan with severity gates, a lockfile with drift detection, and a local audit command.

```bash
node bin/skillrig.mjs install codex-cli-workflows --agent codex
```

> 15,275 skills in the bundled registry · 18 curated and maintained here · 15,257 indexed from 76 upstream repositories · 591 blocked by the security gate · 13 packs · 0 runtime dependencies.

---

## Why this exists

Agent skills are executable instructions. A skill can tell an agent to read `~/.ssh`, pipe a remote script into bash, silently rewrite git history, or hide instructions in an HTML comment. Marketplaces usually show a name and a description, then hand that file straight to your agent.

We scanned all 15,275 indexed skills. 591 entries were blocked and 3,615 findings were recorded, 495 of them critical. The full breakdown, method, and caveats are in [docs/security-report.md](docs/security-report.md).

SkillRig treats a skill like a package:

| Risk | What SkillRig does |
| --- | --- |
| Tampered registry | Ed25519 signature over the full index; the public key ships with the CLI |
| Tampered skill files | SHA-256 tree hash per skill, verified before install and on every `audit` |
| Malicious instructions | Static scanner with critical/high/medium/low gates; blocked entries cannot install without `--allow-risky` |
| Silent drift | Project and global lockfiles record every file hash; `doctor` and `list` report modified or missing files |
| Context bloat | `budget` measures always-on and activation token cost before your window fills up |
| Multi-agent drift | One source of truth installed into 80 agent directories, with per-agent paths listed in `targets` |

Suppressions are explicit and auditable. A skill can suppress a finding with a documented reason, and `scan --show-suppressed` still shows what was hidden.

---

## Quick start

**Requirements:** Node.js 20.11 or newer. No package install, no dependencies.

```bash
git clone https://github.com/LIXIAO199115/skillrig.git
cd skillrig

# Explore the registry
node bin/skillrig.mjs search codex
node bin/skillrig.mjs info codex-cli-workflows

# Install for Codex (project scope)
node bin/skillrig.mjs install codex-cli-workflows --agent codex --scope project

# Or install for every agent that shares .agents/skills
node bin/skillrig.mjs install pack/secure-agent --agent agents

# Verify what landed on disk
node bin/skillrig.mjs verify --installed
node bin/skillrig.mjs audit
```

To get the `skillrig` and `skr` commands on your PATH:

```bash
npm link
skillrig --help
```

### Install as a Codex plugin marketplace

SkillRig also ships a Codex plugin marketplace, verified against `codex-cli 0.154.0`:

```bash
codex plugin marketplace add LIXIAO199115/skillrig
codex plugin add skillrig@skillrig
```

The plugin exposes all 18 curated skills inside Codex. Codex caches the plugin at `~/.codex/plugins/cache/skillrig/skillrig/<version>/`; refresh the marketplace with `codex plugin marketplace upgrade` after updating.

---

## What you get

### 1. A signed registry

`registry/index.json` is signed with Ed25519. The signature record includes a key id, SHA-256 digest, and timestamp. The CLI verifies both the digest and the signature before reading a single skill.

```bash
skillrig verify
# registry verified: 15,275 skills, 13 packs
# key        a159f773dbf9d466
# digest     sha256:7d6bc00cd934...
# signed     2026-10-22T06:24:30.323Z
```

Registry entries carry trust level (`official`, `community`), license status (`permissive`, `copyleft`, `review`, `unlicensed`), quality score, security badge, and a `blocked` flag.

### 2. A scanner that reads the instructions

The scanner checks every text file in a skill, not just `SKILL.md`. It covers:

- remote shell execution, `curl | bash`, encoded payloads, PowerShell `iex`
- credential reads (`.ssh`, `.aws`, `.npmrc`, `.env`), secrets in files, exfiltration instructions
- destructive filesystem and git operations, `sudo`, `chmod 777`
- prompt injection, hidden Unicode, instruction-hiding HTML comments
- broad `allowed-tools` declarations
- executable files and sensitive file names

Severity gates are configurable (`critical`, `high`, `medium`, `low`, `none`). `scan` emits a human table or SARIF 2.1.0 for CI.

```bash
skillrig scan owner/repo@skill --fail-on high --sarif > skillrig.sarif
```

### 3. One command, eighty agents

```bash
skillrig targets                    # all supported agents and paths
skillrig install sql-migration-review --agent codex,claude-code,cursor
skillrig install pack/backend-pack --agent agents     # universal .agents/skills
```

Use `--scope project` to write into the repository (committed with your code) or `--scope global` for your machine. Install paths are documented per agent in [docs/agents.md](docs/agents.md).

### 4. Packs, not piles

Packs group skills that are useful together:

| Pack | Purpose |
| --- | --- |
| `pack/codex-starter` | Codex CLI, repo onboarding, skill authoring, plugins, context budget |
| `pack/secure-agent` | Skill security review, dependency audit, MCP server builder |
| `pack/ship-it` | Tests, PR review, docs, release engineering |
| `pack/debug-pack` | Terminal debugging, regression tests, git recovery, profiling |
| `pack/backend-pack` | API contracts, SQL migrations, performance, incident postmortems |

```bash
skillrig info codex-starter
skillrig install pack/codex-starter --agent codex
```

### 5. Drift detection and context budgets

Every install writes a lockfile (`.skillrig-lock.json` for projects, `~/.skillrig/lock.json` globally) with the SHA-256 of every file.

```bash
skillrig list                    # ok / modified / missing
skillrig doctor                  # unused installs, version skew, stale AGENTS.md
skillrig budget --warn-at 1500   # always-on + activation tokens
skillrig sync                    # managed skills block in AGENTS.md
```

### 6. MCP server

Give an agent the ability to search, inspect, scan, install, and audit skills through the Model Context Protocol:

```bash
skillrig mcp
```

Twelve tools are exposed, including `skillrig_search`, `skillrig_recommend`, `skillrig_stats`, `skillrig_scan`, `skillrig_install`, `skillrig_audit`, `skillrig_budget`, and `skillrig_doctor`. Works with Codex and any MCP client that speaks stdio JSON-RPC.

### 7. Publish with provenance

```bash
skillrig init my-skill --description "Use when ..."
skillrig scan my-skill
skillrig pack my-skill --out my-skill.skm --key ~/.skillrig/keys/skillrig.private.pem
skillrig publish my-skill --key ~/.skillrig/keys/skillrig.private.pem
```

`publish` prints a registry entry with integrity, quality, and security metadata, ready for a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## The registry today

| Metric | Value |
| --- | --- |
| Total skills | 15,275 |
| Curated and maintained in this repo | 18 |
| Indexed from upstream repositories | 15,257 |
| Upstream repositories | 76 |
| Blocked by the security gate | 591 |
| Packs | 13 |
| Average quality score | 73 / 100 |
| Clean security badge | 13,266 |
| Supported agents | 80 |

Upstream sources include `openai/skills`, `anthropics/skills`, `google/skills`, `googleworkspace/cli`, `microsoft/SkillOpt`, `cloudflare/security-audit-skill`, `sickn33/antigravity-awesome-skills`, `LeoYeAI/openclaw-master-skills`, `TerminalSkills/skills`, `mukul975/Anthropic-Cybersecurity-Skills`, `thedaviddias/Front-End-Checklist`, and 65 more. The full 76-repository provenance table, with commit SHAs and license status, is in [`registry/sources.json`](registry/sources.json). Each indexed skill pins a commit SHA and links back to the exact directory.

Two repositories are listed but not indexed. `JimLiu/baoyu-skills` (~34 MB, mostly image assets) is excluded to keep installs small, and `jpcaparas/superpowers-laravel` uses namespaced names such as `laravel:ai-sdk` that cannot be installed as a directory on Windows. Both records stay in `registry/sources.json` with the reason.

### The 18 curated skills

| Skill | Use it when |
| --- | --- |
| `agent-skill-author` | Writing or reviewing a `SKILL.md` |
| `api-contract-review` | Reviewing HTTP, GraphQL, or gRPC contracts |
| `codex-cli-workflows` | Running Codex CLI in real projects, scripts, and CI |
| `codex-plugin-author` | Building a Codex plugin or marketplace |
| `context-budget` | Sessions feel bloated, slow, or forgetful |
| `dependency-audit` | Adding, upgrading, or auditing dependencies |
| `docs-writer` | Writing or restructuring documentation |
| `git-recovery` | Recovering lost commits, branches, or worktrees |
| `incident-postmortem` | Writing a blameless postmortem with evidence |
| `mcp-server-builder` | Building or reviewing an MCP server |
| `performance-profile` | Finding and fixing a performance bottleneck |
| `pr-reviewer` | Reviewing a pull request or agent-authored patch |
| `release-engineer` | Cutting a release, versioning, changelog, rollback |
| `repo-onboarding` | Entering an unfamiliar repository |
| `skill-security-review` | Auditing a skill before installing it |
| `sql-migration-review` | Reviewing a database migration |
| `terminal-debugger` | Debugging a failing command or environment |
| `test-first-fix` | Fixing a bug test-first |

All 18 pass the quality gate at 100/100 (A+) and the security scanner at A+ (one informational `sudo` finding in `terminal-debugger`, documented).

---

## Commands

| Command | What it does |
| --- | --- |
| `skillrig search [query]` | Search by name, description, tags, category, source |
| `skillrig recommend <task>` | Rank skills for a described task |
| `skillrig stats` | Registry composition, coverage, top sources |
| `skillrig info <name\|pack>` | Full metadata, source, license, integrity, security |
| `skillrig install <source...>` | Registry, GitHub, local path, `.skm` bundle, or pack |
| `skillrig remove <name...>` | Remove tracked installs only |
| `skillrig list` | Installed skills with drift status |
| `skillrig update <name...\|--all>` | Reinstall from the original source |
| `skillrig doctor [--fix]` | Lockfile, dependency, skew, unmanaged, AGENTS.md |
| `skillrig scan <source>` | Security scan with gates and SARIF |
| `skillrig audit` | Re-scan every installed skill |
| `skillrig verify [--registry\|--installed\|<path>]` | Signature or file integrity |
| `skillrig budget` | Context cost of installed skills |
| `skillrig init <name>` | Scaffold a complete `SKILL.md` |
| `skillrig pack <dir...>` | Build a `.skm` bundle |
| `skillrig publish <dir>` | Signed bundle plus registry entry |
| `skillrig migrate --from <dir>` | Import skills from another agent |
| `skillrig targets` | 80 agents with global and project paths |
| `skillrig sync` | Managed block in `AGENTS.md` |
| `skillrig config [list\|get\|set\|path]` | Default agents, install scope, security policy |
| `skillrig mcp` | MCP stdio server |
| `skillrig completion <shell>` | bash, zsh, fish, PowerShell |

Full reference: [docs/commands.md](docs/commands.md).

---

## Security model

**Threat model.** SkillRig assumes the registry can be served over an untrusted network, upstream repositories can be compromised, and a skill can contain hostile instructions. It does not assume the scanner catches everything.

**Defenses.**

1. Ed25519 signature over the canonical index bytes, verified before parsing skills.
2. Per-skill tree hash over every file (path, mode, content), pinned in the lockfile.
3. Static analysis with severity gates before install (`--fail-on`, `--allow-risky`).
4. No automatic execution of skill scripts during install or scan.
5. Writes are restricted to agent skill directories; removal refuses paths outside them.
6. Upstream entries are fetched at a pinned commit, not a moving branch.
7. Suppressed findings are recorded, counted, and available with `--show-suppressed`.

**Non-goals.** The scanner is not a sandbox. A skill can still contain clever text that influences an agent. Treat third-party skills as code review material, prefer curated entries, and run `scan` before `--allow-risky`.

Full details: [SECURITY.md](SECURITY.md) and [docs/security-model.md](docs/security-model.md).

---

## Adding a skill

1. `skillrig init my-skill --description "Use when ..."`
2. Put reusable detail in `references/`, scripts in `scripts/`.
3. `skillrig scan my-skill` — resolve every finding or suppress it with a documented reason.
4. `npm run validate` — quality gate 70, security gate high.
5. Open a pull request using the skill submission template.

Read [docs/skill-spec.md](docs/skill-spec.md) for the frontmatter and folder contract.

---

## Development

```bash
npm test                # 51 tests, no network
npm run validate        # all skills: quality + security
npm run build           # registry + plugin + site
npm run build:registry  # curated + upstream -> registry/index.json
npm run sign            # sign the index (requires ~/.skillrig/keys/skillrig.private.pem)
npm run verify          # verify index signature
npm run build:plugin    # sync plugins/skillrig + Codex marketplace
npm run build:site      # generate site/data.js
```

The project has **zero runtime dependencies**. Everything uses Node built-ins: `node:crypto`, `node:zlib`, `node:test`.

Architecture: [docs/architecture.md](docs/architecture.md). Registry format: [docs/registry.md](docs/registry.md). Codex integration: [docs/codex.md](docs/codex.md).

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Security reports: use GitHub private vulnerability reporting, not a public issue. See [SECURITY.md](SECURITY.md).

---

## License

MIT. Upstream skills keep their original licenses; SkillRig records the license and links to the source directory for every indexed skill.

Built and maintained by [Li Xiaocheng](https://github.com/LIXIAO199115).
