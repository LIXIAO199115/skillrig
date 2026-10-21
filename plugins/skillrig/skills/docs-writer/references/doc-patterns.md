# Documentation patterns

## README skeleton

````markdown
# Project name

One paragraph: the problem, the solution, and who it is for.

## Why this exists

The specific pain or constraint that made the project necessary. Two or three sentences.

## Quick start

Prerequisites:

- Node.js 20.11 or newer

<!-- skillrig-ignore-block: global-install -- template snippet showing an install block -->
```bash
npm install --global project@1.0.0
project doctor
```

```text
<one or two lines of real output>
```

## Features

- **Feature name** — what it does, with one concrete detail.
- **Feature name** — what it does, with one concrete detail.

## Usage

<the two or three commands most users need>

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--scope` | `global` \| `project` | `global` | Where to install |

## Troubleshooting

### Command not found

<exact cause and fix>

### Permission denied

<exact cause and fix>

## Contributing

<test command, style, pull request expectations>

## License

MIT
````

## How-to skeleton

````markdown
# How to <achieve one outcome>

This guide assumes <prerequisite>. It takes about <time>.

## Steps

### 1. <action>

```bash
<command>
```

Expected: <observable result>.

### 2. <action>

<explanation of the decision the reader may need to make>

## Verify

```bash
<command>
```

<what success looks like>

## If it fails

- **<error>**: <cause and fix>
- **<error>**: <cause and fix>
````

A how-to solves one problem. It does not teach the whole system.

## Reference skeleton

````markdown
# CLI reference

## `project install <source>`

Install a skill from a registry name, a GitHub repository, a local path, or a `.skm` bundle.

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--agent <id>` | string, repeatable | `codex` | Target agent |
| `--scope <scope>` | `global` \| `project` | `global` | Install location |
| `--force` | boolean | `false` | Replace an unmanaged directory |
| `--dry-run` | boolean | `false` | Print the plan without writing |

Exit codes:

- `0` success
- `2` usage error
- `3` blocked by security policy
- `4` integrity failure

Example:

```bash
project install owner/repo --agent codex --scope project
```
````

## Migration note template

````markdown
# Migrating from 1.x to 2.0

## Who is affected

<users of the removed API or changed default>

## Breaking changes

### `config.retries` removed

Before:

```js
createClient({ retries: 3 });
```

After:

```js
createClient({ retry: { attempts: 3, backoff: 'exponential' } });
```

Reason: retries now need a backoff policy to avoid thundering herds.

## Steps

1. Update the dependency.
2. Replace the old option.
3. Run `<test command>`.
4. Check the deprecation warnings are gone.

## Rollback

<how to return to 1.x and what data may not be readable by the old version>
````

## Troubleshooting entry template

````markdown
### Error: `EACCES` when installing globally

Cause: the global prefix is owned by another user.

Fix:

```bash
npm config get prefix
# point npm at a user-owned directory
npm config set prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

Verify:

```bash
project --version
```
````

## Writing rules

- Put the command before the explanation.
- One idea per paragraph.
- Use the reader's words in headings, not internal jargon.
- Prefer a table for options and a numbered list for steps.
- Show real output, trimmed to the relevant lines.
- Link to deeper material instead of expanding every branch.
- Date claims that depend on external services or prices.
