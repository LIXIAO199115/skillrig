import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicWriteFile, sha256, treeHash, readTreeFromDir, nowIso, packageInfo } from './util.mjs';
import { SkillRigError } from './errors.mjs';
import { skillrigHome } from './config.mjs';

export const LOCK_VERSION = 1;

export function lockPath(scope, { cwd = process.cwd(), home = os.homedir() } = {}) {
  if (scope === 'global') return path.join(skillrigHome(), 'lock.json');
  if (scope === 'project') return path.join(cwd, '.skillrig.lock.json');
  throw new SkillRigError(`Unknown lock scope: ${scope}`, { code: 'ERR_LOCK_SCOPE' });
}

export function emptyLock() {
  return {
    lockfileVersion: LOCK_VERSION,
    generatedBy: `skillrig@${packageInfo().version}`,
    skills: {},
  };
}

export function readLock(scope, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const file = lockPath(scope, { cwd, home });
  if (!fs.existsSync(file)) return emptyLock();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed.skills || typeof parsed.skills !== 'object') return emptyLock();
    return { ...emptyLock(), ...parsed };
  } catch (cause) {
    throw new SkillRigError(`Could not read lockfile ${file}: ${cause.message}`, { code: 'ERR_LOCK_CORRUPT' });
  }
}

export function writeLock(lock, scope, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const file = lockPath(scope, { cwd, home });
  const next = {
    ...lock,
    lockfileVersion: LOCK_VERSION,
    generatedBy: `skillrig@${packageInfo().version}`,
    updatedAt: nowIso(),
  };
  atomicWriteFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return { file, lock: next };
}

export function fileHashMap(files) {
  const result = {};
  for (const [name, file] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const data = file.data ?? file;
    result[name.replace(/\\/g, '/')] = sha256(data);
  }
  return result;
}

export function installRecord({ skill, agent, scope, targetPath, aliases = [] }) {
  return {
    agent,
    aliases,
    scope,
    path: path.resolve(targetPath),
    integrity: skill.integrity,
    files: fileHashMap(skill.files),
    installedAt: nowIso(),
  };
}

export function upsertSkill(lock, skill, installs, { entryId = null, security = null } = {}) {
  const existing = lock.skills[skill.manifest.name] || {};
  const byKey = new Map((existing.installs || []).map((install) => [`${install.agent}:${install.scope}`, install]));
  for (const install of installs) byKey.set(`${install.agent}:${install.scope}`, install);
  lock.skills[skill.manifest.name] = {
    name: skill.manifest.name,
    version: skill.manifest.version || existing.version || '0.0.0',
    source: skill.source,
    entryId: entryId || existing.entryId || null,
    integrity: skill.integrity,
    description: skill.manifest.description,
    installedAt: existing.installedAt || nowIso(),
    updatedAt: nowIso(),
    security: security || existing.security || null,
    installs: [...byKey.values()].filter(Boolean),
  };
  return lock.skills[skill.manifest.name];
}

export function removeInstallRecord(lock, name, { agent = null, scope = null } = {}) {
  const entry = lock.skills[name];
  if (!entry) return { removed: [], entry: null };
  const removed = [];
  entry.installs = (entry.installs || []).filter((install) => {
    if (agent && install.agent !== agent) return true;
    if (scope && install.scope !== scope) return true;
    removed.push(install);
    return false;
  });
  if (entry.installs.length === 0) delete lock.skills[name];
  return { removed, entry };
}

export function findInstalls(lock, name) {
  return lock.skills[name]?.installs || [];
}

export function allLockEntries({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const scopes = [];
  for (const scope of ['project', 'global']) {
    const lock = readLock(scope, { cwd, home });
    for (const [name, entry] of Object.entries(lock.skills)) {
      for (const install of entry.installs || []) {
        scopes.push({ name, entry, install, scope, lock });
      }
    }
  }
  return scopes;
}

export function verifyInstall(install) {
  const dir = install.path;
  if (!fs.existsSync(dir)) {
    return { status: 'missing', changed: [], missing: Object.keys(install.files || {}), extra: [] };
  }
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
    return { status: 'missing-skill-md', changed: [], missing: ['SKILL.md'], extra: [] };
  }
  const { files } = readTreeFromDir(dir);
  const current = fileHashMap(files);
  const expected = install.files || {};
  const changed = [];
  const missing = [];
  for (const [name, hash] of Object.entries(expected)) {
    if (!(name in current)) missing.push(name);
    else if (current[name] !== hash) changed.push(name);
  }
  const extra = Object.keys(current).filter((name) => !(name in expected));
  const hash = treeHash(files);
  return {
    status: changed.length || missing.length || extra.length ? 'modified' : 'ok',
    currentHash: hash,
    expectedHash: install.integrity,
    changed,
    missing,
    extra,
    files: current,
  };
}

export function pruneEmptyLock(lock) {
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (!entry.installs || entry.installs.length === 0) delete lock.skills[name];
  }
  return lock;
}

export function lockSummary({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const entries = allLockEntries({ cwd, home });
  return {
    skills: new Set(entries.map((item) => item.name)).size,
    installs: entries.length,
    agents: [...new Set(entries.map((item) => item.install.agent))].sort(),
    scopes: [...new Set(entries.map((item) => item.scope))].sort(),
  };
}
