import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncAgentsBlock, checkAgentsBlock, buildAgentsBlock } from '../src/core/agentsmd.mjs';
import { tempDir } from './helpers.mjs';

function entriesFor(cwd) {
  return [
    {
      name: 'alpha-skill',
      scope: 'project',
      entry: { description: 'Use when testing alpha.', version: '1.0.0' },
      install: { path: path.join(cwd, '.codex', 'skills', 'alpha-skill'), agent: 'codex' },
    },
  ];
}

test('creates a managed block and stays idempotent', () => {
  const { dir, cleanup } = tempDir();
  try {
    const ENTRIES = entriesFor(dir);
    const first = syncAgentsBlock(ENTRIES, { cwd: dir });
    assert.equal(first.changed, true);
    assert.equal(first.skills.length, 1);
    const content = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.match(content, /alpha-skill/);
    assert.match(content, /\.codex\/skills\/alpha-skill\/SKILL\.md/);
    const second = syncAgentsBlock(ENTRIES, { cwd: dir });
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), content);
  } finally {
    cleanup();
  }
});

test('preserves user content and replaces only the managed block', () => {
  const { dir, cleanup } = tempDir();
  try {
    const file = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(file, '# Team rules\n\nKeep this paragraph.\n');
    syncAgentsBlock(entriesFor(dir), { cwd: dir });
    syncAgentsBlock([], { cwd: dir });
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /Keep this paragraph\./);
    assert.match(content, /No project-scoped skills/);
    assert.equal((content.match(/skillrig:start/g) || []).length, 1);
  } finally {
    cleanup();
  }
});

test('check reports drift and sync status', () => {
  const { dir, cleanup } = tempDir();
  try {
    const ENTRIES = entriesFor(dir);
    assert.equal(checkAgentsBlock(ENTRIES, { cwd: dir }).exists, false);
    syncAgentsBlock(ENTRIES, { cwd: dir });
    assert.equal(checkAgentsBlock(ENTRIES, { cwd: dir }).synced, true);
    const changed = [{ ...ENTRIES[0], entry: { ...ENTRIES[0].entry, description: 'Changed.' } }];
    assert.equal(checkAgentsBlock(changed, { cwd: dir }).synced, false);
  } finally {
    cleanup();
  }
});

test('builds an explicit empty-state block', () => {
  const block = buildAgentsBlock([], { cwd: '/repo' });
  assert.match(block, /No project-scoped skills are installed/);
  assert.match(block, /skillrig sync/);
});

test('ignores global-scope installs', () => {
  const block = buildAgentsBlock([{ ...entriesFor('/repo')[0], scope: 'global' }], { cwd: '/repo' });
  assert.doesNotMatch(block, /alpha-skill/);
});
