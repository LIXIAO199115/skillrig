# Performance checklist

## Measurement record

```markdown
Commit:
Machine / container size:
Runtime version:
Workload / input:
Concurrency:
Command:
p50:
p95:
p99:
Throughput:
CPU:
Memory:
Database queries:
Baseline runs:
After:
```

## Tools

### Node.js

```bash
node --cpu-prof --heap-prof server.mjs
node --prof app.mjs
node --trace-gc app.mjs
npx clinic doctor -- node server.mjs
```

- `.cpuprofile` files open in Chrome DevTools.
- Heap snapshots: take two, compare retained size.
- GC trace: look for frequent major collections and growing heap.

### Python

```bash
py-spy record -o profile.svg -- python app.py
python -m cProfile -o out.prof app.py
```

### Go

```bash
go test -bench=. -benchmem
go tool pprof http://localhost:6060/debug/pprof/profile
```

### PostgreSQL

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT ...;

SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Check:

- Rows estimated versus actual. A large gap means stale statistics.
- Sequential scan on a large table.
- Nested loop with many iterations.
- Sort or hash spill to disk.
- High shared-read blocks for a small result.

### Frontend

```bash
npx lighthouse http://localhost:3000 --view
npx bundlesize
```

- LCP: largest contentful paint.
- INP: interaction to next paint.
- CLS: cumulative layout shift.
- Long tasks: main-thread blocks over 50 ms.
- Waterfall: render-blocking CSS and JS, image priority.

## Tail latency

Averages hide queueing. Check:

- p95 and p99 at production concurrency.
- Connection pool saturation.
- GC pauses.
- Lock waits.
- Retries amplifying load.
- Cold caches after deploy.
- Timeouts that are too close to normal latency.

## Cache checklist

Before adding a cache:

- [ ] Key includes every input that affects the result.
- [ ] TTL or invalidation strategy defined.
- [ ] Memory bound and eviction policy.
- [ ] Cold-start behavior acceptable.
- [ ] Stale data is safe for the use case.
- [ ] Cache stampede prevented.
- [ ] Metrics for hit rate and errors.

## Regression guard

- Add a benchmark or latency assertion in CI for critical paths.
- Use a stable machine or relative thresholds.
- Fail on a large regression, not on normal noise.
- Keep the workload representative and versioned.
- Store the baseline with the commit.
