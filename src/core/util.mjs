import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SkillRigError } from './errors.mjs';

export const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

let cachedPackage;
export function packageInfo() {
  if (!cachedPackage) {
    cachedPackage = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  }
  return cachedPackage;
}

export function supportsColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function paint(code, value) {
  return supportsColor() ? `\u001b[${code}m${value}\u001b[0m` : String(value);
}

export const c = {
  bold: (v) => paint('1', v),
  dim: (v) => paint('2', v),
  red: (v) => paint('31', v),
  green: (v) => paint('32', v),
  yellow: (v) => paint('33', v),
  blue: (v) => paint('34', v),
  magenta: (v) => paint('35', v),
  cyan: (v) => paint('36', v),
  white: (v) => paint('37', v),
  gray: (v) => paint('90', v),
  bgRed: (v) => paint('41;97', v),
  bgYellow: (v) => paint('43;30', v),
  bgGreen: (v) => paint('42;30', v),
  bgBlue: (v) => paint('44;97', v),
};

const ANSI_RE = /\u001b\[[0-9;]*m/g;
export function stripAnsi(value) {
  return String(value).replace(ANSI_RE, '');
}

function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(value) {
  let width = 0;
  for (const ch of stripAnsi(value)) width += charWidth(ch.codePointAt(0));
  return width;
}

export function pad(value, width, align = 'left') {
  const text = String(value);
  const gap = Math.max(0, width - displayWidth(text));
  return align === 'right' ? ' '.repeat(gap) + text : text + ' '.repeat(gap);
}

export function truncate(value, max, ellipsis = '…') {
  const text = String(value);
  if (displayWidth(text) <= max) return text;
  let out = '';
  let width = 0;
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0));
    if (width + w > max - 1) break;
    out += ch;
    width += w;
  }
  return out + ellipsis;
}

export function renderTable(rows, headers, { align = [] } = {}) {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((row) => displayWidth(row[i] ?? ''))),
  );
  const line = (cells, bold = false) =>
    cells
      .map((cell, i) => {
        const text = pad(truncate(cell ?? '', widths[i]), widths[i], align[i] || 'left');
        return bold ? c.bold(text) : text;
      })
      .join('  ')
      .trimEnd();
  return [line(headers, true), ...rows.map((row) => line(row))].join('\n');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function fileHash(data) {
  return sha256(Buffer.isBuffer(data) ? data : Buffer.from(data));
}

export function treeHash(files) {
  const entries = [...files.entries()]
    .map(([name, file]) => [name.replace(/\\/g, '/'), fileHash(file.data ?? file)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return `sha256:${sha256(entries.map(([name, hash]) => `${name}\0${hash}\n`).join(''))}`;
}

export function isSubPath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  if (!isSubPath(base, target)) {
    throw new SkillRigError(`Unsafe path escapes target directory: ${rel}`, {
      code: 'ERR_UNSAFE_PATH',
    });
  }
  return target;
}

export function assertSafeRelPath(rel) {
  const normalized = String(rel).replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new SkillRigError(`Unsafe relative path: ${rel}`, { code: 'ERR_UNSAFE_PATH' });
  }
  return normalized;
}

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '.idea', '.vscode']);
const IGNORED_SUFFIXES = ['.pyc', '.pyo', '.log', '.tmp'];
const SKILL_META_FILES = new Set(['.skillrig.json', '.skill-lock.json']);

export function readTreeFromDir(dir, { maxFileSize = 4 * 1024 * 1024, maxTotalSize = 48 * 1024 * 1024 } = {}) {
  const files = new Map();
  const warnings = [];
  let total = 0;

  function walk(current, prefix = '') {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (IGNORED_NAMES.has(entry.name) || SKILL_META_FILES.has(entry.name)) continue;
      if (IGNORED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink: ${rel}`);
        continue;
      }
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(full);
      if (stat.size > maxFileSize) {
        warnings.push(`Skipped large file (${formatBytes(stat.size)}): ${rel}`);
        continue;
      }
      if (total + stat.size > maxTotalSize) {
        warnings.push(`Skipped file because skill exceeds ${formatBytes(maxTotalSize)}: ${rel}`);
        continue;
      }
      total += stat.size;
      files.set(rel, { data: fs.readFileSync(full), mode: stat.mode & 0o777 });
    }
  }

  walk(dir);
  return { files, warnings };
}

export function writeTree(dir, files) {
  for (const [rel, file] of files) {
    const safeRel = assertSafeRelPath(rel);
    const target = safeJoin(dir, safeRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const mode = file.mode ? file.mode & 0o777 : 0o644;
    fs.writeFileSync(target, file.data, { mode });
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(target, mode);
      } catch {
        // Best effort on filesystems that do not support POSIX modes.
      }
    }
  }
}

export function isBinary(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

export function oneLine(value, max = 160) {
  return truncate(String(value ?? '').replace(/\s+/g, ' ').trim(), max);
}

export function nowIso() {
  return new Date().toISOString();
}

export function expandHome(input, home = os.homedir()) {
  if (!input) return input;
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(home, input.slice(2));
  return input;
}

export function displayPath(target, { home = os.homedir(), cwd = process.cwd() } = {}) {
  const absolute = path.resolve(target);
  if (isSubPath(home, absolute) && absolute !== home) {
    return `~/${path.relative(home, absolute).replace(/\\/g, '/')}`;
  }
  if (isSubPath(cwd, absolute) && absolute !== cwd) {
    return `./${path.relative(cwd, absolute).replace(/\\/g, '/')}`;
  }
  return absolute.replace(/\\/g, '/');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function atomicWriteFile(target, data, { mode = 0o644 } = {}) {
  ensureDir(path.dirname(target));
  const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, data, { mode });
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    if (process.platform === 'win32' && fs.existsSync(target)) {
      fs.unlinkSync(target);
      fs.renameSync(temp, target);
    } else {
      try {
        fs.unlinkSync(temp);
      } catch {
        // ignored
      }
      throw error;
    }
  }
}

export function safeRemoveDir(target, allowedBase) {
  if (!isSubPath(allowedBase, target) || path.resolve(target) === path.resolve(allowedBase)) {
    throw new SkillRigError(`Refusing to remove directory outside managed root: ${target}`, {
      code: 'ERR_UNSAFE_REMOVE',
    });
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
}

export function randomId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export function isCI() {
  return Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
}

export function splitCommaList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => splitCommaList(item));
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function confirm(question, { defaultYes = false } = {}) {
  if (!process.stdin.isTTY) return defaultYes;
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    const answer = (await rl.question(question + suffix)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
