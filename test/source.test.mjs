import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SKILL_FILES,
  discoverSkillDirsFromEntries,
  selectSkillEntries,
  selectSkillFiles,
} from '../src/core/source.mjs';
import { treeHash } from '../src/core/util.mjs';

function file(data) {
  return { data: Buffer.from(data), mode: 0o644 };
}

test('sparse selection skips nested skills, test fixtures, and vendor trees', () => {
  const files = new Map([
    ['skills/demo/SKILL.md', file('# Demo')],
    ['skills/demo/reference/guide.md', file('guide')],
    ['skills/demo/nested/SKILL.md', file('# Nested')],
    ['skills/demo/tests/fixture.js', file('test')],
    ['skills/demo/vendor/library.js', file('vendor')],
    ['skills/demo/scripts/run.sh', file('#!/bin/sh')],
  ]);
  const selected = selectSkillFiles(files, 'skills/demo');
  assert.deepEqual([...selected.keys()].sort(), ['SKILL.md', 'reference/guide.md', 'scripts/run.sh']);
});

test('sparse entry selection matches the downloaded file tree hash', () => {
  const files = new Map([
    ['pkg/one/SKILL.md', file('---\nname: one\ndescription: demo\n---\nBody')],
    ['pkg/one/data.txt', file('hello')],
  ]);
  const entries = [...files].map(([path, value]) => ({
    path,
    sha: path,
    size: value.data.length,
    mode: '100644',
  }));
  const selected = selectSkillEntries(entries, 'pkg/one');
  assert.deepEqual(
    selected.map((entry) => entry.rel).sort(),
    ['SKILL.md', 'data.txt'],
  );
  const downloaded = new Map(selected.map((entry) => [entry.rel, files.get(entry.path)]));
  assert.equal(treeHash(downloaded), treeHash(selectSkillFiles(files, 'pkg/one')));
});

test('sparse selection enforces the same file count cap as the crawler', () => {
  const files = new Map([['demo/SKILL.md', file('# Demo')]]);
  for (let index = 0; index < MAX_SKILL_FILES + 10; index += 1) {
    files.set(`demo/files/${String(index).padStart(3, '0')}.txt`, file(String(index)));
  }
  assert.equal(selectSkillFiles(files, 'demo').size, MAX_SKILL_FILES);
});

test('sparse discovery finds root and nested skills but ignores tooling trees', () => {
  const entries = [
    { path: 'SKILL.md' },
    { path: 'skills/one/SKILL.md' },
    { path: 'skills/two/SKILL.md' },
    { path: 'skills/two/tests/fixture/SKILL.md' },
    { path: '.github/skills/ci/SKILL.md' },
  ];
  assert.deepEqual(discoverSkillDirsFromEntries(entries), ['.', '.github/skills/ci', 'skills/one', 'skills/two']);
});
