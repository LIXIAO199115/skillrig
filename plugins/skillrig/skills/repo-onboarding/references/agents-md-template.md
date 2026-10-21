# AGENTS.md templates

AGENTS.md is loaded into the agent's context. Every line costs tokens on every turn. Keep it to decisions the agent cannot infer from the code.

## Minimal application repository

```markdown
# Repository Guide

## Commands
- Install: `pnpm install --frozen-lockfile`
- Test: `pnpm test -- --run`
- Single test: `pnpm test -- src/orders/order.test.ts`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`

## Layout
- `src/http` — routing and validation only
- `src/domain` — business rules, no I/O
- `src/db` — repositories and migrations
- `tests/` — integration tests that need Docker

## Conventions
- Domain functions return `Result<T, E>`; HTTP layer maps errors.
- New tables require a migration and a rollback note.
- Prefer existing helpers in `src/domain/money.ts` over new formatting code.

## Avoid
- Editing `src/generated/` and `openapi.json`; regenerate them.
- Running `pnpm db:reset` against a shared database.
- Committing `.env*` files.

## Done means
- `pnpm test -- --run` passes.
- `pnpm lint` and `pnpm typecheck` pass.
- The changed behavior has a test that fails without the change.
```

## Monorepo

```markdown
# Monorepo Guide

## Commands
- Install: `pnpm install --frozen-lockfile`
- All tests: `pnpm turbo test`
- One package: `pnpm --filter @acme/api test`
- Build one package: `pnpm --filter @acme/api build`

## Packages
- `apps/api` — HTTP service, owns Postgres schema
- `apps/web` — Next.js frontend, no direct database access
- `packages/ui` — shared components, no business logic
- `packages/config` — eslint, tsconfig, tailwind presets

## Rules
- Cross-package imports use the package name, never a relative `../`.
- A schema change updates `packages/contracts` and both apps in the same PR.
- Do not add a new shared package without a second consumer.

## Done means
- `pnpm turbo lint typecheck test --filter=...[HEAD^]` passes for changed packages.
```

## Library

```markdown
# Library Guide

## Commands
- Test: `npm test`
- Types: `npm run typecheck`
- Build: `npm run build`
- Docs: `npm run docs`

## Rules
- Public API changes require a changeset and a migration note.
- No runtime dependencies without a size and license check.
- Every exported symbol has a doc comment with an example.
- Node 20 is the minimum supported runtime; do not use newer syntax without a fallback.

## Done means
- `npm test` and `npm run typecheck` pass.
- `npm run build` produces no new warnings.
- The README example still runs.
```

## Writing rules

- Put commands in backticks and make them copyable.
- State the working directory when it is not the repository root.
- Prefer "Do X" over "Consider X".
- Do not restate what the folder names already say.
- Do not paste an architecture essay. Link to `docs/architecture.md`.
- Update AGENTS.md in the same pull request that changes the command or convention.
- Keep secrets out. Refer to environment variable names only.

## What not to include

- Full dependency lists.
- Generated API documentation.
- Personal preferences that are not enforced by tooling.
- Historical decisions. Put those in ADRs and link them.
- Instructions that conflict with `README.md` or CI. Resolve the conflict first.
