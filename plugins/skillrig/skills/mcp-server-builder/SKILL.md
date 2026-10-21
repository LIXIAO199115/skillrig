---
name: mcp-server-builder
description: Use when building or debugging a Model Context Protocol server over stdio for Codex, Claude Code, Cursor, or another MCP client. Covers the JSON-RPC handshake, tools/list and tools/call schemas, error handling, logging, input validation, timeout and size limits, tests, and registration with codex mcp add.
license: MIT
compatibility: Node.js 20+ for the example. Protocol behavior applies to any language. MCP clients differ slightly in supported protocol versions.
metadata:
  version: 1.0.0
  author: SkillRig
  category: agents
  tags: [mcp, json-rpc, tools, codex]
  homepage: https://github.com/LIXIAO199115/skillrig
---

# MCP Server Builder

An MCP server is a process that exposes tools, resources, or prompts to an agent over JSON-RPC. The stdio transport is newline-delimited JSON: one message per line, no headers, no extra output.

Almost every broken server fails on one of four things: it prints logs to stdout, it never answers `initialize`, its tool schema does not match its arguments, or it throws instead of returning a tool error.

## When to use

Use this skill when:

- You need to expose a local API, database, or file operation to an agent.
- A registered MCP server shows no tools.
- A tool call hangs, returns an invalid response, or crashes the client.
- You are reviewing an MCP server for security.
- You are packaging a server inside a Codex plugin.

## Minimal protocol

The client starts the process and sends:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"client","version":"1.0.0"}}}
```

The server replies with its capabilities and server info. The client then sends:

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

Tool discovery:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Tool call:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"}}}
```

Response:

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"hi"}]}}
```

Rules:

- Every request with an `id` gets exactly one response with the same `id`.
- Notifications have no `id` and get no response.
- Write one JSON object per line, terminated by `\n`.
- Never write logs, banners, or progress to stdout.
- Protocol errors use JSON-RPC error codes. Tool failures use `result.isError` with content, so the model can read the failure.

## Workflow

### 1. Decide the tool surface

A good tool is:

- Named as a verb and a noun: `search_issues`, `read_file`, `create_invoice`.
- Described in one sentence that states when to use it.
- Narrow enough that its arguments are obvious.
- Safe by default: read-only unless a write is the point.

Do not expose twenty endpoints because the underlying API has twenty. Expose the five operations an agent needs, with clear names.

### 2. Define input schemas

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1, "maxLength": 500 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
  }
}
```

- Set `additionalProperties: false`.
- Bound strings, numbers, and array lengths.
- Use `enum` for fixed choices.
- Do not accept a free-form shell command when a structured argument works.
- Validate again at runtime. The client may not enforce the schema.

### 3. Implement the loop

```js
import readline from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = (value) => ({ content: [{ type: 'text', text: String(value) }] });

const tools = [
  {
    name: 'echo',
    description: 'Return the input text. Use to test connectivity.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', maxLength: 1000 } },
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-server', version: '1.0.0' },
      },
    });
    return;
  }

  if (request.method === 'notifications/initialized') return;

  if (request.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: request.id, result: { tools } });
    return;
  }

  if (request.method === 'tools/call') {
    const { name, arguments: args = {} } = request.params ?? {};
    try {
      if (name === 'echo') {
        if (typeof args.text !== 'string') throw new Error('text must be a string');
        send({ jsonrpc: '2.0', id: request.id, result: text(args.text) });
      } else {
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
      }
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { isError: true, content: [{ type: 'text', text: error.message }] },
      });
    }
    return;
  }

  if (request.method === 'ping') {
    send({ jsonrpc: '2.0', id: request.id, result: {} });
    return;
  }

  if (request.id !== undefined) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
  }
});

console.error('echo-server ready'); // stderr only
```

### 4. Test without a client

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"}}}' \
  | node server.mjs
```

Expected: four lines of JSON, no extra text. The notification produces no response, so three responses plus silence.

Test malformed input and unknown tools too. A server that crashes on bad JSON will take down the session.

### 5. Register with Codex

```bash
codex mcp add echo -- node /absolute/path/server.mjs
codex mcp list
codex mcp get echo
```

For an HTTP server:

```bash
codex mcp add remote --url https://example.com/mcp
```

Never put a token in the command line where it appears in process listings or shell history. Use `--env` or the server's own environment.

### 6. Handle failure modes

| Failure | Response |
| --- | --- |
| Invalid JSON | JSON-RPC `-32700`, keep serving |
| Unknown method | `-32601` |
| Invalid arguments | `-32602` or `isError` with a readable message |
| Tool exception | `result.isError` with content |
| Timeout | Abort the work, return `isError`, do not hang forever |
| Oversized input | Reject before parsing |
| Upstream 5xx | Return a short error with retry guidance |
| Client disconnects | Stop work, exit cleanly |

Set timeouts on every network call. Cap response size. Stream only if the client supports it.

## Security

- Validate every argument. The model can send anything.
- Never pass an argument to a shell. Use an argument array.
- Restrict file paths to an allowed root.
- Keep credentials in the environment, never in tool output.
- Make read-only tools read-only at the implementation level, not only in the description.
- For destructive tools, require an explicit confirmation argument and return a dry-run result first.
- Rate-limit expensive tools.
- Log to stderr with secrets redacted.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Client shows zero tools | `tools/list` missing or wrong shape | Return `{ tools: [...] }` |
| Connection closes immediately | Printed to stdout before the handshake | Remove all stdout logging |
| Tool call hangs | No response sent on that path | Ensure every request id gets a response |
| `Invalid arguments` | Schema and runtime disagree | Compare `inputSchema` with the handler |
| Works in curl, not in client | Newline framing or buffering | Flush after each message, one per line |
| Random crashes | Unhandled promise rejection | Catch per request |

## Verification checklist

- [ ] Handshake works with a raw stdin test.
- [ ] `tools/list` describes every tool with a bounded schema.
- [ ] Every tool call returns a response, including errors.
- [ ] Invalid JSON does not kill the process.
- [ ] Logs go to stderr only.
- [ ] Timeouts and size limits exist.
- [ ] Arguments are validated at runtime.
- [ ] File paths and shell arguments are contained.
- [ ] Registration with `codex mcp add` works and `codex mcp list` shows it.
- [ ] A real agent can call each tool.

## References

- `references/protocol.md` contains message examples, error codes, and a tool schema checklist.
