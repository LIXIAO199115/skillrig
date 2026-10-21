---
name: context-budget
description: Use when an agent session feels bloated, forgetful, slow, or expensive: too many skills, a giant AGENTS.md, large MCP tool schemas, repeated file reads, or long transcripts. Measures always-on versus activated context, then trims with progressive disclosure, packs, and retrieval instead of deleting useful knowledge.
license: MIT
compatibility: Any agent that loads skill metadata and project instructions into context. Token counts are estimates; verify with your provider's tokenizer when precision matters.
metadata:
  version: 1.0.0
  author: SkillRig
  category: agents
  tags: [context, tokens, agents, performance]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Context Budget

An agent has a fixed context window and a per-turn cost. Everything always-on competes with the task: skill names and descriptions, `AGENTS.md`, system rules, MCP tool schemas, and prior conversation. When the budget fills, the agent forgets instructions, skips steps, or starts summarizing the wrong thing.

The fix is not to delete knowledge. It is to move knowledge behind a reliable trigger.

## When to use

Use this skill when:

- A session gets slower or more expensive over time.
- The agent ignores instructions that are present in `AGENTS.md`.
- You have more than 20 skills installed.
- MCP tools dominate the prompt.
- A long task starts losing earlier decisions.
- You are deciding whether to install another skill or pack.

## Measure first

Estimate with four characters per token for English; CJK is closer to one token per character.

```bash
# Project instruction files
wc -c AGENTS.md CLAUDE.md 2>/dev/null
find . -maxdepth 3 -name 'SKILL.md' -print0 | xargs -0 wc -c

# Installed skills and token estimates
skillrig budget
skillrig list
```

`skillrig budget` reports:

- `alwaysOnTokens`: name plus description, loaded on every turn.
- `activationTokens`: body cost when the skill activates.
- `totalTokens`: the sum.
- Warnings when always-on metadata exceeds the configured threshold.

Rough budgets for a 200k-token model:

| Bucket | Comfortable | Tight |
| --- | --- | --- |
| System and tool schemas | < 10k | > 25k |
| Skill metadata (all installed) | < 2k | > 5k |
| `AGENTS.md` | < 1.5k | > 4k |
| Task files read | < 40k | > 100k |
| Conversation history | < 60k | > 120k |

These are heuristics, not hard limits. Measure your own sessions.

## Workflow

### 1. Inventory always-on content

Always-on:

- Every installed skill's `name` and `description`.
- `AGENTS.md`, `CLAUDE.md`, and equivalent project rules.
- MCP tool names, descriptions, and JSON schemas.
- System prompt and tool definitions.

Not always-on:

- Skill bodies, until activated.
- `references/` files, until read.
- Source files, until opened.

### 2. Find the biggest line item

Usually one of:

- An `AGENTS.md` that became an architecture document.
- Forty skills with long descriptions.
- An MCP server exposing fifty tools with verbose schemas.
- A transcript that keeps re-reading the same files.

Fix the largest first.

### 3. Trim skill metadata

A description only needs to route. Move examples, tables, and history into the body or `references/`.

Before:

```yaml
description: A comprehensive skill covering database migrations, including PostgreSQL, MySQL, SQLite, schema design, indexing, backfills, rollbacks, zero-downtime deploys, lock analysis, and a large collection of examples from production systems...
```

After:

```yaml
description: Use when reviewing a production database migration: column changes, index creation, backfills, locking, rollback, and online rollout. Does not cover schema design or query tuning.
```

The second routes better and costs a fraction of the tokens.

### 4. Use progressive disclosure

- Put the 80% path in `SKILL.md`.
- Put long tables, provider-specific notes, and edge cases in `references/`, linked with relative paths.
- Put deterministic work in `scripts/` so the agent runs code instead of reading a long procedure.

A skill with a 60-line body and three reference files is cheaper than a 600-line body, and often more reliable because the agent reads only what the task needs.

### 5. Use packs, not bulk installs

A pack installs a coherent set for a workflow. Five focused skills for the current project beat thirty general skills installed globally.

```bash
skillrig install pack/codex-starter --scope project
```

Project scope keeps unrelated work out of the session.

### 6. Manage MCP surface

Each MCP tool adds a name, description, and schema. A server with fifty tools can cost more than the task itself.

- Expose the smallest useful set of tools.
- Keep descriptions short and specific.
- Split a large server into a core server and an optional one.
- Remove servers you are not using from the session config.

### 7. Keep AGENTS.md short

`AGENTS.md` should contain commands, conventions, and prohibitions that the agent cannot infer. Move architecture to `docs/` and link it. A 60-line file that is read every turn beats a 600-line file that is skimmed.

### 8. Retrieve instead of preloading

- Read the specific file, not the whole directory.
- Use search to locate a symbol before opening files.
- Summarize a long document once and keep the summary, not the full text.
- Re-read a file only when it changed; avoid pasting the same content twice.

### 9. Reset or compact deliberately

- Start a new session for a new task.
- Keep a `PROGRESS.md` or task note with decisions, so a compacted session can recover.
- Summarize before a long pause, not after the context is already full.
- Remove stale tool output and failed attempts from the working note.

## Examples

A team installs 45 skills globally. Always-on metadata reaches 6,000 tokens before the task starts, and the agent starts ignoring the project's test command.

Fix:

1. `skillrig budget` identifies the ten longest descriptions.
2. Move 30 skills to project scope or a pack.
3. Shorten descriptions to one routing sentence plus a boundary.
4. Put the test command in a 20-line `AGENTS.md`.
5. Always-on drops below 1,500 tokens; the agent follows the test command again.

## Guardrails

- Do not delete a skill just to save tokens if it prevents a costly mistake. Move it to project scope or a pack.
- Do not shorten a description until it stops routing. Test activation after editing.
- Do not preload a large reference "just in case".
- Do not keep every MCP server enabled for every session.
- Do not rely on estimated token counts for billing decisions. Measure with the provider.
- Do not use context trimming as a substitute for a clear task statement.

## Verification checklist

- [ ] Always-on token estimate recorded before and after.
- [ ] Largest contributor identified.
- [ ] Skill descriptions tested for activation after edits.
- [ ] Long content moved to `references/` or `scripts/`.
- [ ] Global versus project scope reviewed.
- [ ] MCP tool surface reviewed.
- [ ] `AGENTS.md` under the target size.
- [ ] A fresh session follows the key instructions.
- [ ] Task recovery note exists for long work.

## References

- `references/context-checklist.md` contains measurement commands and trimming recipes by content type.
