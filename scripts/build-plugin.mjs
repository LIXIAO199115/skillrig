#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, packageInfo, readTreeFromDir, writeTree, safeRemoveDir } from '../src/core/util.mjs';

const pluginDir = path.join(PACKAGE_ROOT, 'plugins', 'skillrig');
const skillsTarget = path.join(pluginDir, 'skills');
const skillsSource = path.join(PACKAGE_ROOT, 'skills');
const check = process.argv.includes('--check');
const pkg = packageInfo();

const manifest = {
  name: 'skillrig',
  version: pkg.version,
  description:
    pkg.description ||
    'Signed, security-audited agent skills with a zero-dependency installer for Codex and every agent that reads SKILL.md.',
  author: { name: 'Li Xiaocheng', url: 'https://github.com/LIXIAO199115' },
  homepage: 'https://lixiao199115.github.io/skillrig/',
  repository: 'https://github.com/LIXIAO199115/skillrig',
  license: pkg.license || 'MIT',
  keywords: ['codex', 'agent-skills', 'skill-registry', 'security', 'mcp'],
  skills: './skills/',
  interface: {
    displayName: 'SkillRig',
    shortDescription: '18 audited skills for Codex, with a signed registry',
    longDescription:
      'SkillRig ships 18 engineering skills for Codex and other SKILL.md agents: CLI workflows, plugin authoring, security review, debugging, release engineering, API and database review. Every skill is quality-scored and security-scanned; the full catalog is Ed25519-signed.',
    developerName: 'SkillRig',
    category: 'Development',
    capabilities: ['Write', 'Review'],
    websiteURL: 'https://lixiao199115.github.io/skillrig/',
  },
};

function collectSkills() {
  const skills = new Map();
  for (const entry of fs.readdirSync(skillsSource, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(skillsSource, entry.name);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
    for (const [rel, file] of readTreeFromDir(dir).files) {
      skills.set(`${entry.name}/${rel}`, file);
    }
  }
  return skills;
}

function diffTrees(expected, actual) {
  const problems = [];
  for (const [name, file] of expected) {
    const current = actual.get(name);
    if (!current) problems.push(`missing ${name}`);
    else if (!(current.data ?? current).equals(file.data ?? file)) problems.push(`changed ${name}`);
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) problems.push(`stale ${name}`);
  }
  return problems;
}

const skills = collectSkills();
const manifestPath = path.join(pluginDir, '.codex-plugin', 'plugin.json');
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  const problems = [];
  if (!fs.existsSync(manifestPath)) problems.push('missing .codex-plugin/plugin.json');
  else if (fs.readFileSync(manifestPath, 'utf8') !== manifestText) problems.push('plugin.json is stale');
  let actual = new Map();
  if (fs.existsSync(skillsTarget)) {
    for (const entry of fs.readdirSync(skillsTarget, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const [rel, file] of readTreeFromDir(path.join(skillsTarget, entry.name)).files) {
        actual.set(`${entry.name}/${rel}`, file);
      }
    }
  }
  problems.push(...diffTrees(skills, actual));
  if (problems.length > 0) {
    console.error(`Plugin bundle is out of date (${problems.length} difference(s)):`);
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
    console.error('Run: npm run build:plugin');
    process.exit(1);
  }
  console.log(`Plugin bundle is in sync: ${skills.size} files, ${new Set([...skills.keys()].map((name) => name.split('/')[0])).size} skills.`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, manifestText);
if (fs.existsSync(skillsTarget)) safeRemoveDir(skillsTarget, pluginDir);
writeTree(skillsTarget, skills);
console.log(
  `Built plugins/skillrig: ${new Set([...skills.keys()].map((name) => name.split('/')[0])).size} skills, ${skills.size} files, v${manifest.version}.`,
);
