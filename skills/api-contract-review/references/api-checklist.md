# API Contract Review Sheet

Copy this into the review ticket. Fill every line; write `n/a` with a one-word reason when a line does not apply. An empty line is an unreviewed line.

## 1. Endpoint identity

| Field | Value |
| --- | --- |
| Method + path | |
| Auth scheme (token class, scope) | |
| Tenant / ownership boundary | |
| Idempotency class | safe / idempotent / non-idempotent |
| Rate limit (per principal, per window) | |
| Max request body | |
| Max response body | |
| SLA / timeout budget | |

## 2. Request review

- [ ] Path parameters are opaque IDs, not natural keys that leak sequence or volume.
- [ ] Query parameters have documented defaults, bounds, and a defined sort order.
- [ ] A collection endpoint caps `limit` server-side and rejects or clamps above the cap.
- [ ] Filter combinations that cannot be indexed are rejected, not silently scanned.
- [ ] Free-text search has a minimum query length and a documented tokenizer behaviour.
- [ ] Unknown JSON properties are rejected (`additionalProperties: false`) or explicitly tolerated and documented.
- [ ] Timestamps accept RFC 3339 with an explicit offset; naive local times are rejected.
- [ ] Enumerations are closed and documented with the version that introduced each value.
- [ ] Binary uploads declare content type, size limit, and checksum field.

## 3. Response review

- [ ] Success bodies match the documented schema exactly, including nullability.
- [ ] Every error path returns the same Problem Details envelope (RFC 9457).
- [ ] `type` URIs resolve to a page that names the fix.
- [ ] Status codes follow the matrix below, not ad hoc habits.
- [ ] `Location` is set on 201; `Retry-After` is set on 429 and 503.
- [ ] `ETag` is present on single-resource GET when conditional requests are supported.
- [ ] Pagination exposes `next` cursor or an explicit `has_more`; totals are best-effort and labelled.
- [ ] Deleted resources return 204 with no body, or a tombstone with a documented retention window.
- [ ] Error responses never echo secrets, stack traces, SQL, or internal hostnames.

## 4. Status code matrix

| Situation | Code | Notes |
| --- | --- | --- |
| Body fails schema or business validation | 400 | Machine-readable `errors[]` per field |
| Missing or malformed credentials | 401 | `WWW-Authenticate` names the scheme |
| Authenticated but not permitted | 403 | Distinguish from 404 only if resource existence is public |
| Resource absent, or hidden across tenant boundary | 404 | Prefer 404 over 403 to avoid enumeration |
| Method exists elsewhere but not here | 405 | `Allow` header required |
| State conflict (version, duplicate, illegal transition) | 409 | Include current state and expected state |
| Semantic validation failure | 422 | Only if the team already uses it consistently |
| Rate limited | 429 | `Retry-After` and limit headers |
| Unexpected server fault | 500 | No internal detail, correlation ID only |
| Dependency unavailable | 502 / 503 | `Retry-After` on 503 |
| Upstream timeout | 504 | Distinct from client timeout |

## 5. State-changing operations

- [ ] Create accepts a client-supplied idempotency key and stores the response for the replay window.
- [ ] Update uses `If-Match` on the resource version, or declares last-write-wins explicitly.
- [ ] Patch follows RFC 7396 merge-patch semantics or documents the difference.
- [ ] Delete is soft where audit or recovery is required, with a documented purge window.
- [ ] Long-running operations return 202 with an operation resource the client can poll.
- [ ] Webhooks carry a signature header, a timestamp, and a replay window.
- [ ] Compensating actions exist for every multi-step workflow that spans services.

## 6. Authorization boundaries

- [ ] Every endpoint names the scope it requires.
- [ ] Object-level checks run after authentication, on the resolved object, not on the ID string.
- [ ] List endpoints filter by principal before pagination, not after.
- [ ] Admin endpoints live under a separate prefix and are audited.
- [ ] Impersonation and delegation tokens carry the acting principal in the audit trail.
- [ ] Token expiry, rotation, and revocation behaviour is documented.

## 7. Breaking-change matrix

| Change | Breaking? | Migration path |
| --- | --- | --- |
| Add an optional request field | No | Ignore-unknown tolerance must already be documented |
| Add a response field | No | Clients must ignore unknown fields |
| Add an enum value | Usually no | Only safe if clients have a default branch |
| Remove or rename a field | Yes | Add new, dual-write, deprecate, remove after sunset |
| Change a field type or format | Yes | New field name; never reuse the old one |
| Make an optional request field required | Yes | New version or new endpoint |
| Tighten validation (smaller max, stricter regex) | Yes | Announce as breaking even if "more correct" |
| Change a default value | Yes | Changes observed behaviour without a code change |
| Change pagination shape | Yes | New version; clients paginate on structure |
| Change error code for an existing situation | Yes | Error handling branches on code |
| Change auth scheme or scope names | Yes | Overlap both schemes during migration |
| Change rate limits downward | Yes | Publish before enforcing |
| Deprecate an endpoint | No | Requires `Deprecation` and `Sunset` headers plus a date |
| Change sorting of a collection | Yes | Clients cache and page on order |

## 8. Contract test checklist

- [ ] OpenAPI (or equivalent) is generated from or verified against the running service.
- [ ] A consumer-driven contract test exists for each known client.
- [ ] Schema diff runs in CI and fails on breaking changes without an approval label.
- [ ] Example requests in docs are executed in CI against a sandbox.
- [ ] Error cases have tests, not only happy paths.
- [ ] Fuzz or property tests cover ID parsing and pagination cursors.
- [ ] Contract tests run against the oldest supported version, not only `main`.

## 9. Sign-off

| Question | Answer |
| --- | --- |
| Who breaks if this ships wrong? | |
| How will we know within one hour? | |
| What is the rollback? | |
| What is the sunset date for anything deprecated here? | |
