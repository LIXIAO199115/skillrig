# Codex plugin marketplace schema

Verified against codex-cli 0.154.0 by adding a local marketplace, listing it, installing a plugin, and inspecting the install cache.

## Marketplace file

Path: `<marketplace-root>/.agents/plugins/marketplace.json`

```json
{
  "name": "acme-plugins",
  "interface": {
    "displayName": "Acme Plugins",
    "shortDescription": "Internal Codex plugins for the platform team"
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

Supported plugin source forms:

```json
"./plugins/acme-core"
```

```json
{ "source": "local", "path": "./plugins/acme-core" }
```

Local paths must start with `./` and stay inside the marketplace root. A path of `./` is rejected because the plugin must live in a subdirectory.

Policy values:

- `installation`: `AVAILABLE` (user chooses), `INSTALLED_BY_DEFAULT` (installed without a prompt), `NOT_AVAILABLE` (listed but blocked).
- `authentication`: `ON_INSTALL` (authenticate during install), `ON_USE` (authenticate on first use).

## Plugin file

Path: `<plugin-root>/.codex-plugin/plugin.json`

```json
{
  "name": "acme-core",
  "version": "1.2.0",
  "description": "Acme house skills for TypeScript services.",
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
    "longDescription": "Review, release, and migration skills for Acme service repositories.",
    "developerName": "Acme",
    "category": "Development",
    "capabilities": ["Interactive", "Write"],
    "websiteURL": "https://example.com",
    "privacyPolicyURL": "https://example.com/privacy",
    "termsOfServiceURL": "https://example.com/terms",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png",
    "defaultPrompt": ["Review this change against Acme standards"],
    "brandColor": "#2563EB",
    "screenshots": []
  }
}
```

Required for discovery: `name`. Required for a usable install: `version`, `skills` when skills are shipped. The `interface` block controls presentation.

Asset constraints:

- Icons and logos must be inside the plugin root.
- Use square PNG for `composerIcon` and transparent PNG or SVG for `logo`.
- Keep each asset under a few hundred kilobytes; plugin caches are copied on install.

## MCP overlay

Path: `<plugin-root>/.mcp.json`

```json
{
  "mcpServers": {
    "acme-tools": {
      "command": "node",
      "args": ["./bin/acme-mcp.mjs"],
      "env": {
        "ACME_LOG_LEVEL": "error"
      }
    }
  }
}
```

Relative `command` and `args` paths must start with `./` and remain inside the plugin root. Absolute paths outside the root are ignored. Secrets belong in the user's environment, not in this file.

## Repository example

```
acme-plugins/
├── .agents/plugins/marketplace.json
├── README.md
├── LICENSE
└── plugins/
    └── acme-core/
        ├── .codex-plugin/plugin.json
        ├── .mcp.json
        ├── assets/icon.png
        ├── assets/logo.png
        ├── bin/acme-mcp.mjs
        └── skills/
            ├── acme-review/SKILL.md
            └── acme-release/SKILL.md
```

## Test sequence

```bash
codex plugin marketplace add /absolute/path/to/acme-plugins --json
codex plugin marketplace list --json
codex plugin list --json
codex plugin add acme-core@acme-plugins --json
ls ~/.codex/plugins/cache/acme-plugins/acme-core/1.2.0/skills
codex exec "Read the acme-review skill and apply it to the staged diff."
codex plugin remove acme-core@acme-plugins
codex plugin marketplace remove acme-plugins
```

On Windows, the cache path is `%USERPROFILE%\.codex\plugins\cache\<marketplace>\<plugin>\<version>`.

## Version and update behavior

- The install cache is keyed by version. Reinstalling the same version may reuse the cached copy.
- Bump `version` before reinstalling changed files.
- Git marketplaces are snapshotted. Run `codex plugin marketplace upgrade` to refresh.
- Removing a plugin removes its cache. Removing a marketplace does not uninstall its plugins automatically; remove plugins first.

## Security review for a third-party marketplace

Before installing:

1. Read `marketplace.json` and every `plugin.json`.
2. List every skill and read each `SKILL.md`.
3. Inspect scripts and binaries referenced by the skills.
4. Inspect `.mcp.json`: what command runs, with which arguments and environment.
5. Check install policy. `INSTALLED_BY_DEFAULT` plus a network-capable MCP server deserves extra scrutiny.
6. Pin a tag or commit instead of a branch.
7. Record the version and integrity in your own lockfile or deployment manifest.
