import os from 'node:os';
import readline from 'node:readline';
import { loadRegistry, searchSkills, getSkill } from './registry.mjs';
import { loadSpec } from './source.mjs';
import {
  installSkills,
  uninstallSkills,
  listInstalled,
  auditInstalled,
  contextBudget,
  doctorReport,
} from './installer.mjs';
import { scanFiles, riskSummary, toSarif } from './security.mjs';
import { allLockEntries } from './lockfile.mjs';
import { syncAgentsBlock } from './agentsmd.mjs';
import { packageInfo } from './util.mjs';

export const SERVER_NAME = 'skillrig';
export const PROTOCOL_VERSION = '2025-06-18';

const scopeSchema = { type: 'string', enum: ['global', 'project'], description: 'Install scope. Defaults to global.' };
const agentsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'Agent ids such as codex, claude-code, cursor. Defaults to Codex.',
};

export const TOOLS = [
  {
    name: 'skillrig_search',
    title: 'Search skills',
    description: 'Search the signed SkillRig registry for agent skills by intent, category, agent, or quality grade.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language or keyword query.' },
        category: { type: 'string' },
        agent: { type: 'string', description: 'Only return skills compatible with this agent id.' },
        grade: { type: 'string', description: 'Minimum quality grade: A+, A, B, C, D.' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'skillrig_info',
    title: 'Skill details',
    description: 'Show the full registry entry for one skill: description, source, version, integrity, score and audit status.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'skillrig_install',
    title: 'Install skills',
    description:
      'Install one or more skills into an agent skill directory with security scanning, integrity pinning and rollback. Use dryRun to preview.',
    inputSchema: {
      type: 'object',
      properties: {
        skills: { type: 'array', items: { type: 'string' }, minItems: 1 },
        agents: agentsSchema,
        scope: scopeSchema,
        dryRun: { type: 'boolean' },
        force: { type: 'boolean' },
        allowRisky: { type: 'boolean', description: 'Install despite high-severity scanner findings.' },
      },
      required: ['skills'],
      additionalProperties: false,
    },
  },
  {
    name: 'skillrig_remove',
    title: 'Remove skills',
    description: 'Remove installed skills for the selected agents, restricted to SkillRig-managed directories.',
    inputSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, minItems: 1 },
        agents: agentsSchema,
        scope: scopeSchema,
      },
      required: ['names'],
      additionalProperties: false,
    },
  },
  {
    name: 'skillrig_list',
    title: 'List installed skills',
    description: 'List installed skills with drift status (ok, modified, missing).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'skillrig_scan',
    title: 'Scan a skill',
    description:
      'Run the SkillRig security scanner against a local path, GitHub repo, registry name, or .skm bundle without installing it.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        sarif: { type: 'boolean', description: 'Return SARIF 2.1.0 instead of a summary.' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'skillrig_audit',
    title: 'Audit installed skills',
    description: 'Re-scan every installed skill and report security findings and file drift.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'skillrig_budget',
    title: 'Context budget',
    description: 'Estimate the always-on and activated token cost of installed skills and warn when context is bloated.',
    inputSchema: {
      type: 'object',
      properties: { warnAtTokens: { type: 'number', minimum: 100 } },
      additionalProperties: false,
    },
  },
  {
    name: 'skillrig_doctor',
    title: 'Diagnose setup',
    description: 'Check lockfile health, drift, duplicate versions, unmanaged skills and AGENTS.md sync.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'skillrig_sync',
    title: 'Sync AGENTS.md',
    description: 'Rewrite the managed skill block in AGENTS.md from the project lockfile.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'Defaults to AGENTS.md.' } },
      additionalProperties: false,
    },
  },
];

function textResult(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.name || 'Error'}: ${error.message}` }],
  };
}

export async function callTool(name, args = {}, { cwd = process.cwd(), home = os.homedir() } = {}) {
  const context = { cwd, home };
  switch (name) {
    case 'skillrig_search': {
      const index = loadRegistry();
      const results = searchSkills(index, args.query || '', {
        category: args.category,
        agent: args.agent,
        grade: args.grade,
        limit: args.limit || 10,
      });
      return {
        query: args.query || '',
        total: index.skills.length,
        results: results.map((entry) => ({
          name: entry.name,
          version: entry.version,
          description: entry.description,
          category: entry.category,
          quality: entry.quality?.score,
          grade: entry.quality?.grade,
          agents: entry.agents,
          source: entry.source,
        })),
      };
    }
    case 'skillrig_info': {
      const index = loadRegistry();
      const entry = getSkill(index, args.name);
      if (!entry) throw new Error(`Unknown skill: ${args.name}`);
      return entry;
    }
    case 'skillrig_install': {
      const index = loadRegistry();
      const skills = [];
      for (const spec of args.skills) {
        skills.push(await loadSpec(spec, { cwd, index }));
      }
      return installSkills(skills, {
        agents: args.agents || ['codex'],
        scope: args.scope || 'global',
        cwd,
        home,
        dryRun: Boolean(args.dryRun),
        force: Boolean(args.force),
        allowRisky: Boolean(args.allowRisky),
      });
    }
    case 'skillrig_remove':
      return uninstallSkills(args.names, {
        agents: args.agents || null,
        scope: args.scope || 'global',
        cwd,
        home,
      });
    case 'skillrig_list':
      return { skills: listInstalled(context) };
    case 'skillrig_scan': {
      const index = loadRegistry();
      const skill = await loadSpec(args.source, { cwd, index });
      const result = scanFiles(skill.files, { manifest: skill.manifest });
      if (args.sarif) return toSarif(result.findings, { version: skill.manifest.version });
      return {
        name: skill.manifest.name,
        version: skill.manifest.version,
        integrity: skill.integrity,
        summary: riskSummary(result),
        findings: result.findings,
      };
    }
    case 'skillrig_audit':
      return { items: auditInstalled({ ...context, failOn: 'low' }) };
    case 'skillrig_budget':
      return contextBudget({ ...context, warnAtTokens: args.warnAtTokens || 1500 });
    case 'skillrig_doctor':
      return doctorReport(context);
    case 'skillrig_sync': {
      const entries = allLockEntries(context);
      return syncAgentsBlock(entries, { cwd, file: args.file || 'AGENTS.md' });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function writeMessage(output, message) {
  output.write(`${JSON.stringify(message)}\n`);
}

function reply(output, id, result) {
  writeMessage(output, { jsonrpc: '2.0', id, result });
}

function replyError(output, id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  writeMessage(output, { jsonrpc: '2.0', id, error });
}

export async function handleMessage(message, { cwd = process.cwd(), home = os.homedir() } = {}) {
  if (!message || message.jsonrpc !== '2.0') return { error: { code: -32600, message: 'Invalid Request' } };
  if (typeof message.method !== 'string') return { error: { code: -32600, message: 'Missing method' } };
  switch (message.method) {
    case 'initialize':
      return {
        result: {
          protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, logging: {} },
          serverInfo: { name: SERVER_NAME, version: packageInfo().version, title: 'SkillRig' },
          instructions:
            'SkillRig installs audited agent skills. Prefer skillrig_search before installing, and show the user scan results for anything that is not grade A / low risk.',
        },
      };
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return { result: {} };
    case 'tools/list':
      return { result: { tools: TOOLS } };
    case 'tools/call': {
      const { name, arguments: args } = message.params || {};
      try {
        const value = await callTool(name, args || {}, { cwd, home });
        return { result: textResult(value) };
      } catch (error) {
        return { result: errorResult(error) };
      }
    }
    case 'resources/list':
      return { result: { resources: [] } };
    case 'prompts/list':
      return { result: { prompts: [] } };
    default:
      return { error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

export async function runMcpServer({ cwd = process.cwd(), home = os.homedir(), input = process.stdin, output = process.stdout } = {}) {
  if (output.setEncoding) output.setEncoding('utf8');
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      replyError(output, null, -32700, 'Parse error');
      return;
    }
    const task = (async () => {
      try {
        const response = await handleMessage(message, { cwd, home });
        if (!response) return;
        if (response.error) replyError(output, message.id ?? null, response.error.code, response.error.message, response.error.data);
        else if (message.id !== undefined) reply(output, message.id, response.result);
      } catch (error) {
        if (message.id !== undefined) replyError(output, message.id, -32603, error.message);
      }
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  });

  await new Promise((resolve) => {
    rl.on('close', resolve);
    process.on('SIGINT', resolve);
    process.on('SIGTERM', resolve);
  });
  await Promise.allSettled([...pending]);
  return 0;
}

export function mcpToolCount() {
  return TOOLS.length;
}
