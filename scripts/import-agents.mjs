#!/usr/bin/env node
// One-off importer for the public agent-path table.
// Usage: node scripts/import-agents.mjs <agents.md> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/import-agents.mjs <agents.md> <out.json>');
  process.exit(2);
}

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const agents = new Map();

for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 4) continue;
  if (cells[1].startsWith('---') || cells[0] === 'Agent') continue;

  const ids = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  if (ids.length === 0) continue;
  const names = cells[0].split(',').map((n) => n.trim());
  const projectPath = (cells[2].match(/`([^`]+)`/) || [])[1];
  const globalPath = (cells[3].match(/`([^`]+)`/) || [])[1];
  if (!projectPath) continue;

  for (const id of ids) {
    agents.set(id, {
      id,
      name: names.length === ids.length ? names[ids.indexOf(id)] : cells[0],
      projectPath,
      globalPath: globalPath || null,
      docs: null,
    });
  }
}

const docs = {
  'claude-code': 'https://code.claude.com/docs/en/skills',
  codex: 'https://developers.openai.com/codex/skills',
  cursor: 'https://cursor.com/docs/context/skills',
  'gemini-cli': 'https://geminicli.com/docs/cli/skills/',
  opencode: 'https://opencode.ai/docs/skills',
  'github-copilot': 'https://docs.github.com/en/copilot/concepts/agents/about-agent-skills',
  windsurf: 'https://docs.windsurf.com/windsurf/cascade/skills',
  cline: 'https://docs.cline.bot/features/skills',
  amp: 'https://ampcode.com/manual#agent-skills',
  qwen: 'https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/',
  'qwen-code': 'https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/',
  qoder: 'https://docs.qoder.com/cli/Skills',
  'qoder-cn': 'https://docs.qoder.com/cli/Skills',
  trae: 'https://docs.trae.ai/ide/skills',
  'kiro-cli': 'https://kiro.dev/docs/cli/custom-agents/configuration-reference/#skill-resources',
  openhands: 'https://docs.openhands.ai/modules/usage/how-to/using-skills',
  goose: 'https://block.github.io/goose/docs/guides/context-engineering/using-skills',
};

for (const agent of agents.values()) agent.docs = docs[agent.id] || null;

const result = {
  $comment:
    'Agent skill directories. Paths follow the public Agent Skills ecosystem table (vercel-labs/skills docs/agents.md, MIT) and each vendor docs. Global paths start with ~.',
  generatedAt: new Date().toISOString(),
  agents: [...agents.values()].sort((a, b) => a.id.localeCompare(b.id)),
};

writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${result.agents.length} agents to ${output}`);
