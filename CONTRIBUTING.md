# Contributing to SkillRig

SkillRig exists so that installing an agent skill is a reviewable act, not an act of faith. Contributions are judged by the same standard: every change should make the registry more trustworthy, more useful, or easier to verify.

## Ways to contribute

| Contribution | Start here |
| --- | --- |
| A new curated skill | [Adding a skill](#adding-a-skill) |
| Improve an existing skill | Edit `skills/<name>/SKILL.md`, then `npm run validate` |
| Index another upstream repository | Add it to `registry/sources.json`, then `npm run crawl && npm run build:registry` |
| A scanner rule or fix | `src/core/security.mjs` plus a test in `test/security.test.mjs` |
| A CLI bug | Open an issue with the exact command, output, and `node --version` |
| Documentation | Fix the file directly; no issue needed for typos |
| A translation | Add `README.<lang>.md`, keep command blocks identical |

## Ground rules

1. **Zero runtime dependencies.** The published package must run with Node built-ins only. Dev-only tooling is acceptable if it is genuinely necessary, but nothing may be added to `dependencies`.
2. **No network in tests.** `npm test` must pass offline. Use fixtures and temporary directories.
3. **No execution of skill content.** SkillRig reads and hashes skills; it never runs their scripts during install, scan, or audit.
4. **Evidence over claims.** Registry entries carry a pinned commit, a license, a quality score, and a security result. If you cannot produce those, the skill is not ready.
5. **Security findings are resolved, not hidden.** Suppress a finding only with a narrow rule list and a real reason. Blanket `skillrig-ignore` lines are rejected in review.

## Development setup

Requires Node.js 20.11 or newer. There is nothing to install.

```bash
git clone https://github.com/LIXIAO199115/skillrig.git
cd skillrig

npm test                 # 48 tests, no network
npm run validate         # every skill: quality + security gates
npm run build            # registry + plugin + site
npm run verify           # index signature and counts
```

Useful while iterating:

```bash
node bin/skillrig.mjs scan skills/<name> --show-suppressed
node bin/skillrig.mjs info <name>
node bin/skillrig.mjs install <name> --scope project --dry-run
SKILLRIG_DEBUG=1 node bin/skillrig.mjs <command>   # stack traces
```

The CLI has no build step. Edit `src/` and run it directly.

## Adding a skill

A skill is a folder under `skills/` containing at minimum a `SKILL.md`.

```bash
node bin/skillrig.mjs init my-skill --description "Use when ..."
```

Then:

1. **Choose a name that describes the job**, not the topic. `sql-migration-review` beats `database`. Lowercase letters, digits, and hyphens; 64 characters maximum; the folder name must match.
2. **Write the description as a trigger.** It is the only text an agent sees before deciding whether to load the skill. State when to use it, and when not to.
3. **Keep `SKILL.md` under roughly 300 lines.** Move detail into `references/`, executables into `scripts/`, templates into `assets/`. Progressive disclosure is the point of the format.
4. **Add guardrails.** State what the agent must not do, what requires confirmation, and how to fail safely.
5. **Run the gates.**

```bash
node bin/skillrig.mjs scan skills/my-skill --show-suppressed
npm run validate
```

Requirements for merge:

| Gate | Threshold |
| --- | --- |
| Frontmatter | Valid YAML, required `name` and `description`, folder/name match |
| Quality | 70 or higher (`A+` is 95+) |
| Security | No unresolved critical or high findings |
| License | Declared in frontmatter and compatible with MIT distribution |
| Tests | `npm test` green |

If the scanner flags a legitimate command — installing a package, for example — suppress it narrowly:

```markdown
Install the CLI: `npm install -g example-cli` <!-- skillrig-ignore: global-install -- installing the tool is the documented setup step -->
```

or on its own line:

```markdown
<!-- skillrig-ignore-next-line: sudo -- the workflow only supports root-owned system services -->
```

Always inspect the suppression with `skillrig scan --show-suppressed` and mention it in the pull request.

### Directory layout

```
skills/my-skill/
├── SKILL.md
├── references/
│   └── checklist.md
├── scripts/
│   └── inspect.sh
└── assets/
    └── template.txt
```

Every text file in the folder is scanned and hashed. Do not commit credentials, generated archives, or binaries you cannot review.

## Indexing an upstream repository

The registry is a catalog, not a mirror. Each upstream entry pins a commit and links to the original directory.

Add a source to `registry/sources.json`:

```json
{
  "repo": "owner/repository",
  "branch": "main",
  "trust": "community",
  "enabled": true
}
```

Then:

```bash
npm run crawl            # fetch trees, scan skills, update registry/upstream.json
npm run build:registry   # merge curated + upstream + packs, sign the index
npm run verify
```

Constraints:

- The repository must ship skills in the open `SKILL.md` format.
- A recognized permissive or copyleft license is required for indexing. Unlicensed repositories may be listed as external catalogs but are not installable by default.
- The crawler skips oversized blobs and binary files, and blocks entries whose scanner result includes critical or high findings.
- Never edit `registry/upstream.json` by hand. It is generated.
- Use "external catalog" entries for repositories that are large or do not follow the folder contract; they appear in the site with a link, not an install button.

## Changing the scanner

Security changes carry the highest review bar. A pull request that touches `src/core/security.mjs` must include:

- a test that fails before the change and passes after it,
- a false-positive test for the closest legitimate use,
- an update to the rule table in `docs/security-model.md`,
- a note in `CHANGELOG.md`.

Rules must stay deterministic and offline. No LLM calls, no network lookups, no heuristics that change with machine state.

## Pull requests

- One topic per pull request.
- Use a conventional title: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `security:`.
- Describe the user-visible change, the verification you ran, and any residual risk.
- Do not bump the version or edit `CHANGELOG.md` for routine changes; the maintainer does that at release time.
- Pull requests must pass CI on Windows, macOS, and Linux across Node 20, 22, and 24.

### Review order

1. Correctness and test coverage.
2. Security impact and false-positive cost.
3. Registry honesty: counts, licenses, provenance.
4. Documentation and changelog.
5. Style. Prettier is not enforced, but match the surrounding code.

## Reporting bugs

Include:

- the exact command,
- Node version and operating system,
- whether the install was project or global scope,
- the output of `skillrig verify --installed` and `skillrig doctor`, redacted of paths if needed.

Do not paste tokens, private keys, or the contents of credential files.

## Security reports

Do not open a public issue. Use GitHub private vulnerability reporting on this repository. See [SECURITY.md](SECURITY.md) for scope and response times.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Technical disagreement is welcome; contempt is not.

## License

By contributing, you agree that your contribution is licensed under the MIT License, and that skills you add may be redistributed under their declared license.
