---
name: codex-cli-workflows
description: Use when running OpenAI Codex CLI for real work, including interactive sessions, non-interactive codex exec in scripts or CI, sandbox and approval decisions, structured JSON output, session resume, MCP server registration, config profiles, and debugging why Codex ignores AGENTS.md, skills, or plugins.
license: MIT
compatibility: Verified against codex-cli 0.154.0. Flags change between releases; run codex <command> --help before relying on a flag in automation.
metadata:
  version: 1.0.0
  author: SkillRig
  category: codex
  tags: [codex, cli, automation, sandbox, ci]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Codex CLI Workflows

Codex CLI has three surfaces that are easy to confuse: the interactive TUI, the non-interactive `codex exec` runner, and the configuration that both share. Most failed automation comes from treating one like another. This skill gives a working sequence for each.

## When to use

Use this skill when any of these are true:

- You are about to hand a repository to Codex and need to choose a sandbox and working directory.
- A script or CI job must call Codex and consume a machine-readable result.
- A long task needs to continue across process restarts.
- Codex cannot see an MCP server, skill, plugin, or `AGENTS.md` file.
- A Codex command behaves differently on Windows, macOS, and Linux.
- You are writing documentation or a skill for Codex and need verified command syntax.

## Surface map

| Need | Surface | Command |
| --- | --- | --- |
| Human-in-the-loop work | TUI | `codex` |
| One-shot task, logs, CI | Exec | `codex exec "..."` |
| Review current changes | Review | `codex exec review` |
| Continue prior work | Resume | `codex exec resume --last` |
| External tools | MCP | `codex mcp add/list/get/remove` |
| Reusable bundles | Plugins | `codex plugin marketplace add`, `codex plugin add` |
| Health check | Doctor | `codex doctor` |

`codex exec` is the only surface that should appear in automation. The TUI waits for a human and is not scriptable.

## Workflow 1: open an unfamiliar repository safely

Start read-only, learn the shape, then widen access.

```bash
codex doctor
codex exec -s read-only -C /path/to/repo "Map the build, test, and deploy commands. Read AGENTS.md and any README. Return a plan only; do not modify files."
```

Then, after you have reviewed the plan:

```bash
codex exec -s workspace-write -C /path/to/repo "Implement step 1 of the plan. Run the focused test suite. Stop if a test fails twice."
```

Rules that prevent most incidents:

1. Read-only first on any repository you did not write.
2. `workspace-write` only after a clean Git status, so `git diff` is the audit trail.
3. `--add-dir` for extra writable paths instead of widening the whole sandbox.
4. `danger-full-access` only inside a disposable container or VM.
5. Never place tokens, customer data, or private keys in prompts, `AGENTS.md`, or repository files.

## Workflow 2: non-interactive execution in CI

```bash
codex exec \
  --sandbox read-only \
  --cd "$GITHUB_WORKSPACE" \
  --json \
  --output-last-message codex-final.md \
  "Review the diff against origin/main. Report blocking defects with file:line and a reproduction command. Do not edit files."
```

Flags that matter:

| Flag | Use |
| --- | --- |
| `-s, --sandbox` | `read-only`, `workspace-write`, `danger-full-access` |
| `-C, --cd` | Working root, explicit beats inherited `cwd` |
| `--json` | JSONL events on stdout for logs and parsers |
| `-o, --output-last-message` | Final assistant message written to a file |
| `--output-schema` | JSON Schema the final response must satisfy |
| `--ephemeral` | Do not persist session files |
| `--skip-git-repo-check` | Allow execution outside Git, for scratch jobs |
| `--ignore-user-config` | Reproducible CI runs that must not inherit a maintainer's config |
| `-m, --model` | Pin a model for reproducible results |

For a machine-consumed result, combine `--json` with `--output-schema`. The schema should set `additionalProperties: false`, list `required` fields, and avoid open-ended strings when an enum will do.

```bash
codex exec --sandbox read-only --output-schema review.schema.json -o review.json \
  "Review the staged diff and return the JSON object required by the schema."
```

Read the exit code, then validate the output file against the schema in your own code. A zero exit code means the agent finished; it does not mean the findings are correct.

## Workflow 3: continue a task across restarts

```bash
codex exec "Run the migration plan in docs/plan.md and stop after step 3."
codex exec resume --last "Continue from step 4. Re-read the plan first."
```

- `resume --last` picks the newest session; `--all` removes the current-directory filter when the picker is empty.
- A session id is addressable when you need deterministic automation.
- `--ephemeral` on the first run is incompatible with resume because no session is stored.
- Summarize progress into a tracked file before stopping, so a resumed session does not depend on hidden conversation state.

## Workflow 4: register an MCP server

```bash
codex mcp add skillrig -- node /opt/skillrig/bin/skillrig.mjs mcp
codex mcp add docs --url https://example.com/mcp
codex mcp list
codex mcp get skillrig
codex mcp remove skillrig
```

Operational notes:

- Stdio servers take `--` followed by the command and arguments.
- Pass secrets with `--env KEY=VALUE` or, better, let the server read its own environment. Do not hard-code them in `config.toml`.
- HTTP servers support `--bearer-token-env-var` and OAuth options. Prefer a token environment variable over a literal header.
- A server that prints logs to stdout will corrupt the JSON-RPC stream. Send logs to stderr.
- Test the server manually before registering it: `printf '' | node server.mjs` should exit cleanly and print nothing unexpected.

## Workflow 5: configuration layering

Codex reads `$CODEX_HOME/config.toml`, which defaults to `~/.codex/config.toml`. Precedence for a session, highest first:

1. `-c key=value` overrides on the command line.
2. The profile selected with `-p name`, loaded from `$CODEX_HOME/<name>.config.toml`.
3. The base user config.

Use profiles to separate trusted work from untrusted repositories instead of editing the base config before every run.

```toml
# ~/.codex/ci.config.toml
model = "gpt-5-codex"
sandbox_mode = "read-only"
```

Then the `ci` profile layers that file over the base config:

```bash
codex exec -p ci "Review the diff. Do not edit files."
```

Use `--strict-config` in CI to fail on unknown keys. A silently ignored typo in a security-relevant key is worse than a failed job.

## Workflow 6: why Codex ignores a skill, plugin, or AGENTS.md

Check in this order:

1. **Path.** Personal skills live in `~/.codex/skills/<name>/SKILL.md`; project skills in `.codex/skills/<name>/SKILL.md`. The universal `~/.agents/skills` and `.agents/skills` locations are also supported. The folder name must match the `name` field.
2. **Frontmatter.** The file must start with `---`, `name` must be lowercase letters, digits, and hyphens, and `description` must be present and under 1024 characters.
3. **Working root.** `-C` changes the session root. A project skill outside that root is invisible.
4. **Trust.** Project configuration and project-scoped resources may require a trusted workspace. Run from the intended root, not a parent directory.
5. **Plugin marketplace.** A repository is not a marketplace until `.agents/plugins/marketplace.json` exists and points at a plugin directory containing `.codex-plugin/plugin.json`. Add it with `codex plugin marketplace add owner/repo`, then install with `codex plugin add <plugin>@<marketplace>`.
6. **Syntax.** Run `codex doctor`, then re-run with `--strict-config` to surface rejected keys.

## Examples

Good one-shot task:

```bash
codex exec -s read-only -C . --json -o answer.md \
  "Find every place that reads the PAYMENTS_API_KEY environment variable. Return file:line and whether the value is logged."
```

Poor one-shot task:

```bash
codex "fix it"
```

The second has no working root, no sandbox, no success condition, and no evidence requirement. Expect a plausible patch with no verification.

Good review gate in CI:

```bash
codex exec -s read-only --ignore-user-config --json -o review.json \
  "Review only the staged diff. Blocking findings must cite file:line and a failing command. Return an empty list when clean."
```

## Guardrails

- Do not run `danger-full-access` on a machine that holds credentials you are not prepared to lose.
- Do not paste secrets into a prompt to "test" a tool. Use environment variables and redacted fixtures.
- Do not trust an agent's claim that tests pass. Read the command output or run the command yourself.
- Do not let a CI job write to the default branch. Run Codex read-only or open a pull request.
- Do not commit generated JSONL session logs. They may contain repository content and tool output.
- Pin the Codex version in automation. A moving CLI plus a moving model is not a reproducible pipeline.

## Verification checklist

Before declaring a Codex integration done:

- [ ] `codex doctor` reports a healthy install.
- [ ] The command runs from a clean checkout with `--ignore-user-config`.
- [ ] The sandbox is the narrowest mode that still works.
- [ ] The working root is explicit.
- [ ] Output is schema-validated, not string-matched.
- [ ] Failures produce a non-zero exit code and a readable log.
- [ ] No secret appears in the prompt, the log, or the committed output.

## References

- `references/config-recipes.md` contains copyable `config.toml`, profile, and GitHub Actions examples.
