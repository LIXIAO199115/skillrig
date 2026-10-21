import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile, displayPath, ensureDir, oneLine } from './util.mjs';

export const AGENTS_START = '<!-- skillrig:start -->';
export const AGENTS_END = '<!-- skillrig:end -->';
export const DEFAULT_AGENTS_FILE = 'AGENTS.md';

function escapeCell(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function projectSkillEntries(entries, { cwd = process.cwd() } = {}) {
  const seen = new Map();
  for (const item of entries) {
    if (item.scope !== 'project') continue;
    if (seen.has(item.name)) continue;
    let location = item.install.path;
    const relative = path.relative(cwd, location);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      location = relative.split(path.sep).join('/');
    }
    seen.set(item.name, {
      name: item.name,
      description: oneLine(item.entry.description || '', 160),
      location,
      version: item.entry.version || null,
      agent: item.install.agent,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildAgentsBlock(entries, { cwd = process.cwd() } = {}) {
  const skills = projectSkillEntries(entries, { cwd });
  const lines = [AGENTS_START, '## Skills', ''];
  if (skills.length === 0) {
    lines.push('No project-scoped skills are installed. Add one with `skillrig install <skill> --scope project`.');
  } else {
    lines.push(
      'This repository ships agent skills. Read the matching `SKILL.md` before starting a task that fits its description. Skill files are the source of truth; do not paraphrase or partially apply them.',
      '',
      '| Skill | Use it when | File |',
      '| --- | --- | --- |',
    );
    for (const skill of skills) {
      lines.push(`| \`${skill.name}\` | ${escapeCell(skill.description)} | \`${skill.location}/SKILL.md\` |`);
    }
  }
  lines.push('', 'Managed by [SkillRig](https://github.com/LIXIAO199115/skillrig). Run `skillrig sync` after install or remove.', AGENTS_END);
  return lines.join('\n');
}

export function replaceAgentsBlock(content, block) {
  const start = content.indexOf(AGENTS_START);
  const end = content.indexOf(AGENTS_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = content.slice(0, start);
    const after = content.slice(end + AGENTS_END.length);
    return `${before}${block}${after}`;
  }
  if (start !== -1 || end !== -1) {
    const clean = content
      .split('\n')
      .filter((line) => !line.includes(AGENTS_START) && !line.includes(AGENTS_END))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
    return `${clean}${clean ? '\n\n' : ''}${block}\n`;
  }
  const trimmed = content.replace(/\s+$/, '');
  return `${trimmed}${trimmed ? '\n\n' : ''}${block}\n`;
}

export function syncAgentsBlock(entries, { cwd = process.cwd(), file = DEFAULT_AGENTS_FILE } = {}) {
  const target = path.resolve(cwd, file);
  const exists = fs.existsSync(target);
  const original = exists ? fs.readFileSync(target, 'utf8') : '';
  const block = buildAgentsBlock(entries, { cwd });
  const next = replaceAgentsBlock(original, block);
  const changed = next !== original;
  if (changed) {
    ensureDir(path.dirname(target));
    atomicWriteFile(target, next);
  }
  return {
    file: target,
    displayPath: displayPath(target, { cwd }),
    exists,
    created: !exists,
    changed,
    skills: projectSkillEntries(entries, { cwd }),
  };
}

export function checkAgentsBlock(entries, { cwd = process.cwd(), file = DEFAULT_AGENTS_FILE } = {}) {
  const target = path.resolve(cwd, file);
  const exists = fs.existsSync(target);
  const content = exists ? fs.readFileSync(target, 'utf8') : '';
  const hasBlock = content.includes(AGENTS_START) && content.includes(AGENTS_END);
  const block = buildAgentsBlock(entries, { cwd });
  const current = hasBlock
    ? content.slice(content.indexOf(AGENTS_START), content.indexOf(AGENTS_END) + AGENTS_END.length)
    : '';
  return {
    exists,
    hasBlock,
    synced: hasBlock && current.trim() === block.trim(),
    file: target,
    displayPath: displayPath(target, { cwd }),
    block,
    current,
    skills: projectSkillEntries(entries, { cwd }),
  };
}
