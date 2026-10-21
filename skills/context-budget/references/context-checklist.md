# Context budget checklist

## Measurement

```bash
# instruction files
wc -c AGENTS.md CLAUDE.md 2>/dev/null

# skill bodies
find . -name SKILL.md -not -path '*/node_modules/*' -print0 | xargs -0 wc -c

# installed state
skillrig list
skillrig budget
skillrig doctor
```

Approximate tokens:

- English: bytes / 4.
- CJK: roughly one token per character.
- Code: often bytes / 3.
- JSON schemas: bytes / 3.5.

Treat these as estimates and validate with the provider's tokenizer when cost matters.

## Always-on inventory

| Source | How to inspect | Typical fix |
| --- | --- | --- |
| Skill metadata | `skillrig budget` | Shorten descriptions, move to packs |
| `AGENTS.md` | `wc -c`, read it | Move architecture to docs, link |
| MCP tools | Provider UI or server config | Expose fewer tools, shorten schemas |
| System prompt | Not editable | Reduce conflicting custom rules |
| Conversation | Transcript length | New session, progress note |

## Trimming recipes

### AGENTS.md

Keep:

- Exact commands.
- Conventions not enforced by tooling.
- Prohibitions with a reason.
- Definition of done.

Move:

- Architecture overview → `docs/architecture.md`.
- Setup tutorial → `README.md`.
- Historical decisions → ADRs.
- Long checklists → `references/` in a skill.

### Skill descriptions

Keep:

- "Use when" plus concrete triggers.
- The produced artifact.
- The boundary.

Remove:

- Marketing language.
- Full lists of every feature.
- Repeated synonyms.
- Examples.

Test after every edit: one task that should activate and one that should not.

### Skill bodies

Move to `references/`:

- Provider-specific tables.
- Long examples.
- Edge-case catalogs.
- Version-specific notes.

Move to `scripts/`:

- Deterministic checks.
- File transforms.
- Parsers.
- Report generators.

### MCP

- Split large servers.
- Remove unused servers from the session.
- Shorten tool descriptions.
- Avoid schemas with deeply nested `anyOf` when a flat object works.

### Conversation

- Write decisions to a task note.
- Summarize state before a pause.
- Start a new session for a new objective.
- Do not re-paste large files; reference the path and the relevant lines.

## Budget worksheet

```markdown
Session:
Model:
System and tools:
Skills always-on:
AGENTS.md:
Task files:
Conversation so far:
Total:
Largest contributor:
Change made:
After:
Activation tests:
```

## Warning signs

- The agent repeats an instruction you already gave.
- It forgets the test command.
- It summarizes the task instead of doing it.
- It reads the same file twice without a change.
- Responses slow down without more work.
- Cost per task climbs while output stays flat.

## Do not

- Delete a safety rule to save 100 tokens.
- Shorten a description until it no longer routes.
- Assume a bigger context window solves a focus problem.
- Load every reference file at session start.
- Keep a 2,000-line transcript for a 20-line task.
