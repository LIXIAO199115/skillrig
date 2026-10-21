---
name: performance-profile
description: Use when something is slow and the cause is unknown: page load, API latency, CPU usage, memory growth, database queries, build times, or batch jobs. Establishes a baseline, profiles the real workload, finds the dominant cost, and verifies that a change improved the metric without regressing another.
license: MIT
compatibility: Language-agnostic workflow. Tool examples for Node.js, Python, PostgreSQL, and Chrome.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [performance, profiling, latency, database]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# Performance Profile

"Slow" is not a diagnosis. The first job is to turn it into a metric with a baseline: which operation, under which workload, at which percentile, measured where.

Most optimization work without a profile changes code, adds complexity, and moves no number.

## When to use

Use this skill when:

- A page, endpoint, job, or build is slower than its target.
- CPU, memory, or database load is higher than expected.
- A change caused a latency or throughput regression.
- You are about to optimize and have not profiled.
- A cache or index is proposed as the fix.

## Workflow

### 1. Define the metric

Pick one primary number:

- API: p95 latency at a stated request rate.
- Page: LCP and INP on a stated device and network.
- Job: wall-clock time for a stated input size.
- Build: cold build time on a stated machine.
- Memory: peak RSS for a stated workload.

Record the percentile, the workload, and the environment. A mean hides the users who suffer.

### 2. Measure a baseline

Measure the current code, unchanged, at least three times. Keep the raw output.

```bash
hyperfine --warmup 3 'node cli.mjs --input fixtures/large.json'
```

For HTTP:

```bash
wrk -t4 -c100 -d30s http://localhost:3000/api/search?q=test
```

For PostgreSQL:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT ...;
```

Record:

- p50, p95, p99.
- Throughput.
- CPU, memory, disk, and network.
- Database query count and time.
- The commit and configuration.

If the baseline varies by more than roughly 10%, fix the measurement before optimizing.

### 3. Profile the real workload

Use the same input and environment as the baseline.

Node.js:

```bash
node --cpu-prof --heap-prof server.mjs
```

Open the `.cpuprofile` in Chrome DevTools or summarize it. Look for the widest stack, not the function with the most self time in isolation.

Python:

```bash
py-spy record -o profile.svg -- python app.py
```

Chrome:

- Performance panel, record the interaction, inspect long tasks and the main thread.
- Lighthouse for LCP, INP, CLS, and resource waterfalls.
- Coverage for unused JavaScript.

Database:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

Look for sequential scans on large tables, rows removed by filter, nested loops with high iteration counts, and sorts spilling to disk.

### 4. Classify the bottleneck

| Signal | Likely bottleneck | Next step |
| --- | --- | --- |
| CPU pegged, wide JS frames | Compute | Reduce work, algorithm, serialization |
| CPU idle, latency high | I/O or waiting | Check network, disk, locks, pool |
| Query count grows with rows | N+1 | Batch or join |
| p99 far above p50 | Queueing, GC, locks, cold cache | Concurrency and tail analysis |
| Memory climbs and never drops | Leak or unbounded cache | Heap snapshot, retention path |
| Slow only in production | Data size, cache, network, config | Compare profiles, not guesses |

Do not fix a database problem with a frontend cache, or a rendering problem with a faster server.

### 5. Form one hypothesis

> The endpoint issues one query per result row, so latency grows linearly with page size.

State the expected effect:

> Batching the queries should reduce query count from 51 to 2 and cut p95 from 800 ms to under 200 ms.

If the measurement does not move as predicted, the hypothesis was wrong. Say so and profile again.

### 6. Change one thing

- Keep a control run.
- Change the smallest variable.
- Re-measure with the same command.
- Run enough iterations to separate signal from noise.
- Check other metrics for regressions: memory, throughput, error rate.

### 7. Verify

- The primary metric improved beyond noise.
- p95 and p99 did not regress.
- Throughput did not drop.
- Memory did not grow.
- Correctness tests still pass.
- The change is understandable and maintainable.

Record before and after in the pull request:

```markdown
Baseline: p95 812 ms, 51 queries, 38% CPU
After:    p95 194 ms, 2 queries, 41% CPU
Command:  wrk -t4 -c100 -d30s ...
Machine:  4 vCPU, 8 GB, local Postgres 16
```

## Examples

Before optimizing, profile:

```bash
node --cpu-prof --cpu-prof-dir=profiles server.mjs
```

If the profile shows 62% of time in JSON serialization of a large payload, the fix is a smaller response or streaming, not a faster router.

For a frontend:

- LCP element is a hero image: optimize the image and its priority.
- LCP is text blocked by JavaScript: reduce blocking scripts.
- INP is high on click: find the long task in the Performance panel.
- CLS is high: reserve space for images and embeds.

For a database:

```sql
-- find the worst offenders
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

## Guardrails

- Do not optimize without a baseline.
- Do not benchmark on a laptop while production runs on shared CPU.
- Do not compare single runs. Noise dominates.
- Do not add a cache before understanding invalidation and memory cost.
- Do not trade correctness for speed without an explicit decision.
- Do not micro-optimize a function that is 2% of the profile.
- Do not use production traffic for load tests without approval and safeguards.
- Do not report a speedup without the command, environment, and percentile.

## Verification checklist

- [ ] Metric, percentile, workload, and environment defined.
- [ ] Baseline measured at least three times.
- [ ] Profile captured on the real workload.
- [ ] Dominant cost identified with evidence.
- [ ] Hypothesis and expected effect written down.
- [ ] One change made.
- [ ] Before and after measured with the same command.
- [ ] Other metrics checked for regressions.
- [ ] Correctness tests pass.
- [ ] Results recorded in the change description.

## References

- `references/performance-checklist.md` contains tool commands and a tail-latency checklist.
