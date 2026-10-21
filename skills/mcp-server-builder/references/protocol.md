# MCP stdio protocol reference

## Message framing

- One JSON-RPC 2.0 object per line.
- Terminate every message with `\n`.
- No Content-Length headers on stdio.
- No other stdout output.
- Log to stderr.

## Handshake

Client:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"codex","version":"0.154.0"}}}
```

Server:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"my-server","version":"1.0.0"},"instructions":"Optional short usage note."}}
```

Client:

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

The server should echo a protocol version it supports. If the client requests an unknown version, respond with the closest supported version and let the client decide whether to continue.

## Tools

List:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","title":"Search","description":"Search indexed documents. Use when the user asks about internal policy.","inputSchema":{"type":"object","additionalProperties":false,"required":["query"],"properties":{"query":{"type":"string","minLength":1,"maxLength":200},"limit":{"type":"integer","minimum":1,"maximum":20,"default":5}}}}]}}
```

Call:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{"query":"expense policy","limit":3}}}
```

Success:

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Found 3 documents..."}]}}
```

Tool failure:

```json
{"jsonrpc":"2.0","id":3,"result":{"isError":true,"content":[{"type":"text","text":"Index unavailable: connection refused"}]}}
```

JSON-RPC error:

```json
{"jsonrpc":"2.0","id":3,"error":{"code":-32602,"message":"Unknown tool: search"}}
```

Use `isError` for expected operational failures that the model should read. Use JSON-RPC errors for protocol-level mistakes.

## Error codes

| Code | Meaning |
| --- | --- |
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32000 to -32099 | Server-defined errors |

## Content types

Text:

```json
{"type":"text","text":"..."}
```

Image:

```json
{"type":"image","data":"<base64>","mimeType":"image/png"}
```

Embedded resource:

```json
{"type":"resource","resource":{"uri":"file:///path/report.md","mimeType":"text/markdown","text":"..."}}
```

Keep text results small. A tool that returns a 200 KB document on every call will exhaust the client's context.

## Notifications and cancellation

Notifications have no `id`:

```json
{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3,"reason":"user cancelled"}}
```

Handle cancellation by aborting work and releasing resources. Do not send a response for a cancelled request.

## Ping

```json
{"jsonrpc":"2.0","id":9,"method":"ping"}
```

```json
{"jsonrpc":"2.0","id":9,"result":{}}
```

## Tool schema checklist

- [ ] `name` is a stable identifier, ideally `verb_noun`.
- [ ] `description` says when to use it and what it returns.
- [ ] `inputSchema` is an object schema.
- [ ] `additionalProperties: false`.
- [ ] Every required field listed.
- [ ] Strings, arrays, and numbers bounded.
- [ ] Enums for fixed values.
- [ ] Defaults documented.
- [ ] Runtime validation matches the schema.
- [ ] Read-only versus write stated in the description.

## Limits

- Request size: reject above a configured maximum.
- Concurrent calls: cap and queue.
- Execution time: timeout every tool.
- Output size: truncate with a clear marker.
- File access: restrict to an allowed root.
- Network: allowlist destinations when possible.
