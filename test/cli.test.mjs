import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'skillrig.mjs');

function run(args, { cwd = ROOT, env = {} } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', SKILLRIG_HOME: env.SKILLRIG_HOME || path.join(cwd, '.skillrig-home'), ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test('help lists the command surface', () => {
  const { code, stdout } = run(['--help']);
  assert.equal(code, 0);
  for (const command of ['search', 'install', 'scan', 'verify', 'mcp', 'pack', 'publish']) {
    assert.match(stdout, new RegExp(`\\b${command}\\b`));
  }
});

test('search returns signed registry results as JSON', () => {
  const { code, stdout, stderr } = run(['search', 'review', '--json', '--limit', '5']);
  assert.equal(code, 0, stderr);
  const payload = JSON.parse(stdout);
  assert.ok(payload.count > 0);
  assert.ok(payload.skills.every((skill) => typeof skill.name === 'string'));
  assert.ok(payload.skills.some((skill) => skill.name === 'api-contract-review'));
});

test('registry verification passes for the bundled index', () => {
  const { code, stdout } = run(['verify']);
  assert.equal(code, 0);
  assert.match(stdout, /registry verified/);
  assert.match(stdout, /skills/);
});

test('scan reports curated skills as clean', () => {
  const { code, stdout, stderr } = run(['scan', 'skills/api-contract-review', '--json']);
  assert.equal(code, 0, stderr);
  const payload = JSON.parse(stdout);
  const scan = payload.skills[0];
  assert.equal(scan.name, 'api-contract-review');
  assert.ok((scan.quality?.score ?? 0) >= 90);
  assert.equal(scan.security.counts.critical, 0);
  assert.equal(scan.security.counts.high, 0);
});

test('search filters blocked entries are not installed by default', () => {
  const { code, stdout } = run(['info', 'render-deploy', '--json']);
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.skill.blocked, true);
  assert.equal(payload.skill.security.badge, 'critical');
});

test('init scaffolds a valid skill and config round-trips', () => {
  const { dir, cleanup } = tempDir();
  try {
    const home = path.join(dir, 'home');
    const init = run(
      ['init', 'demo-skill', '--description', 'Use when checking that the initializer writes a complete skill.', '--cwd', dir],
      { cwd: dir, env: { SKILLRIG_HOME: home } },
    );
    assert.equal(init.code, 0, init.stderr);
    const skillFile = path.join(dir, 'skills', 'demo-skill', 'SKILL.md');
    assert.ok(fs.existsSync(skillFile));
    const scan = run(['scan', skillFile, '--json'], { cwd: dir, env: { SKILLRIG_HOME: home } });
    assert.equal(scan.code, 0, scan.stderr);
    const payload = JSON.parse(scan.stdout);
    const result = payload.skills[0];
    assert.ok(result.quality.score >= 60);

    const set = run(['config', 'set', 'security.failOn', 'medium'], { cwd: dir, env: { SKILLRIG_HOME: home } });
    assert.equal(set.code, 0, set.stderr);
    const get = run(['config', 'get', 'security.failOn', '--json'], { cwd: dir, env: { SKILLRIG_HOME: home } });
    assert.equal(get.code, 0, get.stderr);
    assert.equal(JSON.parse(get.stdout).value, 'medium');
  } finally {
    cleanup();
  }
});

test('unknown commands exit with usage status', () => {
  const { code, stderr } = run(['nope']);
  assert.equal(code, 2);
  assert.match(stderr, /Unknown command/);
});

test('completion prints scripts for supported shells', () => {
  for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
    const { code, stdout } = run(['completion', shell]);
    assert.equal(code, 0);
    assert.ok(stdout.length > 100, shell);
  }
});
