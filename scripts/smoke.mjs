#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/core/util.mjs';

const BIN = path.join(PACKAGE_ROOT, 'bin', 'skillrig.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillrig-smoke-'));
const home = path.join(root, 'home');
const project = path.join(root, 'project');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(project, { recursive: true });

function run(args, { expect = 0 } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      SKILLRIG_HOME: path.join(home, '.skillrig'),
      NO_COLOR: '1',
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, expect, `skillrig ${args.join(' ')}\n${result.stderr || result.stdout}`);
  return result.stdout || '';
}

function json(text) {
  return JSON.parse(text);
}

let passed = 0;
function step(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} — ${name}`);
}

try {
  step('help lists the command surface', () => {
    const text = run(['--help']);
    for (const command of ['search', 'install', 'scan', 'verify', 'mcp', 'pack', 'publish']) {
      assert.match(text, new RegExp(`\\b${command}\\b`));
    }
  });

  step('registry signature and file integrity verify', () => {
    const text = run(['verify']);
    assert.match(text, /registry verified/i);
  });

  step('search returns signed registry results', () => {
    const payload = json(run(['search', 'codex', '--json', '--limit', '5']));
    assert.ok(payload.count > 0);
    assert.ok(payload.skills.some((skill) => skill.name === 'codex-cli-workflows'));
    assert.ok(payload.skills.every((skill) => typeof skill.name === 'string'));
  });

  step('info resolves a curated entry', () => {
    const payload = json(run(['info', 'codex-cli-workflows', '--json']));
    assert.equal(payload.skill.name, 'codex-cli-workflows');
    assert.equal(payload.skill.source.type, 'bundled');
  });

  step('install writes the Codex skill and lockfile', () => {
    run(['install', 'codex-cli-workflows', '--agent', 'codex', '--cwd', project]);
    assert.ok(fs.existsSync(path.join(home, '.codex', 'skills', 'codex-cli-workflows', 'SKILL.md')));
  });

  step('list reports a verified install', () => {
    const payload = json(run(['list', '--json', '--cwd', project]));
    assert.equal(payload.count, 1);
    assert.equal(payload.skills[0].agent, 'codex');
    assert.equal(payload.skills[0].status, 'ok');
  });

  step('budget measures the installed set', () => {
    const payload = json(run(['budget', '--json', '--cwd', project]));
    assert.equal(payload.entries.length, 1);
    assert.ok(payload.totals.totalTokens > 0);
  });

  step('remove deletes the install', () => {
    const payload = json(run(['remove', 'codex-cli-workflows', '--agent', 'codex', '--json', '--cwd', project]));
    assert.equal(payload.removed.length, 1);
    assert.ok(!fs.existsSync(path.join(home, '.codex', 'skills', 'codex-cli-workflows')));
  });

  step('MCP server initialises and lists tools', () => {
    const input = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      '',
    ].join('\n');
    const result = spawnSync(process.execPath, [BIN, 'mcp'], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, HOME: home, USERPROFILE: home, SKILLRIG_HOME: path.join(home, '.skillrig'), NO_COLOR: '1' },
      input,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const list = messages.find((message) => message.id === 2);
    assert.ok(list, 'tools/list response missing');
    assert.ok(list.result.tools.length >= 10);
  });

  console.log(`\nSmoke test passed: ${passed} checks.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
