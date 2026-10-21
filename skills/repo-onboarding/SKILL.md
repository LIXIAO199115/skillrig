---
name: repo-onboarding
description: Use when entering an unfamiliar repository and needing a trustworthy map before changing code: build and test commands, entry points, data flow, deployment, ownership, and risky areas. Produces a short AGENTS.md plus a file-and-command map backed by evidence. Does not perform refactors or install dependencies.
license: MIT
compatibility: Any repository readable from a local shell. Commands shown for POSIX shells with ripgrep and git; Windows equivalents noted.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [onboarding, repository, agents-md, discovery]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Repo Onboarding

The goal is not to read the whole repository. It is to produce a map precise enough that the next change lands in the right file, using the right command, with a way to verify it.

Do this read-only. Editing before you understand the build is how a small task becomes a lost afternoon.

## When to use

Use this skill when:

- You are starting work in a repository you have not seen.
- A task begins with "figure out how this works".
- You need to write or repair `AGENTS.md`.
- Tests fail and you do not know the intended test command.
- You are estimating the blast radius of a change.

## Workflow

### 1. Inventory the root

```bash
ls -la
git status --short
git log -5 --oneline
```

Look for:

- Language and package manifests: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `*.csproj`.
- Task runners: `Makefile`, `justfile`, `Taskfile.yml`, `turbo.json`, `nx.json`.
- Containers: `Dockerfile`, `docker-compose.yml`, `compose.yaml`.
- CI: `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`.
- Agent instructions: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, `.codex/`.
- Docs: `README*`, `docs/`, `CONTRIBUTING*`, `ARCHITECTURE*`.

Do not run scripts yet. Read them.

### 2. Establish the commands

Record the exact commands for:

| Need | Where to look | Verified by |
| --- | --- | --- |
| Install dependencies | package manifest, README, CI | Running it, or the lockfile presence |
| Build | `scripts.build`, Makefile target, CI | Running the build |
| Unit tests | `scripts.test`, pytest config, CI | Running the focused suite |
| Lint and format | config files, CI | Running the command |
| Type check | `tsc --noEmit`, mypy, CI | Running it |
| Run locally | README, compose file, dev script | Starting it and hitting a health endpoint |

CI is the strongest source of truth. A README may be stale; a green pipeline is executed on every change.

### 3. Find the entry points

Start from what ships or serves:

- `bin`, `cmd/`, `main.*`, `src/index.*`, `server.*`, `app.*`.
- Framework routers, controllers, handlers.
- CLI command registration.
- Background workers and scheduled jobs.
- Public API definitions: OpenAPI, GraphQL schema, protobuf.

For each entry point, note what it calls next. Stop at the second level. A dependency graph that is three hops deep is enough for orientation.

### 4. Trace one real request or command

Pick the smallest user-visible behavior. Follow it from input to output and to the side effects:

1. Where does input enter and get validated?
2. Where is authorization checked?
3. Where does data get read or written?
4. Where do errors get converted into responses?
5. What is logged, and could it contain secrets?

This single trace exposes most of the architecture and the conventions faster than reading folders in alphabetical order.

### 5. Map the data and configuration

- Database schema and migrations directory.
- ORM models and the tables they map to.
- Cache keys and TTLs.
- Queues, topics, and consumers.
- Environment variables: names, required vs optional, example values in `.env.example`.
- Feature flags and their defaults.
- Secrets loading path. Never print values.

### 6. Map the deployment

- What artifact is produced: binary, container image, static bundle, package?
- Where does it run: Kubernetes, VM, serverless, app store?
- What triggers a deploy: tag, merge, manual workflow?
- What is the rollback path?
- What health checks exist?
- Which environments exist and how do they differ?

### 7. Locate the risk

Spend ten minutes listing the parts that punish mistakes:

- Destructive migrations and backfills.
- Payment, billing, and entitlement logic.
- Auth and permission checks.
- Anything that writes outside its own database.
- Retry loops and idempotency boundaries.
- Code with no tests around a critical path.
- Vendored code and generated files that should not be edited.

Check `git log --since="6 months" --name-only` for the files that change most. Churn is a proxy for risk and for where the maintainers focus.

### 8. Write the map

Produce two artifacts:

**`AGENTS.md`** at the repository root, short enough that an agent reads all of it:

```markdown
# Repository Guide

## Commands
- Install: `...`
- Test (focused): `...`
- Test (full): `...`
- Lint: `...`
- Build: `...`

## Layout
- `src/api` — HTTP handlers, no business logic
- `src/core` — domain rules, side-effect free
- `db/migrations` — append-only

## Conventions
- Errors are returned as `Result<T>`; do not throw across module boundaries.
- Every handler test lives next to the handler.

## Do not
- Do not edit `generated/`.
- Do not run the full integration suite without Docker.
- Do not commit `.env`.

## Verify before claiming done
- `npm test -- --run` passes.
- `npm run lint` passes.
```

**A working note** with the request trace, the risky areas, and open questions. Keep it in the task thread or a scratch file, not in the repository unless the team wants it.

## Evidence rules

- A command is "verified" only after you ran it or saw it succeed in CI.
- A file is "the entry point" only if something references it or the runtime loads it.
- An environment variable is "required" only if the code fails without it or the docs say so.
- An architecture claim needs a file path. "Probably a microservice" is not a finding.

## Examples

Good opening message after onboarding:

```markdown
Build: `pnpm build` (verified, 41s).
Tests: `pnpm test -- --run` (verified, 122 tests, 3 skipped).
Entry: `src/server.ts` -> `src/app.ts` -> routes in `src/routes/*.ts`.
Persistence: Postgres via `src/db`, migrations in `db/migrations` (append-only).
Risk: `src/billing/webhooks.ts` has no tests and handles retries; `db/migrations/0042_*` rewrites a large table.
Open: the staging deploy workflow uses a different image tag scheme than production.
```

Bad opening message:

```markdown
This looks like a standard Node app with a modular architecture. Tests are probably run with npm test.
```

The second gives no file, no command, and no verified fact.

## Guardrails

- Do not run install scripts, `postinstall`, or arbitrary repo scripts before reading them.
- Do not execute a migration or deploy to learn what it does.
- Do not print `.env` or secret values. Report variable names only.
- Do not edit source files during onboarding. Write the map first.
- Do not trust a stale README over CI and code.
- If two sources disagree, record both and say which one you tested.

## Verification checklist

- [ ] Working tree state recorded before any command.
- [ ] Install, test, lint, and build commands verified.
- [ ] Entry points traced to a real handler or command.
- [ ] Data stores and migrations located.
- [ ] Environment variables listed by name only.
- [ ] Deploy trigger and rollback path identified.
- [ ] Risky files listed with a reason.
- [ ] `AGENTS.md` written and under roughly 60 lines.
- [ ] Every claim has a file path or a command result.

## References

- `references/agents-md-template.md` contains a longer template and examples for monorepos and libraries.
