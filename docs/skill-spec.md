# Skill specification

A skill is a folder with a `SKILL.md` file. The format is used by Codex, Claude Code, Cursor, Gemini CLI, OpenCode, Qwen Code, and dozens of other agents; SkillRig adds validation, scoring, hashing, and packaging around it.

This page is the contract a skill must satisfy to be indexed by SkillRig. It follows the open Agent Skills format and adds a few optional fields under `metadata`.

## Folder layout

```
my-skill/
├── SKILL.md            required; frontmatter + instructions
├── references/         optional; detail loaded on demand
├── scripts/            optional; executable helpers
└── assets/             optional; templates and fixtures
```

Rules:

- The folder name must equal the skill `name`. This makes install targets predictable and is enforced in the registry build.
- `SKILL.md` must be at the root of the folder.
- Every text file is scanned and hashed. Binary assets are allowed but reported if they look executable.
- Symlinks are skipped, not followed.
- Keep the folder small. A skill that ships a 40 MB dataset is a repository, not a skill.

## Frontmatter

The file starts with a YAML frontmatter block delimited by `---`:

```markdown
---
name: sql-migration-review
description: Use when reviewing a database migration, backfill, index change, or schema rollout before it reaches production.
license: MIT
metadata:
  version: 1.0.0
  author: SkillRig
  categories: [database, review]
  tags: [sql, migrations, safety]
---

# SQL migration review

...
```

### Required fields

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | 1–64 characters, lowercase letters, digits, and hyphens; must start with a letter or digit; must match the folder name |
| `description` | string | Non-empty, 1024 characters maximum, whitespace collapsed to one line |

The description is the **activation surface**. An agent sees only the name and description before deciding whether to load the rest. Write it as a trigger:

```
Use when <situation>, especially when <signal>. Covers <scope>; do not use for <exclusions>.
```

A description shorter than 60 characters is flagged by the quality score. A description longer than 500 characters loses points because it is harder to scan.

### Optional standard fields

| Field | Type | Purpose |
| --- | --- | --- |
| `license` | SPDX string | Declares the skill's licence |
| `compatibility` | string | Agents or environments the skill supports, 500 characters max |
| `allowed-tools` | string or array | Tool permissions the skill expects, for agents that support them |

`allowed-tools` is normalised from either the top level or `metadata`. `*`, bare `bash`, `shell`, `exec`, `write`, and `edit` are flagged as broad permissions.

### Optional SkillRig fields

These live under `metadata` and are read by SkillRig; agents that do not understand them ignore them.

| Field | Type | Purpose |
| --- | --- | --- |
| `metadata.version` | semver | Displayed and used by update checks |
| `metadata.author` | string | Credit |
| `metadata.categories` | string or array | Primary classification; used by search and the site |
| `metadata.tags` | string or array | Free-form keywords |
| `metadata.homepage` | URL | Project page |
| `metadata.repository` | URL | Source repository |
| `metadata.skillrig.requires` | string or array | Skills that should be installed alongside this one |
| `metadata.skillrig.conflicts` | string or array | Skills that must not be installed together |
| `metadata.skillrig.replaces` | string or array | Legacy skill names this one supersedes |

Top-level `version`, `author`, `homepage`, `repository`, `tags`, and `category` are tolerated for compatibility. Any other unknown field produces a warning.

### YAML support

SkillRig parses a practical subset of YAML with no dependency:

- mappings and nested mappings,
- block sequences (`- item`) and inline arrays (`[a, b]`),
- inline maps (`{a: b}`),
- quoted strings, booleans, `null`/`~`, and block scalars (`|`, `>`),
- comments starting with `#` outside quotes.

Not supported: anchors, aliases, tags, merge keys, multiple documents, and complex flow syntax. If a skill needs those, the frontmatter is too clever.

## Body

The body is everything after the frontmatter. It is what the agent reads when the skill activates.

### Recommended structure

```markdown
# <Skill name>

One paragraph: what this skill changes about the agent's behaviour.

## When to use

- Concrete situations and signals.
- What to do when the situation is ambiguous.

## When not to use

- Nearby tasks that belong to another skill.

## Workflow

1. First action, with the command or check.
2. Second action, including what to do with the result.
3. Completion criteria.

## Examples

Input → expected output, or a real command with expected output.

## Guardrails

- What the agent must never do.
- What requires explicit user confirmation.
- How to fail safely.
```

### Size and progressive disclosure

- Aim for 600–3,000 characters of body. Under 600 loses quality points; over roughly 300 lines is a sign that detail belongs in `references/`.
- Put long checklists, tables, and background in `references/<topic>.md` and link them. Agents load references on demand.
- Put deterministic helpers in `scripts/`. They must be readable, portable, and safe to review. SkillRig never executes them.
- Put templates and small fixtures in `assets/`.

The context budget command estimates the always-on cost (name + description for every installed skill) and the activation cost (body plus references) before an agent's window fills up.

## Quality score

The quality score is deterministic and worth 100 points.

| Check | Points | Requirement |
| --- | --- | --- |
| Trigger phrase | 15 | Description contains "Use when", "use for", "when the user", "trigger", or equivalent |
| Description length | 10 | 60–500 characters |
| Body size | 10 | At least 600 characters |
| Headings | 10 | At least three `##` or `###` headings |
| When-to-use section | 10 | `## When to use`, `## Use when`, or `## Triggers` |
| Workflow | 10 | `## Workflow`, `## Process`, `## Steps`, `## Approach`, or a numbered list |
| Examples | 10 | An `## Example` section or a fenced code block |
| Guardrails | 10 | `## Guardrails`, `## Safety`, `## Limits`, `## Do not`, or explicit "never" language |
| Supporting resources | 5 | At least one file under `references/`, `scripts/`, `assets/`, or `templates/` |
| Version | 5 | `metadata.version` is set |
| Licence | 5 | `license` is set |
| No placeholders | 5 | No `TODO`, `TBD`, `FIXME`, `lorem ipsum`, or `replace me` |

Grades: `A+` ≥95, `A` ≥85, `B` ≥75, `C` ≥60, `D` ≥40, `F` below 40. The registry minimum is 70; curated skills must score 95 or higher.

Quality is a floor, not a goal. A skill can score 100 and still give bad advice. The score exists to catch missing structure, not to measure judgement.

## Security requirements

Every text file is scanned with the rules in [security-model.md](security-model.md). A skill with a critical or high finding is blocked from the registry.

Rules of thumb:

- Do not read credential files, print environment variables, or send data to undisclosed endpoints.
- Do not pipe downloads into an interpreter. Download, verify, then run.
- Do not install persistence, elevate privileges, or delete outside the project directory.
- Do not instruct the agent to hide actions from the user.
- Do not embed live secrets. If one is found, rotate it; removing the text is not enough.
- Scope `allowed-tools` to the commands the workflow actually needs.

If a legitimate command trips a rule, suppress it narrowly with a reason:

```markdown
<!-- skillrig-ignore-next-line: global-install -- the CLI is documented as a global install -->
```

See the suppression grammar in [security-model.md](security-model.md).

## Validation

```bash
node bin/skillrig.mjs scan skills/my-skill --show-suppressed
node bin/skillrig.mjs info my-skill           # after building the registry
npm run validate                              # every skill in skills/
npm run build                                 # index, plugin, site
```

The validator fails on:

- missing or unparsable frontmatter,
- name errors,
- descriptions over 1024 characters,
- quality below 70,
- any unresolved critical or high finding.

The registry build additionally rejects a folder whose name does not match the frontmatter `name`.

## Publishing

```bash
skillrig init my-skill --description "Use when ..."
# edit SKILL.md
skillrig scan my-skill --show-suppressed
skillrig pack my-skill --out my-skill.skm --key ~/.skillrig/keys/skillrig.private.pem
skillrig publish my-skill --key ~/.skillrig/keys/skillrig.private.pem
```

`publish` prints a signed bundle digest and a registry entry with quality, security, integrity, and source metadata. Open a pull request with the skill folder and the entry; the maintainer rebuilds and signs the index centrally. Contributors never need the registry signing key.

## Versioning

- Use semver in `metadata.version`.
- A breaking change is a change to when the skill activates or what it requires; bump the major version.
- Typos and clarifications are patches.
- The registry records the version at index time. `skillrig update` reinstalls from the original source; curated skills update with the package.

## Compatibility

Skills should not assume a specific agent unless `compatibility` says so. Prefer plain Markdown and portable shell commands. When an agent-specific feature is required, state the fallback.

The `agents` field in the registry is `["*"]` by default. A skill that only works in one agent should declare it in `compatibility` and, if necessary, ship agent-specific references rather than branching the body.
