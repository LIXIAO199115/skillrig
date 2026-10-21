import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBundled, buildBundle, loadBundle } from '../src/core/source.mjs';
import { readTarGz, writeTarGz, listArchive } from '../src/core/tar.mjs';
import { tempDir, fileMap } from './helpers.mjs';

test('builds and reloads a signed bundle without integrity drift', () => {
  const { dir, cleanup } = tempDir();
  try {
    const { skills } = loadBundled('git-recovery');
    const file = path.join(dir, 'git-recovery.skm');
    const bundle = buildBundle(skills, { name: 'git-recovery', version: '1.2.3', publisher: 'tests' });
    fs.writeFileSync(file, bundle.data);
    const loaded = loadBundle(file);
    assert.equal(loaded.skills.length, 1);
    assert.equal(loaded.skills[0].manifest.name, 'git-recovery');
    assert.equal(loaded.skills[0].integrity, skills[0].integrity);
    assert.equal(loaded.bundle.name, 'git-recovery');
    assert.equal(loaded.bundle.version, '1.2.3');
  } finally {
    cleanup();
  }
});

test('tar round-trip preserves binary data and paths', () => {
  const files = fileMap({ 'skills/a/SKILL.md': '# A', 'skills/a/assets/icon.bin': Buffer.from([0, 1, 2, 255]) });
  const buffer = writeTarGz(files);
  const restored = readTarGz(buffer, { stripTopLevel: false });
  assert.equal(restored.get('skills/a/SKILL.md').data.toString(), '# A');
  assert.deepEqual([...restored.get('skills/a/assets/icon.bin').data], [0, 1, 2, 255]);
  assert.deepEqual(listArchive(files).map((entry) => entry.name).sort(), ['skills/a/SKILL.md', 'skills/a/assets/icon.bin'].sort());
});

test('bundle rejects a tampered skill file', () => {
  const { dir, cleanup } = tempDir();
  try {
    const { skills } = loadBundled('git-recovery');
    const bundle = buildBundle(skills, { name: 'tampered', version: '1.0.0' });
    const files = readTarGz(bundle.data);
    const manifest = JSON.parse(files.get('skillrig-bundle.json').data.toString('utf8'));
    const skillPath = `${manifest.skills[0].path}/SKILL.md`;
    files.set(skillPath, { data: Buffer.from('# replaced'), mode: 0o644 });
    const tampered = writeTarGz(files);
    const file = path.join(dir, 'tampered.skm');
    fs.writeFileSync(file, tampered);
    assert.throws(() => loadBundle(file), /Integrity mismatch/i);
  } finally {
    cleanup();
  }
});
