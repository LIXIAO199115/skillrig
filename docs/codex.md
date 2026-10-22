# Codex integration

SkillRig is built for Codex first. This page covers the three ways Codex can consume it — skills directory, plugin marketplace, and MCP — plus the commands that keep them current.

Verified against `codex-cli 0.154.0` on 2026-10-21.

## 1. Install skills into Codex

Codex reads skills from these directories:

| Scope | Directory |
| --- | --- |
| Global | `~/.codex/skills/` |
| Project | `.codex/skills/` |
| Shared global | `~/.agents/skills/` |
| Shared project | `.agents/skills/` |

Codex treats `.codex/skills/` as the primary location and `.agents/skills/` as an alternate. SkillRig models both and de-duplicates when they resolve to the same path.

```bash
# Global, the default
skillrig install codex-cli-workflows

# Project scope, committed with the repository
skillrig install codex-cli-workflows --scope project

# The shared directory read by Codex and other agents
skillrig install codex-cli-workflows --agent agents

# Several at once
skillrig install pack/codex-starter --agent codex
```

Verify what Codex will see:

```bash
skillrig list --agent codex
skillrig verify --installed
skillrig budget
```

`budget` matters for Codex because every installed skill's name and description is part of the always-on context. A dozen verbose descriptions can consume more of the window than the task itself.

## 2. Plugin marketplace

SkillRig ships a Codex plugin marketplace at `.agents/plugins/marketplace.json`. The marketplace exposes one plugin, `skillrig`, which bundles all 18 curated skills.

```bash
codex plugin marketplace add LIXIAO199115/skillrig
codex plugin add skillrig@skillrig
```

What happens:

1. Codex clones the marketplace repository into its cache.
2. It reads `.agents/plugins/marketplace.json`.
3. `plugin add` resolves `plugins/skillrig` and copies it to `~/.codex/plugins/cache/skillrig/skillrig/1.2.0/`.
4. The plugin's `.codex-plugin/plugin.json` points at `./skills/`, so Codex sees 18 skills.

Refresh after the repository changes:

```bash
codex plugin marketplace upgrade
```

Inspect what Codex knows:

```bash
codex plugin marketplace list
codex plugin list
```

Remove the plugin or marketplace:

```bash
codex plugin remove skillrig
codex plugin marketplace remove skillrig
```

### Marketplace format

The file Codex reads:

```json
{
  "name": "skillrig",
  "interface": {
    "displayName": "SkillRig"
  },
  "plugins": [
    {
      "name": "skillrig",
      "source": {
        "source": "local",
        "path": "./plugins/skillrig"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_USE"
      },
      "category": "Development"
    }
  ]
}
```

The plugin manifest at `plugins/skillrig/.codex-plugin/plugin.json`:

```json
{
  "name": "skillrig",
  "version": "1.2.0",
  "description": "Signed, security-audited skill registry and zero-dependency installer for Codex and every agent that reads SKILL.md.",
  "author": { "name": "Li Xiaocheng", "url": "https://github.com/LIXIAO199115" },
  "homepage": "https://lixiao199115.github.io/skillrig/",
  "repository": "https://github.com/LIXIAO199115/skillrig",
  "license": "MIT",
  "keywords": ["codex", "agent-skills", "skill-registry", "security", "mcp"],
  "skills": "./skills/",
  "interface": {
    "displayName": "SkillRig",
    "shortDescription": "18 audited skills for Codex, with a signed registry",
    "longDescription": "…",
    "developerName": "SkillRig",
    "category": "Development",
    "capabilities": ["Write", "Review"],
    "websiteURL": "https://lixiao199115.github.io/skillrig/"
  }
}
```

`npm run build:plugin` regenerates the manifest from `package.json` and syncs `plugins/skillrig/skills/` from `skills/`. `npm run check:plugin` fails CI if the two drift.

### Choosing between plugin and installer

| Need | Use |
| --- | --- |
| All 18 curated skills inside Codex, zero setup | Plugin marketplace |
| A subset, project scope, pinned hashes, drift detection | `skillrig install` |
| Upstream skills from other repositories | `skillrig install owner/repo@skill` |
| The same skills across several agents | `skillrig install --agent codex,claude-code,agents` |

The plugin is a convenience wrapper. It does not bypass the scanner: the 18 curated skills are scanned during the registry build, and the plugin ships exactly those files.

## 3. MCP server

SkillRig exposes its registry and installer to Codex as an MCP server over stdio.

Add it with the Codex CLI:

```bash
codex mcp add skillrig -- skillrig mcp
```

This requires `skillrig` on `PATH`:

```bash
npm link          # from a clone
```

Or configure it directly in `~/.codex/config.toml`:

```toml
[mcp_servers.skillrig]
command = "node"
args = ["C:/tools/skillrig/bin/skillrig.mjs", "mcp"]
```

Use the absolute path to `bin/skillrig.mjs` when the CLI is not linked. On macOS or Linux the command is usually `skillrig` with `args = ["mcp"]`.

Check the server:

```bash
codex mcp list
codex mcp get skillrig
```

The server advertises ten tools: search, info, install, remove, list, scan, audit, budget, doctor, and sync. Installing through MCP applies the same security gate and lockfile as the CLI.

## Keeping everything current

Curated skills ship inside the package; update the checkout or package, then reinstall. Upstream skills are fetched from their recorded source.

```bash
git pull                           # in the SkillRig checkout
skillrig update --all              # reinstall into the original agents and scopes
skillrig doctor                    # find drift, skew, and a stale AGENTS.md
skillrig sync                      # refresh the managed block
codex plugin marketplace upgrade   # refresh the plugin snapshot
```

`update` preserves the agent and scope of each install. It does not silently move a project install to global.

## `AGENTS.md`

Project-scope installs can be summarised in `AGENTS.md`:

```bash
skillrig sync
```

SkillRig writes a delimited block:

```markdown
<!-- skillrig:start -->
## Installed skills

- `codex-cli-workflows` — Running Codex CLI in real projects …
- `pr-reviewer` — Reviewing a pull request or agent-authored patch …

<!-- skillrig:end -->
```

Everything outside the markers is preserved. `doctor` reports a stale block when the lockfile and `AGENTS.md` disagree.

## A typical Codex session

```bash
cd my-project

skillrig install codex-cli-workflows --scope project
skillrig install pr-reviewer --scope project
skillrig install test-first-fix --scope project
skillrig sync
skillrig budget --warn-at 1200
skillrig verify --installed

codex
```

Inside Codex, ask for a task that matches a skill description. Codex decides whether to activate it from the name and description; the body is loaded only when it does.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Codex does not see a skill | `skillrig list --agent codex` and confirm the path is under `~/.codex/skills` or `.codex/skills` |
| Plugin not listed | `codex plugin marketplace list`; re-run `codex plugin marketplace add LIXIAO199115/skillrig` |
| Plugin version stale | `codex plugin marketplace upgrade`, then `codex plugin remove skillrig && codex plugin add skillrig@skillrig` |
| MCP server fails to start | `skillrig mcp` directly; check `codex mcp get skillrig` for the command and arguments |
| Installed files modified | `skillrig verify --installed`; reinstall with `skillrig update <name>` |
| Context feels bloated | `skillrig budget`; remove skills you no longer use |

## What SkillRig does not do

- It does not modify Codex's `config.toml` except when you run `codex mcp add`.
- It does not run Codex or send prompts on your behalf.
- It does not install skills into a Codex sandbox or cloud environment, only into the local directories listed above.
- It does not bypass Codex's own plugin and skill loading rules.
