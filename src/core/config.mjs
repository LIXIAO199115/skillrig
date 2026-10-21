import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicWriteFile, ensureDir } from './util.mjs';
import { SkillRigError } from './errors.mjs';

export function skillrigHome() {
  return process.env.SKILLRIG_HOME || path.join(os.homedir(), '.skillrig');
}

export function configPath() {
  return path.join(skillrigHome(), 'config.json');
}

export const DEFAULT_CONFIG = {
  version: 1,
  defaultAgents: ['codex'],
  defaultScope: 'global',
  security: {
    failOn: 'high',
    allowRisky: false,
  },
  contextBudget: {
    warnAtTokens: 1500,
  },
};

export function readConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG, security: { ...DEFAULT_CONFIG.security } };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      security: { ...DEFAULT_CONFIG.security, ...(parsed.security || {}) },
      contextBudget: { ...DEFAULT_CONFIG.contextBudget, ...(parsed.contextBudget || {}) },
    };
  } catch (cause) {
    throw new SkillRigError(`Invalid config at ${file}: ${cause.message}`, { code: 'ERR_CONFIG' });
  }
}

export function writeConfig(patch) {
  const next = {
    ...readConfig(),
    ...patch,
    security: { ...readConfig().security, ...(patch.security || {}) },
    updatedAt: new Date().toISOString(),
  };
  ensureDir(skillrigHome());
  atomicWriteFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export function setConfigValue(key, value) {
  const config = readConfig();
  const parts = key.split('.');
  let target = config;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!target[parts[i]] || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
    target = target[parts[i]];
  }
  let parsed = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (/^-?\d+$/.test(value)) parsed = Number(value);
  else if (value.includes(',')) parsed = value.split(',').map((item) => item.trim()).filter(Boolean);
  target[parts.at(-1)] = parsed;
  ensureDir(skillrigHome());
  atomicWriteFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return { key, value: parsed };
}

export function cachePath() {
  return path.join(skillrigHome(), 'cache');
}

export function keysPath() {
  return path.join(skillrigHome(), 'keys');
}
