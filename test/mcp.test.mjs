import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, TOOLS, PROTOCOL_VERSION } from '../src/core/mcp.mjs';
import { tempDir } from './helpers.mjs';

test('exposes the full tool surface', () => {
  const names = TOOLS.map((tool) => tool.name);
  for (const name of [
    'skillrig_search',
    'skillrig_info',
    'skillrig_install',
    'skillrig_remove',
    'skillrig_list',
    'skillrig_scan',
    'skillrig_audit',
    'skillrig_budget',
    'skillrig_doctor',
    'skillrig_sync',
  ]) {
    assert.ok(names.includes(name), name);
  }
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('answers initialize and tools/list', async () => {
  const { dir, cleanup } = tempDir();
  try {
    const init = await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { cwd: dir, home: dir },
    );
    assert.equal(init.result.serverInfo.name, 'skillrig');
    assert.equal(init.result.protocolVersion, PROTOCOL_VERSION);
    assert.ok(init.result.capabilities.tools);

    const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { cwd: dir, home: dir });
    assert.ok(list.result.tools.length >= 10);
  } finally {
    cleanup();
  }
});

test('search tool returns installable results', async () => {
  const { dir, cleanup } = tempDir();
  try {
    const response = await handleMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'skillrig_search', arguments: { query: 'review', limit: 2 } } },
      { cwd: dir, home: dir },
    );
    const payload = JSON.parse(response.result.content[0].text);
    assert.ok(payload.results.length > 0);
    assert.ok(payload.results.every((skill) => typeof skill.name === 'string'));
  } finally {
    cleanup();
  }
});

test('unknown tools produce JSON-RPC errors', async () => {
  const response = await handleMessage(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    { cwd: process.cwd(), home: process.cwd() },
  );
  assert.equal(response.result.isError, true);
});

test('notifications produce no response', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(response, null);
});
