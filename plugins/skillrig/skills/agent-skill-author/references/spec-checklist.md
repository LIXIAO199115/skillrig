# Agent Skills spec checklist

## Frontmatter fields

| Field | Required | Rules | Notes |
| --- | --- | --- | --- |
| `name` | yes | 1–64 chars, lowercase `a-z`, digits, hyphen; match folder | No underscores, spaces, or uppercase |
| `description` | yes | ≤1024 chars; single paragraph | Used for routing; include trigger language |
| `license` | no | SPDX identifier | Use `MIT`, `Apache-2.0`, `BSD-3-Clause`, or a path |
| `compatibility` | no | ≤500 chars | Runtime, OS, tool versions |
| `metadata` | no | String map | Holds `version`, `author`, `category`, `tags` |
| `allowed-tools` | no | Comma-separated list | Only when the agent supports it; narrow is better |

Portable extensions used by SkillRig, kept inside `metadata`:

```yaml
metadata:
  version: 1.2.0
  author: Your Name
  category: engineering
  tags: [testing, ci]
  requires: [other-skill]
  conflicts: [legacy-skill]
```

`requires` and `conflicts` are advisory for installers. Keep them accurate or omit them.

## Template

````markdown
---
name: example-skill
description: Use when <concrete task and trigger words>. Produces <artifact>. Does not cover <boundary>.
license: MIT
compatibility: Requires <runtime and version>.
metadata:
  version: 1.0.0
  author: <name>
  category: <category>
  tags: [tag-one, tag-two]
---

# Example Skill

One paragraph explaining the job and the core constraint.

## When to use

- <real request one>
- <real request two>
- <symptom that should trigger the skill>

## Core model

- <fact that changes decisions>
- <invariant the agent must preserve>

## Workflow

1. <step with a command>
2. <step with a decision rule>
3. <verification step>

## Examples

Good:

```bash
<working command>
```

Bad:

```bash
<command that looks plausible but fails>
```

## Guardrails

- <destructive action to avoid>
- <secret or privacy rule>
- <condition that requires stopping>

## Verification checklist

- [ ] <observable check>
- [ ] <command and expected result>

## References

- `references/details.md` — <what it contains>
````

## Description rubric

Score each item 0 or 1:

1. Starts with or contains "Use when".
2. Names at least two concrete triggers (verbs, file types, tools, errors).
3. States the artifact or outcome.
4. States a boundary or exclusion.
5. Contains no marketing adjectives.
6. Under 1024 characters.
7. Does not name a specific user, customer, or private system.

A description scoring below 5 usually routes poorly. Rewrite it before editing the body.

## Body budget

| Body size | Approx. tokens | Guidance |
| --- | --- | --- |
| < 100 lines | < 1,000 | Ideal for a focused skill |
| 100–250 lines | 1,000–2,500 | Fine when the procedure is dense |
| 250–500 lines | 2,500–5,000 | Move examples and tables to references |
| > 500 lines | > 5,000 | Split into multiple skills |

Token estimates assume about four characters per token for English. CJK text is closer to one token per character, so the budget is smaller.

## Portable paths

- Use relative links from `SKILL.md`: `references/details.md`, `scripts/check.mjs`.
- Do not use absolute paths from your machine.
- Do not assume the current working directory. Resolve paths from the skill folder or the project root explicitly.
- Use forward slashes in links. Windows agents accept them in Markdown.

## Pre-publish validation

```bash
skillrig scan ./my-skill
skillrig pack ./my-skill --out my-skill.skm
skillrig install ./my-skill.skm --dry-run
```

Or with the built-in scanner only:

```bash
skillrig scan ./my-skill --sarif > scan.sarif
```

## License notes

- MIT and Apache-2.0 are safe defaults for original work.
- When adapting text, keep the original copyright notice and state the changes.
- Do not copy a skill whose license forbids derivative works.
- Assets need their own license check. A permissive code license does not automatically cover images or fonts.
