# Codex configuration recipes

These recipes assume `$CODEX_HOME` defaults to `~/.codex`. Replace model names with the ones your account can use.

## Base user config

```toml
# ~/.codex/config.toml
model = "gpt-5-codex"
sandbox_mode = "workspace-write"
approval_policy = "on-request"

[mcp_servers.skillrig]
command = "node"
args = ["/opt/skillrig/bin/skillrig.mjs", "mcp"]
```

Keep credentials out of this file. If a server needs a token, pass an environment variable name through the server's own launch script.

## Read-only review profile

```toml
# ~/.codex/review.config.toml
model = "gpt-5-codex"
sandbox_mode = "read-only"
approval_policy = "never"
```

```bash
codex exec -p review -C . "Review the staged diff. Return blocking findings only."
```

## Untrusted repository profile

```toml
# ~/.codex/untrusted.config.toml
sandbox_mode = "read-only"
approval_policy = "never"
```

Run untrusted code only through this profile and without `--add-dir`.

## CI step

```yaml
name: codex-review
on: pull_request
permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install Codex
        # skillrig-ignore-next-line: global-install -- pinned CI install of the OpenAI CLI in an ephemeral runner
        run: npm install --global @openai/codex@0.154.0
      - name: Run review
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          git fetch origin "${{ github.base_ref }}" --depth=1
          codex exec \
            --sandbox read-only \
            --ignore-user-config \
            --skip-git-repo-check \
            --json \
            --output-last-message review.md \
            "Review the diff against origin/${{ github.base_ref }}. Cite file:line for every blocking finding. Do not edit files."
      - name: Upload review
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: codex-review
          path: review.md
```

`--ignore-user-config` keeps a hosted runner reproducible. Do not print `OPENAI_API_KEY`; pass it through the environment only.

## Structured output schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "findings"],
  "properties": {
    "summary": { "type": "string", "maxLength": 400 },
    "findings": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "file", "line", "message"],
        "properties": {
          "severity": { "enum": ["blocking", "important", "nit"] },
          "file": { "type": "string" },
          "line": { "type": "integer", "minimum": 1 },
          "message": { "type": "string", "maxLength": 600 },
          "evidence": { "type": "string", "maxLength": 600 }
        }
      }
    }
  }
}
```

```bash
codex exec --sandbox read-only --output-schema review.schema.json -o review.json \
  "Review the staged diff. Every finding needs a file and line."
```

Validate the file yourself. A schema-compliant answer can still be wrong.

## Session hygiene

```bash
# One-off job that should leave no session behind
codex exec --ephemeral --skip-git-repo-check "Summarize this directory."

# Continue the most recent session in this directory
codex exec resume --last "Continue from the checklist in PROGRESS.md."

# Continue a specific session
codex exec resume 0f3c2a9e-... "Apply the fix you proposed."
```

Write progress to a tracked file before a long pause. Session history is a convenience, not a durable project artifact.
