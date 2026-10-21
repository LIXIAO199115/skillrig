---
name: sql-migration-review
description: Use when reviewing a database migration before it reaches production, especially on PostgreSQL or MySQL tables with real traffic. Covers lock behavior, backward-compatible expand and contract, concurrent index builds, batched backfills, column type and rename safety, rollback, and observability. Does not cover schema design from scratch or query tuning.
license: MIT
compatibility: Examples target PostgreSQL 14+; MySQL differences are called out. Adapt syntax to the actual engine before running.
metadata:
  version: 1.0.0
  author: SkillRig
  category: databases
  tags: [postgresql, mysql, migrations, zero-downtime]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# SQL Migration Review

A migration is a code change that runs against live data and cannot be rolled back by redeploying the application. The review question is not "does the SQL work" but "what does it lock, for how long, and can old and new code both run while it happens".

## When to use

Use this skill when:

- A migration adds, drops, renames, or retypes a column.
- An index is created on a large table.
- Data is backfilled or rewritten.
- A constraint is added or validated.
- A table is split, merged, or moved.
- A deploy needs zero downtime or a rollback path.

## Workflow

### 1. Establish the facts

- Engine and version.
- Table size: rows, bytes, index bytes.
- Write rate and peak traffic window.
- Replication topology and lag tolerance.
- Migration tool and whether it wraps statements in a transaction.
- Whether the app deploy and the migration run together or separately.
- Rollback requirement.

```sql
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

Without size and traffic, "safe" is a guess.

### 2. Classify each statement by lock

PostgreSQL examples:

| Statement | Lock | Risk |
| --- | --- | --- |
| `ADD COLUMN ... NULL` (no default, or non-volatile default on modern PG) | brief `ACCESS EXCLUSIVE` | Low |
| `ADD COLUMN ... DEFAULT volatile` | `ACCESS EXCLUSIVE`, rewrites table (older versions) | High |
| `DROP COLUMN` | `ACCESS EXCLUSIVE` | Brief but blocks reads |
| `ALTER COLUMN TYPE` | `ACCESS EXCLUSIVE`, often rewrite | High |
| `SET NOT NULL` | `ACCESS EXCLUSIVE` with full scan | High |
| `ADD CONSTRAINT ... NOT VALID` | `SHARE ROW EXCLUSIVE` | Low, validation later |
| `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` | Low, scans table |
| `CREATE INDEX` | `SHARE`, blocks writes | High on large tables |
| `CREATE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | Low, cannot run in a transaction |
| `VACUUM` | `SHARE UPDATE EXCLUSIVE` | Low |

MySQL differences:

- `ALGORITHM=INPLACE` and `LOCK=NONE` change behavior; verify support per operation and version.
- `ADD COLUMN` support and rebuild behavior changed across 5.7 and 8.0.
- Online DDL still needs headroom for concurrent DML.

### 3. Use expand and contract for breaking changes

Never drop or rename in the same deploy that stops using the old shape.

**Expand** (deploy 1):

```sql
ALTER TABLE orders ADD COLUMN customer_ref text;
```

Backfill in batches. Add a trigger or dual-write if the application cannot write both yet.

**Migrate** (deploy 2):

- Application reads the new column and writes both.
- Verify counts match.

**Contract** (deploy 3, after old code is gone):

```sql
ALTER TABLE orders DROP COLUMN customer_id;
```

A rename is a drop plus an add. Treat it as three deploys.

### 4. Create indexes concurrently

```sql
CREATE INDEX CONCURRENTLY idx_orders_customer_ref
ON orders (customer_ref);
```

Rules:

- Cannot run inside a transaction. Configure the migration tool accordingly.
- If it fails, it leaves an invalid index. Drop it before retrying.
- It takes longer than a blocking build.
- It still consumes I/O; schedule it off peak.

```sql
SELECT indexrelid::regclass, indisvalid
FROM pg_index
WHERE NOT indisvalid;
```

### 5. Add constraints safely

```sql
ALTER TABLE orders
ADD CONSTRAINT orders_total_positive CHECK (total_cents >= 0) NOT VALID;

ALTER TABLE orders VALIDATE CONSTRAINT orders_total_positive;
```

`NOT VALID` avoids a full-table scan under an exclusive lock. `VALIDATE` takes a weaker lock and can run later.

For foreign keys, the same pattern applies. Validate after the backfill.

### 6. Backfill in batches

```sql
UPDATE orders
SET customer_ref = legacy_customer_id
WHERE id IN (
  SELECT id FROM orders
  WHERE customer_ref IS NULL
  ORDER BY id
  LIMIT 1000
);
```

- Loop until zero rows.
- Sleep between batches.
- Watch replication lag and lock waits.
- Make it resumable and idempotent.
- Do not run one `UPDATE` over millions of rows in a single transaction.

### 7. Set NOT NULL without a long lock

1. Add a `CHECK (col IS NOT NULL) NOT VALID`.
2. Validate it.
3. Set `NOT NULL`. PostgreSQL can use the validated check to avoid a full scan.
4. Drop the temporary check.

### 8. Plan rollback

- Can the old application run against the new schema? If not, the migration is not backward compatible.
- Is the down migration safe, or does it lose data?
- If data was rewritten, is there a backup or a reversible mapping?
- What is the exact command and the expected duration?
- Who runs it, and how is it verified?

A migration that cannot be rolled back needs a forward-fix plan and an explicit approval.

### 9. Deploy and observe

- Run the migration before the code that needs it, when the change is additive.
- Run destructive steps after the old code is fully gone.
- Watch: lock waits, replication lag, error rate, query latency, disk usage.
- Keep a dashboard open for the migration window.
- Stop on the first sign of saturation.

## Examples

High risk:

```sql
ALTER TABLE events ALTER COLUMN payload TYPE jsonb USING payload::jsonb;
```

Rewrites the table under an exclusive lock. On a large table, writes stop for the duration.

Safer plan:

1. Add `payload_jsonb jsonb`.
2. Dual-write from the application.
3. Backfill in batches.
4. Switch reads.
5. Drop the old column in a later release.

Also risky:

```sql
CREATE INDEX idx_events_created ON events (created_at);
```

Blocks writes while it builds. Use `CREATE INDEX CONCURRENTLY` and run outside a transaction.

## Guardrails

- Do not run a migration on production without a measured table size and traffic estimate.
- Do not combine additive and destructive changes in one deploy.
- Do not use `CREATE INDEX CONCURRENTLY` inside a transaction wrapper.
- Do not backfill in a single unbounded update.
- Do not assume a lock is brief because the statement is short.
- Do not drop a column before the old code stops reading it.
- Do not rely on a down migration that loses data. Say so explicitly.
- Do not test on an empty table and infer production behavior.

## Verification checklist

- [ ] Engine and version confirmed.
- [ ] Table size and write rate recorded.
- [ ] Every statement classified by lock.
- [ ] Additive changes separated from destructive ones.
- [ ] Index builds use the concurrent form where available.
- [ ] Constraints added `NOT VALID` and validated separately.
- [ ] Backfill batched, idempotent, resumable.
- [ ] Old and new code can run together.
- [ ] Rollback path tested or explicitly declared unsafe.
- [ ] Monitoring window and stop conditions defined.

## References

- `references/migration-checklist.md` contains a statement-by-statement review sheet and a rollout timeline.
