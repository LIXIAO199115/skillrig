# SQL migration review sheet

## Context

```markdown
Engine and version:
Table:
Rows:
Total size:
Peak writes per second:
Replication topology:
Migration tool:
Runs in a transaction: yes/no
App deploy coupling:
Rollback requirement:
Maintenance window:
```

## Statement review

For each statement:

```markdown
Statement:
Lock:
Estimated duration:
Blocks reads: yes/no
Blocks writes: yes/no
Rewrites table: yes/no
Backward compatible: yes/no
Rollback:
```

## Safe patterns

### Add a nullable column

```sql
ALTER TABLE t ADD COLUMN c text;
```

Brief exclusive lock. Safe when no default rewrite is needed.

### Add a column with a constant default

Modern PostgreSQL stores a non-volatile default without a full rewrite. Verify the version's behavior before relying on it. For volatile defaults, add nullable, backfill, then set the default.

### Add a check constraint

```sql
ALTER TABLE t ADD CONSTRAINT c_check CHECK (c > 0) NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT c_check;
```

### Add a foreign key

```sql
ALTER TABLE child
ADD CONSTRAINT child_parent_fk FOREIGN KEY (parent_id) REFERENCES parent(id) NOT VALID;

ALTER TABLE child VALIDATE CONSTRAINT child_parent_fk;
```

Both tables need the referenced key indexed.

### Create an index

```sql
CREATE INDEX CONCURRENTLY idx_t_c ON t (c);
```

Outside a transaction. Check for invalid indexes after a failure.

### Set NOT NULL

```sql
ALTER TABLE t ADD CONSTRAINT c_not_null CHECK (c IS NOT NULL) NOT VALID;
ALTER TABLE t VALIDATE CONSTRAINT c_not_null;
ALTER TABLE t ALTER COLUMN c SET NOT NULL;
ALTER TABLE t DROP CONSTRAINT c_not_null;
```

### Rename a column

Three releases:

1. Add the new column, dual-write.
2. Backfill, switch reads to the new column.
3. Drop the old column.

### Change a type

1. Add a new column of the target type.
2. Dual-write.
3. Backfill with a conversion that handles bad rows.
4. Switch reads.
5. Drop the old column.

## Backfill loop

```sql
-- repeat until 0 rows
WITH batch AS (
  SELECT id FROM t
  WHERE new_col IS NULL
  ORDER BY id
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
UPDATE t
SET new_col = old_col
FROM batch
WHERE t.id = batch.id;
```

Commit each batch. Sleep between batches. Measure lag.

## Rollout timeline

```markdown
T-1 day:  migration reviewed and dry-run on a production-sized copy
T-0:      deploy additive migration
T+0:      deploy dual-write application
T+1 h:    verify write counts and error rate
T+1 day:  start backfill off peak
T+2 days: verify counts, switch reads
T+7 days: remove old writes
T+14 days: remove old column and code
```

Adjust the gaps to the release cadence. The important part is that no step depends on two incompatible versions running at once.

## Monitoring queries

PostgreSQL lock waits:

```sql
SELECT pid, wait_event_type, wait_event, state, query
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';
```

Long-running transactions:

```sql
SELECT pid, now() - xact_start AS age, state, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY age DESC
LIMIT 10;
```

Invalid indexes:

```sql
SELECT indexrelid::regclass, indrelid::regclass
FROM pg_index
WHERE NOT indisvalid;
```

Replication lag depends on the topology. Use the provider's metric or `pg_stat_replication`.

## Stop conditions

Stop and roll forward or back when:

- Lock waits exceed the agreed threshold.
- Replication lag exceeds the tolerance.
- Error rate rises above baseline.
- Disk usage approaches the alert threshold.
- The migration runs longer than the tested duration by a wide margin.
