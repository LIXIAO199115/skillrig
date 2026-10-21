---
name: docs-writer
description: Use when writing or updating README files, how-to guides, reference docs, migration notes, or architecture explanations for a software project. Produces documentation with tested commands, explicit audience, and no invented behavior. Also use when docs are stale after an API or CLI change.
license: MIT
compatibility: Any repository with Markdown documentation. Examples use standard shell commands.
metadata:
  version: 1.0.0
  author: SkillRig
  category: documentation
  tags: [documentation, readme, how-to, reference]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Docs Writer

Documentation is a contract with a reader who cannot see the code. A wrong command costs more than a missing paragraph, because the reader trusts it and fails.

Write only what you verified. Mark what you did not.

## When to use

Use this skill when:

- Creating a README for a new project.
- Adding a how-to for a workflow users struggle with.
- Updating docs after a CLI flag, API field, or default changed.
- Writing migration notes for a breaking change.
- Explaining architecture to a new contributor.
- Reviewing documentation for accuracy before release.

## Workflow

### 1. Name the reader and the job

Write one sentence:

> A developer who has never used this project wants to install it and make one successful request in under five minutes.

Different readers need different documents:

| Document | Reader | Job |
| --- | --- | --- |
| README | New user | Understand, install, run one example |
| Tutorial | New user | Learn by doing, in order |
| How-to | Existing user | Solve one specific problem |
| Reference | Existing user | Look up an exact option or field |
| Explanation | Contributor or operator | Understand why the system works this way |
| Migration guide | Upgrading user | Change code safely |

Do not mix all six into one README. Link to the others.

### 2. Verify every command

Run each command in a clean environment. Copy the output that proves it worked.

- Use the real package name, binary name, and version.
- Show the working directory when it matters.
- Do not use ellipses inside commands; readers paste them.
- Show expected output, at least one line.
- Note prerequisites and the command that checks them.
- Test on the platforms you claim to support, or say which one you tested.

If you cannot run a command, write "not verified" in the draft and remove it before publishing, or mark it clearly as untested.

### 3. Structure for scanning

Most readers scan, then read one section.

- Title: what it is, in plain language.
- One-paragraph description: problem, solution, who it is for.
- Quick start: the shortest working path.
- Features: what it does, each with one concrete detail.
- Usage: commands or API examples.
- Configuration: options with defaults and types.
- Troubleshooting: the five failures users hit.
- Contributing and license.

Put the most valuable information above the fold. Do not open with a badge wall or a table of contents for a short document.

### 4. Write examples that run

<!-- skillrig-ignore-block: global-install -- install instructions for the CLI this document ships -->
```bash
npm install --global skillrig@1.0.0
skillrig search testing
```

```text
NAME                GRADE  DESCRIPTION
test-first-fix      A      Turn a bug report into a failing test
```

- Use realistic values, never real credentials.
- Keep examples short enough to read in one screen.
- Show one success and the most common failure.
- Prefer copy-paste blocks over pseudo-code.
- For APIs, show request and response, including status codes.

### 5. Write reference accurately

Every option needs:

- Name and type.
- Default.
- Allowed values.
- What it changes.
- A one-line example.
- Since which version, when relevant.

Generate reference from code when possible, and add a test that fails when the docs drift. A hand-maintained flag table will be wrong within two releases.

### 6. Explain decisions, not just behavior

For architecture or design docs:

- State the constraint that forced the decision.
- List the alternatives considered.
- State the trade-off accepted.
- Record what would cause a revisit.

```markdown
We store the registry index as a single JSON file instead of a database because the catalog is under 10 MB, updates are batched, and clients need offline verification. The trade-off is slow full-text search at catalog sizes above roughly 5,000 skills. Revisit when search latency exceeds 300 ms at p95.
```

That paragraph is useful in a year. "We use JSON for simplicity" is not.

### 7. Keep docs alive

- Update docs in the same pull request as the behavior change.
- Put a test around critical snippets.
- Add a link checker to CI.
- Date time-sensitive claims.
- Remove screenshots that show an interface that no longer exists.
- Delete deprecated sections after the deprecation window.

## Examples

Weak quick start:

```markdown
Install the package and configure it as needed, then run the app.
```

Strong quick start:

<!-- skillrig-ignore-block: global-install -- install instructions for the CLI this document ships -->
```bash
npm install --global skillrig@1.0.0
skillrig doctor
skillrig search "code review"
```

```text
SkillRig doctor
  Node.js      22.17.0  ok
  Registry     verified  ok
  Codex skills ~/.codex/skills  ok
```

Weak option description:

```markdown
--force: force the operation.
```

Strong option description:

```markdown
`--force`: replace a skill directory that SkillRig does not manage. Requires the target to contain a `SKILL.md`. Refuses to delete a directory without one. Default: `false`.
```

## Guardrails

- Do not invent flags, fields, limits, prices, or platform support.
- Do not copy commands from another project without running them here.
- Do not use "simply", "just", or "obviously" for steps that can fail.
- Do not hide prerequisites in a later section.
- Do not publish secrets, internal URLs, customer names, or personal data in examples.
- Do not describe a future feature as available. Use a roadmap section.
- Do not let a screenshot be the only explanation of a workflow.

## Verification checklist

- [ ] Reader and job stated before writing.
- [ ] Every command run in a clean environment.
- [ ] Prerequisites listed and checked.
- [ ] Expected output shown.
- [ ] All options documented with defaults.
- [ ] Failure modes and troubleshooting included.
- [ ] Links and relative paths resolve.
- [ ] No stale screenshots or version claims.
- [ ] Docs updated in the same change as the code.
- [ ] Untested claims removed or marked.

## References

- `references/doc-patterns.md` contains a README skeleton, a how-to skeleton, and a migration note template.
