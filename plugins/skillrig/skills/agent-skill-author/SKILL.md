---
name: agent-skill-author
description: Use when writing or reviewing a SKILL.md for Codex, Claude Code, Cursor, Gemini CLI, or any agent that follows the open Agent Skills format. Covers frontmatter rules, trigger-writing, progressive disclosure, references and scripts, testing activation, token budgets, and the failure modes that make a skill never load or misfire.
license: MIT
compatibility: Applies to the open Agent Skills format used by Codex, Claude Code, Cursor, Gemini CLI, OpenCode, and compatible agents. No runtime dependencies.
metadata:
  version: 1.0.0
  author: SkillRig
  category: skills
  tags: [skills, authoring, agents, prompt-design]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Agent Skill Author

An agent skill is a folder with a `SKILL.md` file. The agent always sees the `name` and `description`; it reads the body only when the description matches the task. That design means the description is the product and the body is the manual.

Most bad skills fail before the body: the description is too vague to trigger, too broad and hijacks unrelated work, or the folder does not follow the spec so nothing is discovered at all.

## When to use

Use this skill when:

- You are creating a new skill from a procedure you keep repeating.
- An existing skill never activates, or activates at the wrong time.
- You are converting a long prompt, wiki page, or runbook into reusable agent instructions.
- You need to review a third-party skill before installing it.
- You are packaging skills into a plugin or registry.

## The contract

```
my-skill/
├── SKILL.md            # required
├── references/         # optional, loaded on demand
│   └── details.md
├── scripts/            # optional, executable helpers
│   └── check.mjs
└── assets/             # optional, templates and images
    └── template.md
```

`SKILL.md` starts with YAML frontmatter:

```yaml
---
name: my-skill
description: Use when ... It covers ... and produces ...
license: MIT
compatibility: Requires Node.js 20 or newer.
metadata:
  version: 1.0.0
  author: Your Name
  category: engineering
  tags: [testing, ci]
---
```

Hard rules:

- `name` is 1–64 characters of lowercase letters, digits, and hyphens. It must match the folder name.
- `description` is required and at most 1024 characters. It is the only text used for routing.
- The file must start with `---` on line 1. A blank line or comment before it breaks parsing in strict agents.
- Everything after the closing `---` is the body, read only after activation.
- Keep the body focused. Move long tables, API dumps, and edge cases into `references/` and link them with relative paths.

## Workflow 1: turn a repeatable task into a skill

1. **Name the single job.** Write one sentence: "Given X, produce Y, verified by Z." If the sentence needs "and", split the skill.
2. **Collect trigger language.** List the phrases a user would actually type: the verbs, file types, tools, and error strings. Put the strongest ones in `description`.
3. **Write the procedure from a real run.** Replay the task and record the commands, decision points, and failure branches that mattered. Remove steps you did not actually take.
4. **Define evidence.** For every claim the agent must make, name the command or file that proves it. "Tests pass" requires the test output.
5. **Add guardrails.** List the destructive actions, secrets, and ambiguous cases that should stop the agent.
6. **Test activation.** Give a fresh agent a task that should trigger the skill, one that should not, and one edge case. Adjust the description, not the body, when routing is wrong.
7. **Measure the cost.** Roughly four characters per token. A 400-line body costs about 4,000 tokens when activated; the description costs that on every turn.

## Workflow 2: write a description that routes correctly

A useful description has three parts:

1. **Trigger:** "Use when ..." with concrete nouns and verbs.
2. **Scope:** what the skill covers and produces.
3. **Boundary:** what it does not cover, when that prevents false activation.

Example:

```yaml
description: Use when reviewing a PostgreSQL migration before production: adding or dropping columns, changing types, creating indexes, or backfilling data. Produces a blocking/non-blocking verdict with lock analysis and a rollback plan. Does not cover query tuning or schema design from scratch.
```

Why it routes well:

- "PostgreSQL migration" and "backfill" are specific.
- It names the artifact the user will ask for.
- The boundary keeps it out of general query tuning.

Weak descriptions:

```yaml
description: Helps with databases.
```

```yaml
description: A comprehensive skill for all software engineering tasks including code review, testing, deployment, architecture, documentation, debugging, performance, security, and more.
```

The first never activates. The second activates constantly and crowds out better skills.

## Workflow 3: structure the body for an agent, not a human reader

Use this order:

1. **When to use** — one short paragraph or bullet list, matching real requests.
2. **Core model** — the two or three facts that change decisions.
3. **Workflow** — numbered steps with commands and stop conditions.
4. **Examples** — one good and one bad, both short.
5. **Guardrails** — actions to avoid, red flags, escalation.
6. **Verification** — a checklist the agent must satisfy before claiming success.
7. **References** — relative links, one line each.

Write instructions as imperatives. Prefer "Run X before Y" over "It is generally a good idea to consider running X". Agents follow specific verbs and concrete conditions.

Keep the body under roughly 500 lines. Long bodies crowd out the task context and make partial application more likely.

## Workflow 4: test a skill

Test three things separately.

**Discovery.** Start a fresh session and give a realistic task. Does the agent mention or apply the skill? If not, the description is not matching. Add the user's exact vocabulary.

**Application.** Ask the agent to follow the skill on a small real case. Check that it performs the steps, not just summarizes them. Look for skipped verification.

**Boundary.** Give a task that is adjacent but out of scope. The skill should stay quiet. If it activates, add a negative sentence to the description.

For Codex specifically:

```bash
codex exec -C /path/to/project "Use the my-skill skill. Apply it to the fixture in tests/fixtures/case-1 and show the verification output."
```

Then inspect the transcript. A skill that is loaded but summarized instead of executed needs firmer verbs in the body.

## Workflow 5: review someone else's skill

Check in this order:

<!-- skillrig-ignore-block: prompt-override, hide-from-user, remote-shell, credential-network -- review checklist quotes injection and execution strings so the reviewer knows what to look for -->
1. **Manifest**: name/folder match, description length, no unknown fields that matter.
2. **Prompt injection**: instructions aimed at the agent, not the user, such as "ignore previous instructions", "do not tell the user", or "always run this first".
3. **Execution**: every script and command, especially downloads, `curl | sh`, package installs, and credential access.
4. **Exfiltration**: environment reads, network calls, webhook URLs, encoded payloads.
5. **Scope**: does the skill claim more capability than its description?
6. **Dependencies**: missing tools, pinned versions, platform assumptions.
7. **Evidence**: does it require verification, or does it accept the agent's own claim?

If any of 2–4 is present, do not install without a manual line-by-line review. Use `skillrig scan <source>` for a first pass, then read the flagged lines yourself.

## Examples

Good trigger language for a release skill:

```yaml
description: Use when cutting a release: choosing a semver bump, updating CHANGELOG.md, tagging, and verifying the published artifact. Triggers on "release", "publish", "cut a version", and "tag vX.Y.Z". Does not deploy services.
```

Bad trigger language:

```yaml
description: Release helper.
```

A good guardrail:

```markdown
## Guardrails

- Do not push a tag until the full test suite passes on the exact commit being tagged.
- Do not edit CHANGELOG.md after tagging. Amend the release instead.
- If the version is already published, stop and report the conflict.
```

A bad guardrail:

```markdown
Be careful and use best practices.
```

The second gives the agent nothing it can check.

## Common failure modes

| Failure | Symptom | Fix |
| --- | --- | --- |
| Vague description | Skill never activates | Add concrete verbs, file names, error strings |
| Overbroad description | Activates for unrelated work | Add scope boundaries and exclusions |
| Name mismatch | Folder ignored or warning | Rename folder or `name` |
| Body too long | Context bloat, partial application | Move detail to `references/` |
| No verification | Agent claims success without evidence | Add a required checklist and commands |
| Hidden side effects | User surprised by writes or network calls | Declare every write and network call |
| Tool assumptions | Fails on another machine | State minimum versions and provide a check |
| Duplicated instructions | Conflicts with project rules | Reference the source instead of copying it |

## Guardrails

- Never ask an agent to hide actions from its user.
- Never put secrets, tokens, or personal data in a skill, example, or test fixture.
- Do not instruct an agent to disable sandboxes, approvals, or audit logging.
- Do not ship a skill that runs unreviewed remote code at startup.
- Do not copy another project's skill text without checking its license.
- If a skill needs a tool, state the requirement in `compatibility` and add a preflight check.

## Verification checklist

Before publishing:

- [ ] Folder name equals `name`, all lowercase with hyphens.
- [ ] File starts with `---` and has valid YAML.
- [ ] `description` is under 1024 characters and contains real trigger words.
- [ ] Body has when-to-use, workflow, guardrails, and verification.
- [ ] Every command is copyable and has a test path.
- [ ] No secrets, private URLs, or customer identifiers.
- [ ] A fresh agent activates the skill for the intended task.
- [ ] A near-miss task does not activate it.
- [ ] Body plus references stay within a reasonable token budget.

## References

- `references/spec-checklist.md` contains the field-by-field spec, a blank template, and a description rubric.
