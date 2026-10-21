#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT } from '../src/core/util.mjs';

const ROOT = PACKAGE_ROOT;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'site/data.js']);

let checks = 0;
let warnings = 0;
const errors = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings += 1;
  console.log(`warn  ${message}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

const files = walk(ROOT);

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/* 1. JavaScript syntax */

for (const file of files) {
  const rel = relative(file);
  if (SKIP_DIRS.has(rel)) continue;
  if (!/\.(?:mjs|js)$/.test(file)) continue;
  checks += 1;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    fail(`${rel}: syntax error\n${(result.stderr || '').trim()}`);
  }
}

/* 2. JSON parses */

const jsonFiles = files.filter((file) => /\.json$/.test(file) && relative(file) !== 'site/data.js');
for (const file of jsonFiles) {
  checks += 1;
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${relative(file)}: invalid JSON — ${error.message}`);
  }
}

/* 3. Curated skills: folder contract */

const skillsDir = path.join(ROOT, 'skills');
const names = new Map();
for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  checks += 1;
  const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    fail(`skills/${entry.name}: missing SKILL.md`);
    continue;
  }
  const raw = fs.readFileSync(skillFile, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    fail(`skills/${entry.name}: missing frontmatter block`);
    continue;
  }
  const nameLine = match[1].match(/^name:\s*(.+)$/m);
  if (!nameLine) {
    fail(`skills/${entry.name}: frontmatter has no name`);
    continue;
  }
  const name = nameLine[1].trim().replace(/^["']|["']$/g, '');
  if (name !== entry.name) {
    fail(`skills/${entry.name}: folder name does not match manifest name "${name}"`);
  }
  if (names.has(name)) fail(`duplicate curated skill name "${name}" in ${names.get(name)} and skills/${entry.name}`);
  names.set(name, `skills/${entry.name}`);
}

/* 4. Local asset references in the site */

const siteIndex = path.join(ROOT, 'site', 'index.html');
if (!fs.existsSync(siteIndex)) {
  fail('site/index.html is missing');
} else {
  const html = fs.readFileSync(siteIndex, 'utf8');
  const refs = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|mailto:|#|data:|\/)/.test(ref)) continue;
    refs.add(ref.split('#')[0].split('?')[0]);
  }
  for (const ref of refs) {
    checks += 1;
    const target = path.join(ROOT, 'site', ref);
    if (!fs.existsSync(target)) {
      if (ref === 'data.js') warn('site/data.js is generated; run npm run build:site before deploying');
      else fail(`site/index.html references missing site/${ref}`);
    }
  }
}

/* 5. Relative Markdown links */

const markdown = [
  'README.md',
  'README.zh-CN.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'CHANGELOG.md',
  ...files
    .filter((file) => path.dirname(file) === path.join(ROOT, 'docs') && file.endsWith('.md'))
    .map(relative),
];

for (const rel of markdown) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1];
    if (/^(?:https?:|mailto:|#|data:|\/)/i.test(target)) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    checks += 1;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) fail(`${rel}: link target does not exist — ${target}`);
  }
}

/* Report */

console.log(`\nLint: ${checks} checks, ${errors.length} error(s), ${warnings} warning(s).`);
for (const error of errors) console.log(`error ${error}`);
if (errors.length === 0) console.log('Lint passed.');
process.exitCode = errors.length > 0 ? 1 : 0;
