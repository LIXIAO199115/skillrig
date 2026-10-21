---
name: api-contract-review
description: Use when designing or reviewing an HTTP, GraphQL, or gRPC API contract before implementation or release. Covers resource naming, methods and status codes, error shapes, pagination, idempotency, concurrency control, versioning, backward compatibility, auth boundaries, and contract tests. Does not implement the service.
license: MIT
compatibility: Applies to REST, GraphQL, and protobuf APIs. Examples use HTTP/JSON and OpenAPI 3.1. Validation tools vary by stack.
metadata:
  version: 1.0.0
  author: SkillRig
  category: engineering
  tags: [api, rest, openapi, graphql, compatibility]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# API Contract Review

An API contract is a promise about inputs, outputs, errors, and evolution. The expensive mistakes are rarely syntax. They are ambiguous semantics, unbounded results, missing idempotency, and a breaking change shipped as a patch.

Review the contract before code, then test it against the contract.

## When to use

Use this skill when:

- Designing a new endpoint, mutation, or RPC.
- Reviewing an OpenAPI, GraphQL, or protobuf change.
- Adding a field, status code, or parameter to an existing API.
- Planning a version bump or deprecation.
- An agent or client needs to integrate with the API.

## Workflow

### 1. Identify the contract source of truth

- OpenAPI document for REST.
- GraphQL schema and persisted operations.
- `.proto` files and the generated stubs.
- JSON Schema for event payloads.
- A human document, which is the weakest source.

If the document and the implementation disagree, test the implementation and fix the document in the same change.

### 2. Check resource and method semantics

| Operation | Method | Success | Safe | Idempotent |
| --- | --- | --- | --- | --- |
| List | GET | 200 | yes | yes |
| Read | GET | 200 | yes | yes |
| Create | POST | 201 + Location | no | no unless keyed |
| Full replace | PUT | 200/204 | no | yes |
| Partial update | PATCH | 200/204 | no | not guaranteed |
| Delete | DELETE | 204/202 | no | yes |

- Nouns in paths, verbs in methods: `/orders/{id}`, not `/getOrder`.
- Plural collections, stable identifiers.
- No verbs in the body that duplicate the method.
- `POST` for actions that do not fit CRUD: `/orders/{id}/cancel`.
- `HEAD` and `OPTIONS` behave consistently with `GET`.

### 3. Check status and error semantics

- `200` with a body, `204` without.
- `201` with `Location` for creation.
- `400` for malformed syntax, `422` for semantically invalid input when the stack distinguishes them.
- `401` unauthenticated, `403` authenticated but not allowed.
- `404` for missing or intentionally hidden resources.
- `409` for state conflicts.
- `412` for failed preconditions, `428` when a precondition is required.
- `429` with retry guidance.
- `5xx` only for server faults.

Error body, preferably RFC 9457 Problem Details:

```json
{
  "type": "https://example.com/problems/insufficient-funds",
  "title": "Insufficient funds",
  "status": 409,
  "detail": "The account balance is 1200 cents; the transfer requires 5000.",
  "instance": "/transfers/01J8Z3",
  "code": "insufficient_funds",
  "traceId": "4f1c..."
}
```

Rules:

- One error shape across the API.
- Machine-readable `code` stable across versions.
- Human-readable `detail` safe to show.
- No stack traces, SQL, secrets, or internal hostnames.
- Validation errors identify the field and the rule.

### 4. Bound every collection

- Default page size and maximum.
- Cursor pagination for large or changing sets.
- Stable sort order with a tiebreaker.
- Total counts only when cheap, or marked approximate.
- Filters and sort fields documented and allowlisted.

```json
{
  "data": [],
  "nextCursor": "eyJpZCI6MTIzfQ",
  "hasMore": true
}
```

Offset pagination is acceptable for small, stable datasets. It skips and duplicates rows when the underlying data changes.

### 5. Design for retries

- `POST` creation accepts an `Idempotency-Key`.
- The server stores the key with the result for a documented window.
- A repeated key returns the original result, not a duplicate.
- Retries are safe for `GET`, `PUT`, `DELETE`, and keyed `POST`.
- Timeouts and retry guidance are in the error body or headers.

### 6. Handle concurrent updates

- `ETag` on reads, `If-Match` on writes.
- `412` when the precondition fails.
- Or a version field in the body with a compare-and-set.
- Document the conflict response and how the client resolves it.

### 7. Check authorization boundaries

- Every object access checks ownership or tenant, not only authentication.
- List endpoints filter by tenant at the query level.
- Admin-only fields are not serialized for normal users.
- Bulk endpoints check every id, not only the first.
- Errors do not reveal whether another tenant's object exists.

### 8. Plan evolution

Non-breaking:

- Adding an optional request field with a safe default.
- Adding a response field clients must ignore.
- Adding a new endpoint.
- Adding an enum value only if clients tolerate unknown values. Document that requirement.
- Adding an optional header.

Breaking:

- Removing or renaming a field.
- Changing a type or format.
- Making an optional field required.
- Changing a status code or error shape.
- Changing default behavior.
- Tightening validation.
- Changing pagination or sort semantics.
- Removing an enum value clients may send.

Versioning options:

- URI version `/v2` for broad, visible breaks.
- Media type versioning for content negotiation.
- Additive evolution with a compatibility policy.
- GraphQL: deprecate fields, never reuse a removed name with different semantics.
- Protobuf: reserve removed field numbers and names; never reuse them.

### 9. Test the contract

- Validate the document (for example, Spectral for OpenAPI).
- Diff against the previous version (for example, `openapi-diff`).
- Check protobuf compatibility (for example, `buf breaking`).
- Run contract tests against the implementation.
- Verify error responses, not only success.
- Test pagination boundaries and idempotent retries.

## Examples

Weak:

```http
POST /api/doOrder
{ "user": 12, "items": "..." }
```

Problems: verb in the path, ambiguous creation semantics, no idempotency, no error contract.

Stronger:

```http
POST /orders
Idempotency-Key: 8f14e45f-ea3b-4c1a-9d1f-2b7c9a1e5d3f
Content-Type: application/json

{ "items": [{ "sku": "SKU-1", "quantity": 2 }] }
```

```http
201 Created
Location: /orders/01J8Z3
```

```json
{ "id": "01J8Z3", "status": "pending", "totalCents": 5000 }
```

## Guardrails

- Do not expose internal identifiers or sequential ids when enumeration is a risk.
- Do not return unbounded lists.
- Do not use `200` for errors.
- Do not put secrets or tokens in URLs.
- Do not change validation rules without a version or a migration plan.
- Do not add a required field to an existing request.
- Do not reuse a removed protobuf field number or a GraphQL field name with new semantics.
- Do not publish an API without rate limits and a documented error shape.

## Verification checklist

- [ ] Source of truth identified and current.
- [ ] Paths and methods follow the resource model.
- [ ] Success and error status codes documented.
- [ ] One error shape with machine-readable codes.
- [ ] Collections bounded with documented pagination.
- [ ] Retries safe and idempotency documented.
- [ ] Concurrency control defined.
- [ ] Authorization checked per object.
- [ ] Breaking-change diff reviewed.
- [ ] Contract tests cover errors, pagination, and retries.
- [ ] Deprecation policy stated.

## References

- `references/api-checklist.md` contains an endpoint review sheet and a breaking-change matrix.
