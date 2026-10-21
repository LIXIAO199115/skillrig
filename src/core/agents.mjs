import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { UsageError } from './errors.mjs';
import { expandHome, splitCommaList } from './util.mjs';

const DATA = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../data/agents.json', import.meta.url)), 'utf8'),
);

const OVERRIDES = {
  codex: {
    projectPath: '.codex/skills/',
    globalPath: '~/.codex/skills/',
    alternateProjectPaths: ['.agents/skills/'],
    alternateGlobalPaths: ['~/.agents/skills/'],
    bins: ['codex'],
  },
  agents: {
    id: 'agents',
    name: 'Universal (.agents)',
    projectPath: '.agents/skills/',
    globalPath: '~/.agents/skills/',
    docs: 'https://agentskills.io',
    bins: [],
  },
  'claude-code': { bins: ['claude'] },
  cursor: { bins: ['cursor', 'cursor-agent'] },
  'gemini-cli': { bins: ['gemini'] },
  'github-copilot': { bins: ['copilot'] },
  opencode: { bins: ['opencode'] },
  windsurf: { bins: ['windsurf'] },
  'qwen-code': { bins: ['qwen'] },
  qoder: { bins: ['qoder'] },
  'qoder-cn': { bins: ['qoder'] },
  'kimi-code-cli': { bins: ['kimi'] },
  amp: { bins: ['amp'] },
  goose: { bins: ['goose'] },
  openhands: { bins: ['openhands'] },
  'kiro-cli': { bins: ['kiro'] },
  trae: { bins: ['trae'] },
};

export const ALIASES = {
  claude: 'claude-code',
  'claude-code-cli': 'claude-code',
  copilot: 'github-copilot',
  gemini: 'gemini-cli',
  codexcli: 'codex',
  'codex-cli': 'codex',
  qwen: 'qwen-code',
  universal: 'agents',
  all: 'all',
};

function mergedAgents() {
  const map = new Map();
  for (const agent of DATA.agents) map.set(agent.id, { ...agent, ...(OVERRIDES[agent.id] || {}) });
  for (const [id, override] of Object.entries(OVERRIDES)) {
    if (!map.has(id)) map.set(id, { ...override, id });
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const AGENTS = mergedAgents();
const BY_ID = new Map(AGENTS.map((agent) => [agent.id, agent]));

export function listAgents() {
  return AGENTS;
}

export function normalizeAgentId(value) {
  const id = String(value).trim().toLowerCase();
  return ALIASES[id] || id;
}

export function getAgent(id) {
  const normalized = normalizeAgentId(id);
  const agent = BY_ID.get(normalized);
  if (!agent) {
    throw new UsageError(
      `Unknown agent "${id}". Run "skillrig targets" to see all ${AGENTS.length} supported agents.`,
    );
  }
  return agent;
}

export function agentSkillDir(agentId, scope, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const agent = getAgent(agentId);
  const template = scope === 'global' ? agent.globalPath : agent.projectPath;
  if (!template) {
    throw new UsageError(`${agent.name} does not support ${scope} installs.`);
  }
  const expanded = expandHome(template, home);
  return {
    agent,
    dir: path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(cwd, expanded),
  };
}

export function alternateDirs(agentId, scope, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const agent = getAgent(agentId);
  const list = scope === 'global' ? agent.alternateGlobalPaths : agent.alternateProjectPaths;
  return (list || []).map((template) => {
    const expanded = expandHome(template, home);
    return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(cwd, expanded);
  });
}

function commandExists(command, pathValue = process.env.PATH || '') {
  if (!command) return false;
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
}

export function detectAgents({ cwd = process.cwd(), home = os.homedir(), includeBins = true } = {}) {
  const detected = [];
  for (const agent of AGENTS) {
    if (agent.id === 'agents') continue;
    const evidence = [];
    const dirs = [];
    if (agent.globalPath) dirs.push(expandHome(agent.globalPath, home));
    for (const alt of agent.alternateGlobalPaths || []) dirs.push(expandHome(alt, home));
    if (agent.projectPath) dirs.push(path.resolve(cwd, expandHome(agent.projectPath, home)));
    for (const alt of agent.alternateProjectPaths || []) dirs.push(path.resolve(cwd, expandHome(alt, home)));
    for (const dir of new Set(dirs)) {
      if (fs.existsSync(dir)) evidence.push(dir);
    }
    if (includeBins) {
      for (const bin of agent.bins || []) {
        if (commandExists(bin)) evidence.push(`bin:${bin}`);
      }
    }
    if (evidence.length > 0) detected.push({ ...agent, evidence });
  }
  return detected;
}

export function resolveAgentSelection(value, { cwd = process.cwd(), home = os.homedir(), scope = 'global' } = {}) {
  const raw = splitCommaList(value);
  if (raw.length === 0 || raw.includes('auto')) {
    const detected = detectAgents({ cwd, home });
    const installed = detected.filter((agent) => agent.id !== 'agents');
    if (installed.length === 0) return ['codex'];
    return installed.map((agent) => agent.id);
  }
  if (raw.includes('all')) return AGENTS.filter((agent) => agent.id !== 'agents').map((agent) => agent.id);
  const ids = raw.map(normalizeAgentId);
  for (const id of ids) getAgent(id);
  return [...new Set(ids)];
}

export function allManagedRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const roots = [];
  for (const agent of AGENTS) {
    for (const scope of ['project', 'global']) {
      try {
        const { dir } = agentSkillDir(agent.id, scope, { cwd, home });
        roots.push({ agent: agent.id, scope, dir });
      } catch {
        // agent does not support this scope
      }
    }
  }
  return roots;
}

export function suggestAgentIds(fragment) {
  const needle = String(fragment).toLowerCase();
  return AGENTS.filter((agent) => agent.id.includes(needle) || agent.name.toLowerCase().includes(needle))
    .slice(0, 6)
    .map((agent) => agent.id);
}

export function agentCount() {
  return AGENTS.length;
}
