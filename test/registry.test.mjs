import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateSigningKeyPair,
  signRegistry,
  verifyRegistry,
  keyIdFor,
  registryIndexEntry,
  searchSkills,
  recommendSkills,
  registryStats,
} from '../src/core/registry.mjs';
import { tempDir } from './helpers.mjs';

function writeIndex(dir, skills = [{ name: 'alpha-skill', description: 'Use when testing search.' }]) {
  const indexPath = path.join(dir, 'index.json');
  fs.writeFileSync(
    indexPath,
    JSON.stringify({ schemaVersion: 1, name: 'test', generatedAt: '2026-01-01T00:00:00.000Z', skills, packs: [] }, null, 2),
  );
  return indexPath;
}

test('signs and verifies a registry with ed25519', () => {
  const { dir, cleanup } = tempDir();
  try {
    const { publicKey, privateKey, keyId } = generateSigningKeyPair();
    const publicPath = path.join(dir, 'skillrig.pub.pem');
    fs.writeFileSync(publicPath, publicKey);
    const indexPath = writeIndex(dir);
    const signaturePath = `${indexPath}.sig`;
    const record = signRegistry({ indexPath, signaturePath, privateKey });
    assert.equal(record.algorithm, 'ed25519');
    assert.equal(record.keyId, keyId);
    const result = verifyRegistry({ indexPath, signaturePath, publicKeyPath: publicPath });
    assert.equal(result.verified, true);
    assert.equal(result.keyId, keyId);
    assert.equal(result.index.skills[0].name, 'alpha-skill');
    assert.equal(keyIdFor(publicKey), keyId);
  } finally {
    cleanup();
  }
});

test('rejects a tampered registry', () => {
  const { dir, cleanup } = tempDir();
  try {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const publicPath = path.join(dir, 'skillrig.pub.pem');
    fs.writeFileSync(publicPath, publicKey);
    const indexPath = writeIndex(dir);
    const signaturePath = `${indexPath}.sig`;
    signRegistry({ indexPath, signaturePath, privateKey });
    fs.appendFileSync(indexPath, '\n');
    assert.throws(() => verifyRegistry({ indexPath, signaturePath, publicKeyPath: publicPath }), /digest|signature/i);
  } finally {
    cleanup();
  }
});

test('requires a signature when asked', () => {
  const { dir, cleanup } = tempDir();
  try {
    const { publicKey } = generateSigningKeyPair();
    const publicPath = path.join(dir, 'skillrig.pub.pem');
    fs.writeFileSync(publicPath, publicKey);
    const indexPath = writeIndex(dir);
    assert.throws(() => verifyRegistry({ indexPath, signaturePath: `${indexPath}.sig`, publicKeyPath: publicPath }), /signature missing/i);
  } finally {
    cleanup();
  }
});

test('registry entries carry trust, license status and blocked flags', () => {
  const entry = registryIndexEntry({
    manifest: { name: 'demo-skill', description: 'Use when testing.', license: 'MIT' },
    treeHash: 'sha256:abc',
    source: { type: 'bundled', repo: 'skillrig', path: 'skills/demo-skill', branch: 'main' },
    quality: { score: 100, grade: 'A+' },
    security: { score: 100, grade: 'A+', counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
    verified: true,
    bodyBytes: 100,
    bodyLines: 10,
    files: 2,
    trust: 'official',
    licenseStatus: 'permissive',
    blocked: false,
  });
  assert.equal(entry.trust, 'official');
  assert.equal(entry.licenseStatus, 'permissive');
  assert.equal(entry.blocked, false);
  assert.equal(entry.source.branch, 'main');
});

test('search matches names, tags and descriptions', () => {
  const index = {
    skills: [
      { name: 'api-review', description: 'Review HTTP contracts', quality: { score: 90 }, tags: ['api'], categories: [], verified: true },
      { name: 'sql-review', description: 'Review migrations', quality: { score: 80 }, tags: ['sql'], categories: [], verified: false },
      { name: 'docs', description: 'Write documentation', quality: { score: 70 }, tags: [], categories: [], verified: false },
    ],
  };
  assert.deepEqual(searchSkills(index, 'review').map((skill) => skill.name).sort(), ['api-review', 'sql-review']);
  assert.deepEqual(searchSkills(index, 'migrations').map((skill) => skill.name), ['sql-review']);
  assert.equal(searchSkills(index, 'missing').length, 0);
  assert.equal(searchSkills(index, '').length, 3);
});

test('recommend ranks task matches and hides blocked entries', () => {
  const index = {
    skills: [
      { name: 'pr-reviewer', description: 'Review pull requests for security issues', tags: ['review'], categories: ['development'], quality: { score: 100 }, verified: true, blocked: false },
      { name: 'docker-help', description: 'Build Docker images', tags: ['docker'], categories: ['devops'], quality: { score: 80 }, verified: false, blocked: false },
      { name: 'risky-review', description: 'Review pull requests', tags: ['review'], categories: ['development'], quality: { score: 100 }, verified: false, blocked: true },
    ],
  };
  const picks = recommendSkills(index, 'review pull request security', { limit: 2 });
  assert.equal(picks[0].name, 'pr-reviewer');
  assert.ok(picks.every((skill) => skill.name !== 'risky-review'));
  assert.ok(picks[0]._score > 0);
  assert.equal(recommendSkills(index, 'review', { limit: 3, includeBlocked: true }).length, 2);

  const chinese = recommendSkills(
    { skills: [{ name: '财报分析', description: '分析财务报表与现金流', tags: [], categories: [], quality: { score: 90 }, blocked: false }] },
    '财务报表',
    { limit: 1 },
  );
  assert.equal(chinese[0].name, '财报分析');
});

test('registryStats reports composition and blocked counts', () => {
  const index = {
    sources: [{ repo: 'one' }, { repo: 'two' }],
    skills: [
      { name: 'ok', blocked: false, verified: true, categories: ['a'], source: { repo: 'skillrig' }, quality: { score: 100, grade: 'A+' }, security: { badge: 'clean' }, trust: 'official' },
      { name: 'blocked', blocked: true, verified: false, categories: ['a'], source: { repo: 'one' }, quality: { score: 50, grade: 'C' }, security: { badge: 'critical' }, trust: 'community' },
    ],
    packs: [],
  };
  const stats = registryStats(index);
  assert.equal(stats.skills, 2);
  assert.equal(stats.sources, 2);
  assert.equal(stats.installable, 1);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.bySecurity.find((row) => row.name === 'critical').count, 1);
});
