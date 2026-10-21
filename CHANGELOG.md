# Changelog

All notable changes to SkillRig are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-10-21

The scale release.

### Registry

- **7,909 skills** (18 curated + 7,891 upstream) indexed from **35 repositories** at pinned commit SHAs, up from 354 and 8.
- **428 entries blocked** by the security gate; 7,481 installable.
- **13 packs**, including `security-hardening`, `frontend-craft`, `product-launch`, `data-workbench`, `docs-and-decks`, `incident-response`, `agent-builder`, and `codex-power`.
- License status, trust level, quality grade, security badge, file count, and body size on every entry.
- Scanner tuning cut false positives on documentation, TypeScript declarations, security examples, and normal `systemctl`/`crontab` operations. Prompt-injection and obfuscation rules now apply only to instruction files.

### CLI

- `skillrig recommend <task>` ranks the whole catalog for a described job, with category and agent filters.
- `skillrig stats` prints composition, quality distribution, security distribution, license mix, content size, top categories, and top sources.
- 22 commands, including the `rec` alias.

### MCP

- `skillrig_recommend` and `skillrig_stats` added; the stdio server now exposes **12 tools**.

### Site

- Registry browser handles 7,909 entries with 48-row paging, fast search, category/trust/source filters, and shareable URL state (`q`, `filter`, `cat`, `trust`, `src`, `sort`).
- Source provenance table shows trust, pinned commit, license, indexed count, blocked count, and external-catalog status.
- Site payload cut from 8.4 MB to 4.6 MB (0.98 MB gzip) by deduplicating source records and removing repeated fields.
- Edition labels and metadata updated to 1.1.

### Documentation

- English and Chinese READMEs, registry format, command reference, architecture, and Codex guide updated to the new scale.
- 51 tests pass; lint reports 0 errors and 0 warnings.

## [1.0.0] — 2026-10-21

First public release.

### Registry

- Ed25519-signed `registry/index.json` with a key id, SHA-256 digest, and signing timestamp.
- **354 skills**: 18 curated in this repository, 336 indexed from 8 upstream repositories at pinned commit SHAs.
- **5 packs**: `codex-starter`, `secure-agent`, `ship-it`, `debug-pack`, `backend-pack`.
- Every entry carries trust level, license status, quality score, security grade, per-file tree hash, file count, and body size.
- **15 entries blocked** by the security gate; blocked skills cannot be installed without an explicit override.
- Three large repositories are listed as external catalogs rather than indexed.

### Installer

- Zero runtime dependencies; Node.js 20.11+ and ESM only.
- Install from the registry, `owner/repo`, `owner/repo@skill`, a local directory, a `.skm` bundle, or a pack.
- **80 supported agents** with global and project paths, including Codex, Claude Code, Cursor, Gemini CLI, Qwen Code, OpenCode, and Qoder.
- Project and global lockfiles record the SHA-256 of every installed file.
- Drift detection in `list`, `verify --installed`, `doctor`, and `audit`.
- `update` reinstalls each skill into its original agent and scope.
- Managed skills block in `AGENTS.md`, with staleness detection.

### Security

- Static scanner covering remote execution, credential access, exfiltration, destructive operations, prompt injection, hidden Unicode, and tool overreach.
- Severity gates `critical`, `high`, `medium`, `low`, `none`, plus SARIF 2.1.0 output for CI.
- Inline suppression grammar with required rationale; suppressed findings remain inspectable with `--show-suppressed`.
- Integrity is verified before frontmatter parsing, so a tampered bundle reports an integrity error rather than a validation error.
- Skill scripts are never executed during install, scan, or audit.
- Writes are restricted to known agent skill directories; removal refuses paths outside them.

### Interfaces

- 19 CLI commands plus `skr` alias, JSON output, colour control, and shell completion for bash, zsh, fish, and PowerShell.
- MCP stdio server with 10 tools: search, info, install, remove, list, scan, audit, budget, doctor, sync.
- Codex plugin marketplace at `.agents/plugins/marketplace.json`; verified with `codex-cli 0.154.0`.
- Static marketplace site generated from the signed index.
- 48 tests on Node's built-in test runner, no network access required.

### Documentation

- English and Chinese READMEs, security policy, architecture notes, registry format, skill authoring contract, command reference, Codex integration guide, and an 80-agent support table.
