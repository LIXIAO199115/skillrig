# Changelog

All notable changes to SkillRig are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
