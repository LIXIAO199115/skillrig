---
name: codex-plugin-author
description: Use when building or publishing a Codex plugin marketplace, packaging skills into a .codex-plugin/plugin.json, wiring marketplace.json, shipping plugin MCP servers, or debugging why codex plugin add cannot see a plugin. Covers repository layout, verified manifest fields, versioning, local testing, and supply-chain guardrails.
license: MIT
compatibility: Verified against codex-cli 0.154.0 on Windows with a local marketplace. Git marketplaces use the same manifests.
metadata:
  version: 1.0.0
  author: SkillRig
  category: codex
  tags: [codex, plugins, marketplace, packaging]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Codex Plugin Author

A Codex plugin is a directory with a small manifest and optional skills, assets, and MCP servers. A marketplace is a repository that lists plugins and their install policy. Both manifests are read by Codex at startup, so a typo fails quietly: the plugin simply never appears.

This skill documents the layout that Codex actually accepts, not a design sketch.

## When to use

Use this skill when:

- You want a repository to be installable with `codex plugin marketplace add owner/repo`.
- You are packaging skills into a plugin for a team or for public distribution.
- `codex plugin list` shows nothing, or shows the plugin but `codex plugin add` fails.
- You need to version and update a plugin without breaking existing installs.
- You are reviewing a third-party marketplace before trusting it.

## Verified layout

```
repo/
├── .agents/
│   └── plugins/
│       └── marketplace.json
└── plugins/
    └── skillrig/
        ├── .codex-plugin/
        │   └── plugin.json
        ├── .mcp.json                  # optional MCP overlay
        ├── assets/
        │   ├── icon.png
        │   └── logo.png
        └── skills/
            ├── skill-one/
            │   └── SKILL.md
            └── skill-two/
                └── SKILL.md
```

Two rules are easy to get wrong:

1. `marketplace.json` must live at `.agents/plugins/marketplace.json` in the marketplace root.
2. A plugin source must be a subdirectory of the marketplace root. A source path of `./` is not accepted. The path must start with `./`.

## Marketplace manifest

```json
{
  "name": "acme-plugins",
  "interface": {
    "displayName": "Acme Plugins"
  },
  "plugins": [
    {
      "name": "acme-core",
      "source": {
        "source": "local",
        "path": "./plugins/acme-core"
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

Field notes:

| Field | Meaning |
| --- | --- |
| `name` | Marketplace id. Must be unique among configured marketplaces. |
| `interface.displayName` | Label shown to users. |
| `plugins[].name` | Plugin id used in `codex plugin add <name>@<marketplace>`. |
| `source` | A string or an object. Use the object form with `source: "local"` for repository plugins. |
| `policy.installation` | `AVAILABLE`, `INSTALLED_BY_DEFAULT`, or `NOT_AVAILABLE`. |
| `policy.authentication` | `ON_INSTALL` or `ON_USE`. |
| `category` | Free-form grouping label shown in listings. |

Do not default a plugin to `INSTALLED_BY_DEFAULT` unless the plugin is required for the repository to function and has no network or credential side effects.

## Plugin manifest

```json
{
  "name": "acme-core",
  "version": "1.2.0",
  "description": "Acme's house skills for TypeScript services.",
  "author": {
    "name": "Acme Platform Team",
    "email": "platform@example.com",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/plugins",
  "repository": "https://github.com/acme/plugins",
  "license": "MIT",
  "keywords": ["typescript", "codex", "skills"],
  "skills": "./skills/",
  "interface": {
    "displayName": "Acme Core",
    "shortDescription": "House skills for TypeScript services",
    "longDescription": "Installs Acme's review, release, and migration skills for Codex sessions in service repositories.",
    "developerName": "Acme",
    "category": "Development",
    "capabilities": ["Interactive", "Write"],
    "websiteURL": "https://example.com",
    "privacyPolicyURL": "https://example.com/privacy",
    "termsOfServiceURL": "https://example.com/terms",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png",
    "defaultPrompt": [
      "Review this change against Acme standards",
      "Prepare a release for this service"
    ],
    "brandColor": "#2563EB",
    "screenshots": []
  }
}
```

- `skills` points at a directory of skill folders. Each folder must contain `SKILL.md` with valid frontmatter.
- `interface` is optional for function but required for a usable listing. Missing icons render as blanks, not errors.
- `version` drives the install cache path, so an update without a version bump can leave stale files in place.
- `defaultPrompt` entries become one-click starters. Keep them under 60 characters and free of secrets or customer names.

## Optional MCP overlay

A plugin can ship an MCP server with a `.mcp.json` file at the plugin root:

```json
{
  "mcpServers": {
    "acme-tools": {
      "command": "node",
      "args": ["./bin/acme-mcp.mjs"]
    }
  }
}
```

Rules:

- Relative paths must start with `./` and must resolve inside the plugin root.
- The command must exist on the user's `PATH`. Prefer a runtime the user already has, or ship a self-contained binary.
- The server must speak newline-delimited JSON-RPC on stdio and must not write logs to stdout.
- Treat the MCP process as part of your trust boundary: it runs with the user's permissions.

## Local development loop

```bash
# 1. Add the repository containing .agents/plugins/marketplace.json
codex plugin marketplace add /absolute/path/to/repo --json

# 2. Confirm the marketplace and plugin are discovered
codex plugin marketplace list --json
codex plugin list --json

# 3. Install
codex plugin add acme-core@acme-plugins --json

# 4. Start a session and confirm the skill activates
codex exec "Use the acme-core review skill on the staged diff."

# 5. After changing the plugin, bump the version and reinstall
codex plugin remove acme-core@acme-plugins
codex plugin add acme-core@acme-plugins --json

# 6. Remove test state
codex plugin marketplace remove acme-plugins
```

The install lands in `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`. Inspect that directory when a plugin installs but its skills do not appear.

## Publishing through Git

```bash
codex plugin marketplace add acme/plugins --ref v1.2.0
codex plugin add acme-core@acme-plugins
```

- A Git marketplace is fetched and snapshotted. Users get changes only after `codex plugin marketplace upgrade`.
- Pin a tag or commit for reproducible installs. Floating branches turn a marketplace into an unreviewed remote code channel.
- Sparse checkout can limit a large monorepo: `codex plugin marketplace add acme/mono --sparse plugins`.

## Versioning policy

- Bump `version` in `plugin.json` for every change that affects installed files.
- Bump the marketplace entry only when the source location or policy changes.
- Keep skill folder names stable. Renaming a skill breaks user habits and saved prompts.
- Deprecate a skill by removing it from `skills` and documenting the replacement for at least one release.
- Test an upgrade from the previous version, not only a clean install.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Marketplace missing from `codex plugin marketplace list` | Removed, or config entry points at a deleted path | Re-add with an absolute path |
| Marketplace listed, no plugins | `marketplace.json` at wrong path or invalid JSON | Move to `.agents/plugins/marketplace.json`, validate JSON |
| Plugin listed, install fails | Plugin directory lacks `.codex-plugin/plugin.json` | Add the manifest and restart the command |
| Plugin installs, no skills | `skills` path wrong, or a folder lacks valid `SKILL.md` | Check frontmatter, name/folder match, and description |
| Plugin never appears | Source path is `./` or outside the marketplace root | Put the plugin in a subdirectory and use `./plugins/<name>` |
| Old content after reinstall | Version not bumped | Bump `version`, reinstall, verify the cache path |
| MCP tools absent | `.mcp.json` malformed or command not found | Validate JSON and run the command manually |

## Guardrails

- Review every skill and script before handing a marketplace to other people. A plugin is executable content.
- Do not embed API keys, private URLs, or customer data in manifests, skills, icons, or default prompts.
- Do not use `INSTALLED_BY_DEFAULT` for network-capable plugins without explicit team approval.
- Do not fetch and execute remote scripts at session start. Ship reviewed files.
- Sign or hash releases when your distribution path supports it. A Git tag is a label, not a signature.
- Keep the plugin's advertised capabilities honest. If it writes files, say so.

## Verification checklist

- [ ] `codex plugin marketplace add` returns the expected marketplace name.
- [ ] `codex plugin list` shows the plugin with the expected version.
- [ ] `codex plugin add` succeeds and the cache directory contains every skill.
- [ ] Each installed `SKILL.md` parses and the folder name matches the `name` field.
- [ ] A fresh Codex session can activate at least one skill from the plugin.
- [ ] Upgrade from the previous version leaves no stale skill behind.
- [ ] `codex plugin remove` and `codex plugin marketplace remove` clean up fully.

## References

- `references/marketplace-schema.md` contains complete manifests, policy values, and a worked repository layout.
