# Command reference

SkillRig 1.2.0. Every command accepts the [global options](#global-options). Commands that support `--json` write machine-readable output to stdout and nothing else.

```
skillrig <command> [options]
skr <command> [options]        alias
```

## Global options

| Option | Effect |
| --- | --- |
| `-j`, `--json` | Machine-readable output |
| `-q`, `--quiet` | Suppress human-readable output; JSON is unaffected |
| `--no-color` | Disable ANSI colour |
| `--cwd <path>` | Project directory (default: current directory) |
| `--home <path>` | Home directory used for install paths (default: the user's home) |
| `-v`, `--verbose` | Print stack traces for unexpected errors |
| `-h`, `--help` | Command help |

Command aliases: `ls` → `list`, `uninstall`/`rm` → `remove`, `i`/`add` → `install`, `s` → `search`, `rec` → `recommend`, `docs` → `info`.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General failure, doctor errors, or nothing removed |
| 2 | Usage error |
| 3 | Security gate failed |
| 4 | Integrity or drift failure |

---

## `search`

```
skillrig search [query] [--category <name>] [--grade <A+|A|B|C>]
              [--security <badge>] [--license <spdx>]
              [--sort relevance|quality|updated|name] [--limit <n>] [--json]
```

Searches the signed index by name, description, tags, category, author, and repository. Every query token must match; a multi-word query narrows.

```bash
skillrig search
skillrig search migration --category database
skillrig search --grade A+ --security clean --limit 10
skillrig search codex --json
```

With no query, results are sorted by quality and limited to 20. With a query, relevance is the default sort and the limit is 25. Blocked entries still appear; `install` is where the block applies.

JSON shape: `{ query, count, skills: [...] }`.

## `recommend`

```
skillrig recommend <query> [--category <name>] [--agent <id>]
                   [--include-blocked] [--limit <n>] [--json]
```

Ranks the registry for a task described in plain language. Name matches weigh most, then tags, categories, repository, and description; coverage across every query token breaks ties. Installable entries beat blocked ones, verified and official entries get a small bonus, and quality is the final tie-breaker.

```bash
skillrig recommend "review a pull request before merging"
skillrig recommend "build an MCP server" --agent codex
skillrig recommend "export a spreadsheet" --json
```

JSON shape: `{ query, total, results: [{ ...entry, score, matched }] }`.

## `stats`

```
skillrig stats [--json]
```

Summarizes the signed index: total and installable entries, trust composition, quality grades, security badges, licences, content volume, top categories, and the upstream repositories that contributed the most entries.

```bash
skillrig stats
skillrig stats --json
```

JSON shape: the object returned by `registryStats()`, including `byTrust`, `byGrade`, `bySecurity`, `byLicense`, `bySource`, and `topCategories`.

## `info`

```
skillrig info <name|owner/repo@skill|pack/name> [--json]
```

Prints description, trust, quality, security, licence, source, integrity, dependencies, and the exact install command. Packs list their members with grades.

```bash
skillrig info codex-cli-workflows
skillrig info pack/codex-starter
skillrig info openai/skills@skill-creator --json
```

## `install`

```
skillrig install <source...> [--skill <name>] [--all] [--ref <branch|sha>]
                [--agent <id>] [--scope global|project] [--pack <name>]
                [--force] [--dry-run] [--allow-risky] [--fail-on <severity>] [--json]
```

Installs from:

| Source | Example |
| --- | --- |
| Registry name | `codex-cli-workflows` |
| Pack | `pack/secure-agent` or `--pack secure-agent` |
| GitHub repository | `openai/skills` |
| GitHub skill | `openai/skills@skill-creator` |
| GitHub URL | `https://github.com/owner/repo/tree/main/skills/name` |
| Local directory or file | `./my-skill` or `./my-skill/SKILL.md` |
| Bundle | `./my-skill-1.0.0.skm` |

Options:

| Option | Effect |
| --- | --- |
| `--skill <name>` | Select one skill when a repository or directory contains several |
| `--all` | Install every valid skill in a repository, directory, or bundle |
| `--ref <branch\|sha>` | GitHub ref; defaults to the default branch or the pinned commit for indexed entries |
| `--agent <id>` | Target agent; repeat or pass a comma list. Defaults to `codex` |
| `--scope global\|project` | Global or project install. Defaults to the configured scope (`global`) |
| `--pack <name>` | Shorthand for `pack/<name>` |
| `--force` | Replace a same-name directory, including one not created by SkillRig |
| `--dry-run` | Resolve, scan, and report without writing |
| `--allow-risky` | Proceed despite critical or high findings, or a blocked registry entry |
| `--fail-on <severity>` | Security gate: `critical`, `high` (default), `medium`, `low`, `none` |

Behaviour:

- Resolves and scans before writing.
- Refuses a blocked registry entry unless `--allow-risky`.
- Refuses a same-name unmanaged directory unless `--force`.
- Refuses conflicting installed skills declared in `metadata.skillrig.conflicts`.
- De-duplicates agents that resolve to the same directory.
- Writes atomically and records every file hash in the lockfile.
- Prints a licence warning for non-permissive upstream skills.

```bash
skillrig install codex-cli-workflows
skillrig install codex-cli-workflows --agent codex,claude-code --scope project
skillrig install pack/codex-starter
skillrig install vercel-labs/skills --all --dry-run
skillrig install openai/skills@skill-creator --agent agents
skillrig install ./dist/my-skill.skm --allow-risky
```

## `remove`

```
skillrig remove <name...> [--agent <id>] [--scope global|project] [--all-scopes] [--force] [--json]
```

Removes only installs recorded in a lockfile, and only from the expected agent directory. Refuses paths outside that directory and refuses a directory without `SKILL.md` unless `--force`.

```bash
skillrig remove codex-cli-workflows
skillrig remove codex-cli-workflows --all-scopes
```

Exit 1 when no matching install exists. JSON shape: `{ removed: [...], notFound: [...] }`.

## `list`

```
skillrig list [--agent <id>] [--scope global|project] [--json]
```

Lists tracked installs with version, agent, scope, drift status, and path.

```bash
skillrig list
skillrig list --scope project --json
```

Status is `ok`, `modified`, `missing`, or `extra`. `modified` means at least one installed file no longer matches the lockfile.

## `update`

```
skillrig update [name...] [--all] [--dry-run] [--force] [--allow-risky] [--agent <id>] [--scope <scope>] [--json]
```

Reinstalls each skill into its **original** agent and scope. Curated skills update from the package; upstream skills update from their recorded source. Local-directory and bundle installs are skipped with a message.

```bash
skillrig update --all --dry-run
skillrig update codex-cli-workflows
skillrig update --all --scope project
```

## `doctor`

```
skillrig doctor [--fix] [--json]
```

Checks:

- lockfile parse errors,
- changed, missing, and extra files per install,
- installed dependencies (`metadata.skillrig.requires`) that are absent,
- version skew between installs of the same skill,
- unmanaged skill directories in agent paths,
- a missing or stale managed block in `AGENTS.md`.

`--fix` regenerates the `AGENTS.md` block for project-scope installs. It does not modify skill files.

Exit 1 when any `error`-severity issue is found.

## `scan`

```
skillrig scan <source...> [--fail-on critical|high|medium|low|none] [--strict]
               [--show-suppressed] [--sarif] [--json] [--all]
```

Scans without installing. Sources are the same forms as `install`.

| Option | Effect |
| --- | --- |
| `--fail-on` | Exit 3 if a finding meets or exceeds this severity (default `high`) |
| `--strict` | Ignore every `skillrig-ignore` marker |
| `--show-suppressed` | Print suppressed findings and their reasons |
| `--sarif` | Emit SARIF 2.1.0 instead of a table |
| `--json` | Emit structured results |
| `--all` | Scan every skill in a repository or directory |

```bash
skillrig scan skills/codex-cli-workflows
skillrig scan own/repo@skill --show-suppressed
skillrig scan skills --all --fail-on medium
skillrig scan codex-cli-workflows --sarif > skillrig.sarif
```

Exit 3 when the gate fails and `--fail-on` is not `none`.

## `audit`

```
skillrig audit [--fail-on <severity>] [--json]
```

Re-scans every installed skill from disk. Useful after pulling changes or before shipping an agent configuration.

```bash
skillrig audit
skillrig audit --fail-on medium
```

Exit 3 when any finding meets the threshold.

## `verify`

```
skillrig verify [--registry] [--installed] [<path>] [--expect <treeHash>] [--json]
```

Three modes:

1. **Registry** (default): verify the Ed25519 signature, digest, and key id of the bundled index.
2. **`--installed`**: recompute file hashes for every tracked install.
3. **`<path>`**: compute the tree hash of a directory; `--expect` compares it.

```bash
skillrig verify
skillrig verify --installed
skillrig verify ./my-skill --expect sha256:abc…
```

Exit 4 on signature, digest, key-id, or file-hash mismatch.

## `budget`

```
skillrig budget [--warn-at <tokens>] [--json]
```

Estimates context cost for installed skills:

- **always-on** — name and description loaded into every session,
- **activation** — body and references loaded when the skill activates,
- **total** — their sum.

Tokens are estimated at four characters per token. `--warn-at` defaults to 1500 always-on tokens.

```bash
skillrig budget
skillrig budget --warn-at 900 --json
```

## `init`

```
skillrig init [name] [--dir <path>] [--description <text>] [--force]
```

Creates `skills/<name>/SKILL.md` plus `references/checklist.md`. The scaffold is designed to pass the quality gate once the placeholders are replaced. `--description` overrides the generated trigger. `--force` overwrites an existing `SKILL.md`.

```bash
skillrig init sql-migration-review --description "Use when reviewing a SQL migration before production."
skillrig init my-skill --dir ./custom/location
```

## `pack`

```
skillrig pack <dir...> [--name <name>] [--version <semver>] [--out <file.skm>] [--key <pem>]
```

Builds a `.skm` tar.gz bundle from one or more skill directories. The default output is `<name>-<version>.skm`.

- `--name` defaults to the single skill's name, or `skillrig-bundle`.
- `--key` signs the bundle manifest with an Ed25519 private key (path or PEM/base64 value).
- Bundles preserve file modes and reject unsafe paths on extraction.

```bash
skillrig pack skills/codex-cli-workflows
skillrig pack skills/codex-cli-workflows skills/repo-onboarding \
  --name starter --version 1.0.0 --out starter.skm
skillrig pack ./my-skill --key ~/.skillrig/keys/skillrig.private.pem
```

## `publish`

```
skillrig publish <dir> [--name <name>] [--version <semver>] [--key <pem>] [--out <file>]
```

Builds a signed bundle (when `--key` is given), prints its digest, and emits registry entries with quality, security, integrity, and source metadata. It does not mutate `registry/index.json`; registry changes go through a pull request and a maintainer-signed rebuild.

```bash
skillrig publish skills/my-skill --key ~/.skillrig/keys/skillrig.private.pem --out my-skill.skm
```

## `migrate`

```
skillrig migrate [--from <dir>] [--to <agent>] [--scope global|project] [--dry-run]
                 [--agent <id>] [--fail-on <severity>] [--allow-risky] [--force] [--json]
```

Imports skills from another agent's directory. `--from` defaults to `~/.claude/skills`; `--to` (or `--agent`) defaults to `codex`. Every skill goes through the normal scan and gate.

```bash
skillrig migrate --dry-run
skillrig migrate --to claude-code --scope project
skillrig migrate --from ~/.cursor/skills --to agents
```

## `mcp`

```
skillrig mcp
```

Runs an MCP server over stdio. No network listener. See [MCP tools](#mcp-tools) below.

Codex configuration:

```toml
[mcp_servers.skillrig]
command = "skillrig"
args = ["mcp"]
```

## `targets`

```
skillrig targets [--json]
```

Lists all 80 supported agents with global path, project path, and whether the agent's binary is detected on this machine.

## `sync`

```
skillrig sync [--json]
```

Writes or refreshes the managed block in `AGENTS.md` for project-scope installs. The block is delimited by `<!-- skillrig:start -->` and `<!-- skillrig:end -->`; text outside it is never changed.

```bash
skillrig sync
```

## `config`

```
skillrig config [list|get <key>|set <key> <value>|path] [--json]
```

Configuration lives at `~/.skillrig/config.json` (mode 0600). Keys:

| Key | Default | Meaning |
| --- | --- | --- |
| `defaultAgents` | `["codex"]` | Agents used when `--agent` is omitted |
| `defaultScope` | `"global"` | `global` or `project` |
| `security.failOn` | `"high"` | Install-time gate |
| `security.allowRisky` | `false` | When `true`, risky installs are allowed without the flag. The flag enables them when config is `false`; there is no `--no-allow-risky`. |
| `contextBudget.warnAtTokens` | `1500` | Default warning threshold for `budget` |

Dotted keys are written as nested objects.

```bash
skillrig config list
skillrig config get defaultScope --json
skillrig config set defaultScope project
skillrig config set security.failOn medium
skillrig config path
```

## `completion`

```
skillrig completion <bash|zsh|fish|powershell>
```

Prints a completion script. Install it in the usual place for your shell:

```bash
skillrig completion bash > ~/.local/share/bash-completion/completions/skillrig
skillrig completion zsh > "${fpath[1]}/_skillrig"
skillrig completion fish > ~/.config/fish/completions/skillrig.fish
skillrig completion powershell | Out-String | Invoke-Expression
```

## `version`

```bash
skillrig version
```

Prints the CLI version.

## MCP tools

The server exposes twelve tools over stdio JSON-RPC 2.0:

| Tool | Purpose |
| --- | --- |
| `skillrig_search` | Search the registry |
| `skillrig_recommend` | Rank skills for a described task |
| `skillrig_stats` | Registry composition and coverage |
| `skillrig_info` | Metadata for a skill or pack |
| `skillrig_install` | Install a skill, gated by the security policy |
| `skillrig_remove` | Remove tracked installs |
| `skillrig_list` | List installs and drift |
| `skillrig_scan` | Scan a source |
| `skillrig_audit` | Re-scan installed skills |
| `skillrig_budget` | Context cost |
| `skillrig_doctor` | Diagnose installs |
| `skillrig_sync` | Refresh the `AGENTS.md` block |

The server implements `initialize`, `tools/list`, `tools/call`, `prompts/list`, and `ping`. Unknown tools return an `isError` result rather than terminating the server.

## Environment variables

| Variable | Effect |
| --- | --- |
| `SKILLRIG_HOME` | Override `~/.skillrig` (config, lockfile, keys, cache) |
| `SKILLRIG_CACHE_DIR` | Override the GitHub blob/tarball cache |
| `SKILLRIG_GITHUB_TOKEN` | GitHub token for API rate limits |
| `GITHUB_TOKEN`, `GH_TOKEN` | Fallbacks for the same token |
| `SKILLRIG_DEBUG` | Print stack traces |
| `NO_COLOR` | Disable ANSI colour |
| `SKILLRIG_QUIET` | Suppress human-readable output |

Credentials are read from the environment only. SkillRig never writes a token to disk.
