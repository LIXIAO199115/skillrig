import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PACKAGE_ROOT,
  c,
  displayPath,
  formatBytes,
  oneLine,
  renderTable,
  splitCommaList,
  truncate,
  treeHash,
  readTreeFromDir,
  isCI,
  packageInfo,
} from './core/util.mjs';
import { SkillRigError, UsageError, IntegrityError } from './core/errors.mjs';
import { loadRegistry, verifyRegistry, getSkill, getPack, searchSkills, registrySummary, listCategories } from './core/registry.mjs';
import { parseSourceSpec, loadSpec, loadBundled, loadLocal, loadBundle, buildBundle, bundleSigningPayload } from './core/source.mjs';
import { loadPrivateKey, signBytes } from './core/registry.mjs';
import { scanFiles, riskSummary, severityAtLeast, toSarif } from './core/security.mjs';
import { scoreQuality, gradeFor } from './core/quality.mjs';
import { parseSkill } from './core/manifest.mjs';
import {
  installSkills,
  uninstallSkills,
  listInstalled,
  auditInstalled,
  contextBudget,
  doctorReport,
  estimateTokens,
} from './core/installer.mjs';
import { listAgents, agentSkillDir, detectAgents, normalizeAgentId } from './core/agents.mjs';
import { readConfig, writeConfig, setConfigValue, configPath, DEFAULT_CONFIG } from './core/config.mjs';
import { syncAgentsBlock, checkAgentsBlock } from './core/agentsmd.mjs';
import { runMcpServer, mcpToolCount } from './core/mcp.mjs';
import { githubRepoInfo } from './core/net.mjs';

const pkg = packageInfo();
const COMMANDS = [
  'search',
  'info',
  'install',
  'remove',
  'list',
  'update',
  'doctor',
  'scan',
  'audit',
  'verify',
  'budget',
  'init',
  'pack',
  'publish',
  'migrate',
  'mcp',
  'targets',
  'sync',
  'config',
  'completion',
];

const ALIASES = {
  ls: 'list',
  uninstall: 'remove',
  rm: 'remove',
  i: 'install',
  add: 'install',
  s: 'search',
  docs: 'info',
};

function parseArgv(argv) {
  const flags = {};
  const positional = [];
  const takesValue = new Set([
    'agent',
    'agents',
    'scope',
    'cwd',
    'home',
    'skill',
    'ref',
    'fail-on',
    'sort',
    'category',
    'grade',
    'security',
    'license',
    'limit',
    'warn-at',
    'name',
    'description',
    'version',
    'out',
    'output',
    'key',
    'pack',
    'from',
    'to',
    'expect',
    'dir',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      let key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      let value = eq >= 0 ? arg.slice(eq + 1) : undefined;
      const negated = key.startsWith('no-');
      if (negated) key = key.slice(3);
      if (value === undefined) {
        const next = argv[index + 1];
        if (!negated && takesValue.has(key) && next !== undefined && !next.startsWith('-')) {
          value = next;
          index += 1;
        } else {
          value = !negated;
        }
      } else if (negated) {
        value = false;
      }
      const camel = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (Object.prototype.hasOwnProperty.call(flags, camel)) {
        flags[camel] = Array.isArray(flags[camel]) ? [...flags[camel], value] : [flags[camel], value];
      } else {
        flags[camel] = value;
      }
      continue;
    }
    if (/^-[a-zA-Z]+$/.test(arg) && arg.length > 1) {
      for (const letter of arg.slice(1)) {
        if (letter === 'y') flags.yes = true;
        else if (letter === 'h') flags.help = true;
        else if (letter === 'q') flags.quiet = true;
        else if (letter === 'v') flags.verbose = true;
        else if (letter === 'f') flags.force = true;
        else if (letter === 'j') flags.json = true;
        else if (letter === 'a') flags.all = true;
        else flags[letter] = true;
      }
      continue;
    }
    positional.push(arg);
  }
  return { flags, positional };
}

function bool(flags, key, fallback = false) {
  if (!(key in flags)) return fallback;
  const value = flags[key];
  if (Array.isArray(value)) return Boolean(value.at(-1));
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1' || value === true) return true;
  return Boolean(value);
}

function list(value) {
  return splitCommaList(value);
}

function allowRisky(ctx) {
  return bool(ctx.flags, 'allowRisky') || Boolean(readConfig().security.allowRisky);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function output(text, { quiet = false } = {}) {
  if (quiet || process.env.SKILLRIG_QUIET === '1') return;
  process.stdout.write(`${text}\n`);
}

function emitJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function badgeFor(entry) {
  const badge = entry.security?.badge || 'unknown';
  if (badge === 'clean') return c.green('clean');
  if (badge === 'review') return c.yellow('review');
  if (badge === 'high-risk') return c.red('high-risk');
  if (badge === 'critical') return c.bgRed(' critical ');
  return c.gray('unknown');
}

function trustLabel(entry) {
  if (entry.verified) return c.cyan('curated');
  if (entry.trust === 'official') return c.blue('official');
  return c.gray(entry.trust || 'community');
}

function loadIndex({ strict = false } = {}) {
  const signaturePath = path.join(PACKAGE_ROOT, 'registry', 'index.json.sig');
  const indexPath = path.join(PACKAGE_ROOT, 'registry', 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new UsageError('The bundled registry is missing. Run "npm run build" in the SkillRig repository.');
  }
  const requireSignature = fs.existsSync(signaturePath);
  if (strict && !requireSignature) {
    throw new IntegrityError('Registry is unsigned. Rebuild it with "npm run build:registry" and sign it.');
  }
  return loadRegistry({ requireSignature });
}

async function resolveSkills(specs, { all = false, skill = null, ref = null, index = null, cwd } = {}) {
  const skills = [];
  for (const spec of specs) {
    if (spec.startsWith('pack/') || spec.startsWith('pack:')) {
      const result = await loadSpec(spec, { index, cwd, all });
      skills.push(...result.skills);
      continue;
    }
    const result = await loadSpec(spec, { index, cwd, all, skill, ref });
    skills.push(...result.skills);
  }
  return skills;
}

function licenseWarning(skills) {
  const warnings = [];
  for (const skill of skills) {
    const entry = skill.entry;
    const status = entry?.licenseStatus;
    if (status && status !== 'permissive') {
      warnings.push(
        `${skill.manifest.name}: upstream license is ${entry.license || 'not declared'} (${status}). SkillRig links to the original repository; review its terms before use.`,
      );
    }
    if (entry?.blocked && !entry.verified) {
      warnings.push(`${skill.manifest.name}: security scan has high or critical findings upstream.`);
    }
  }
  return warnings;
}

function commandHelp(command) {
  const help = {
    search: `skillrig search [query] [--category <name>] [--grade <A+|A|B|C>] [--security <badge>]
              [--license <spdx>] [--sort relevance|quality|updated|name] [--limit <n>] [--json]

Search the signed registry. No query lists the highest-quality skills.`,
    info: `skillrig info <name|owner/repo@skill> [--json]

Show metadata, quality, security, source, and the exact install command.`,
    install: `skillrig install <source...> [--skill <name>] [--all] [--ref <branch|sha>] [--agent <id>] [--scope global|project]
                [--pack <name>] [--force] [--dry-run] [--allow-risky] [--fail-on <severity>] [--json]

Sources: a registry name, owner/repo, owner/repo@skill, a local directory or SKILL.md,
a .skm bundle, or pack/<name>. Repeat --agent or pass a comma list.`,
    remove: `skillrig remove <name...> [--agent <id>] [--scope global|project] [--all-scopes] [--force] [--json]

Remove installed skills and their lockfile entries.`,
    list: `skillrig list [--agent <id>] [--scope global|project] [--json]

List installed skills with integrity status.`,
    update: `skillrig update [name...] [--all] [--dry-run] [--force] [--json]

Reinstall from the original source. Registry entries follow the repository's default branch.`,
    doctor: `skillrig doctor [--json] [--fix]

Check lockfile drift, missing installs, dependency gaps, version skew, unmanaged skills,
and a stale AGENTS.md block. --fix syncs the AGENTS.md block.`,
    scan: `skillrig scan <source...> [--fail-on critical|high|medium|low|none] [--strict]
               [--show-suppressed] [--sarif] [--json]

Scan a skill before installing it. --strict ignores inline skillrig-ignore markers.`,
    audit: `skillrig audit [--fail-on <severity>] [--json]

Rescan every installed skill.`,
    verify: `skillrig verify [--registry] [--installed] [<path>] [--expect <treeHash>] [--json]

Verify the registry signature, installed file hashes, or a directory's tree hash.`,
    budget: `skillrig budget [--warn-at <tokens>] [--json]

Estimate always-on and activation tokens for installed skills.`,
    init: `skillrig init [name] [--dir <path>] [--description <text>] [--force]

Create a SKILL.md scaffold that passes validation and quality checks.`,
    pack: `skillrig pack <dir...> [--name <name>] [--version <semver>] [--out <file.skm>] [--key <pem>]

Bundle one or more local skills into a .skm archive, optionally signed with Ed25519.`,
    publish: `skillrig publish <dir> [--name <name>] [--version <semver>] [--key <pem>] [--out <file>]

Build a signed bundle and print a registry entry ready for review.`,
    migrate: `skillrig migrate [--from <dir>] [--to <agent>] [--scope global|project] [--dry-run]

Import skills from another agent's directory (default ~/.claude/skills) into the selected agents.`,
    mcp: `skillrig mcp

Run the SkillRig MCP server over stdio for Codex and other MCP clients.`,
    targets: `skillrig targets [--json]

List supported agents, their skill directories, and which ones are detected on this machine.`,
    sync: `skillrig sync [--json]

Write or refresh the managed skills block in AGENTS.md for project-scope installs.`,
    config: `skillrig config [list|get <key>|set <key> <value>|path] [--json]

Read or change default agents, install scope, and security defaults.`,
    completion: `skillrig completion <bash|zsh|fish|powershell>

Print a shell completion script.`,
  };
  return help[command] || null;
}

function globalHelp() {
  return `${c.bold(`SkillRig ${pkg.version}`)} ${c.gray('— signed skill registry and installer')}

${c.bold('Usage')}
  skillrig <command> [options]

${c.bold('Commands')}
  search       Search the signed registry
  info         Show a skill or pack
  install      Install from the registry, GitHub, a path, or a .skm bundle
  remove       Remove installed skills
  list         List installed skills
  update       Update installed skills from their sources
  doctor       Diagnose installs, drift, dependencies, and AGENTS.md
  scan         Security-scan a skill before installing
  audit        Rescan everything installed
  verify       Verify registry signature and file integrity
  budget       Measure context cost of installed skills
  init         Scaffold a new SKILL.md
  pack         Build a .skm bundle
  publish      Build a signed bundle and registry entry
  migrate      Import skills from another agent
  mcp          Run the MCP server over stdio
  targets      List supported agents
  sync         Update the AGENTS.md skills block
  config       Read or update configuration
  completion   Print shell completions

${c.bold('Global options')}
  -j, --json           Machine-readable output
  -q, --quiet          Suppress non-essential output
      --no-color       Disable ANSI colour
      --cwd <path>     Project directory (default: current directory)
      --home <path>    Home directory used for install paths (default: user home)
  -v, --verbose        Print stack traces for unexpected errors

${c.gray('Docs: https://github.com/LIXIAO199115/skillrig   Registry: 18 curated + upstream catalog')}`;
}

async function cmdSearch(ctx) {
  const index = loadIndex();
  const query = ctx.positional.join(' ');
  const results = searchSkills(index, query, {
    category: ctx.flags.category,
    grade: ctx.flags.grade,
    security: ctx.flags.security,
    license: ctx.flags.license,
    sort: ctx.flags.sort,
    limit: number(ctx.flags.limit, query ? 25 : 20),
  });
  if (bool(ctx.flags, 'json')) {
    emitJson({ query, count: results.length, skills: results.map(({ _score, ...rest }) => rest) });
    return;
  }
  if (results.length === 0) {
    output(`No skills matched${query ? ` "${query}"` : ''}. Try a broader term or "skillrig search" with no query.`);
    return;
  }
  const rows = results.map((entry) => [
    entry.name,
    entry.verified ? c.cyan('curated') : entry.trust === 'official' ? c.blue('official') : 'community',
    entry.quality?.grade || '—',
    badgeFor(entry),
    truncate(oneLine(entry.description, 90), 90),
  ]);
  output(renderTable(rows, ['NAME', 'TRUST', 'GRADE', 'SECURITY', 'DESCRIPTION']));
  const summary = registrySummary(index);
  output(
    c.gray(
      `\n${summary.skills} skills · ${summary.packs} packs · ${summary.verified} curated · ${summary.sources} sources · registry ${summary.generatedAt?.slice(0, 10) || 'unknown'}`,
    ),
  );
  output(c.gray('Install with: skillrig install <name>. Add --json for full metadata.'));
}

function printPack(index, pack, asJson) {
  if (asJson) return emitJson({ pack });
  output(`${c.bold(pack.title || pack.name)} ${c.gray(`v${pack.version || '1.0.0'}`)} ${c.cyan('pack')}`);
  output(`${pack.description || ''}\n`);
  for (const skillName of pack.skills || []) {
    const entry = getSkill(index, skillName);
    output(`  ${skillName}${entry ? c.gray(`  ${entry.quality?.grade || ''} · ${entry.description?.slice(0, 80) || ''}`) : c.red('  missing from registry')}`);
  }
  output(`\nInstall: skillrig install pack/${pack.name}`);
}

async function cmdInfo(ctx) {
  const name = ctx.positional[0];
  if (!name) throw new UsageError('Usage: skillrig info <name|owner/repo@skill|pack/name>');
  const index = loadIndex();
  if (name.startsWith('pack/') || name.startsWith('pack:')) {
    const pack = getPack(index, name.replace(/^pack[:/]/, ''));
    if (!pack) throw new UsageError(`Pack not found: ${name}`);
    return printPack(index, pack, bool(ctx.flags, 'json'));
  }
  let entry = getSkill(index, name);
  if (!entry) {
    const pack = getPack(index, name);
    if (pack) return printPack(index, pack, bool(ctx.flags, 'json'));
    const parsed = parseSourceSpec(name, { index });
    if (parsed.type === 'registry') entry = parsed.entry;
    if (!entry) throw new UsageError(`Skill not found: ${name}. Run "skillrig search ${name}".`);
  }
  if (bool(ctx.flags, 'json')) return emitJson({ skill: entry });
  output(`${c.bold(entry.name)} ${c.gray(`v${entry.version}`)}  ${trustLabel(entry)}${entry.blocked ? `  ${c.bgRed(' BLOCKED ')}` : ''}`);
  output(`${entry.description}\n`);
  output(`Source     ${entry.source?.repo || entry.source?.type || 'unknown'}${entry.source?.path ? `/${entry.source.path}` : ''}`);
  if (entry.source?.ref) output(`Commit     ${entry.source.ref}`);
  if (entry.source?.branch) output(`Branch     ${entry.source.branch}`);
  output(`License    ${entry.license || c.yellow('not declared')}${entry.licenseStatus ? ` (${entry.licenseStatus})` : ''}`);
  output(`Quality    ${entry.quality?.grade || '—'} ${entry.quality?.score != null ? `(${entry.quality.score}/100)` : ''}`);
  output(
    `Security   ${badgeFor(entry)} ${entry.security ? `(${[...Object.entries(entry.security.counts || {})].filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || 'no findings'})` : ''}`,
  );
  output(`Integrity  ${entry.integrity}`);
  if (entry.categories?.length) output(`Categories ${entry.categories.join(', ')}`);
  if (entry.tags?.length) output(`Tags       ${entry.tags.join(', ')}`);
  if (entry.requires?.length) output(`Requires   ${entry.requires.join(', ')}`);
  if (entry.blocked) {
    output(c.red(`\nBlocked: upstream scan found high or critical findings. Review with "skillrig scan ${entry.source?.repo}@${entry.name}".`));
  }
  output(`\nInstall: ${c.cyan(`skillrig install ${entry.name}`)}`);
  if (entry.id && entry.id !== entry.name) output(c.gray(`Exact source: skillrig install ${entry.source?.repo}@${entry.name}`));
}

async function cmdInstall(ctx) {
  const index = loadIndex();
  let specs = [...ctx.positional];
  if (ctx.flags.pack) specs.push(`pack/${ctx.flags.pack}`);
  if (specs.length === 0) throw new UsageError('Usage: skillrig install <source...> [--skill <name>] [--agent <id>]');
  const skills = await resolveSkills(specs, {
    all: bool(ctx.flags, 'all'),
    skill: ctx.flags.skill,
    ref: ctx.flags.ref,
    index,
    cwd: ctx.cwd,
  });
  if (skills.length === 0) throw new UsageError('No skills found in the given sources.');
  const blocked = skills.filter((skill) => skill.entry?.blocked && !allowRisky(ctx));
  if (blocked.length > 0) {
    throw new UsageError(
      `Refusing to install skills with high or critical findings: ${blocked.map((skill) => skill.manifest.name).join(', ')}. Review with "skillrig scan <source>", then pass --allow-risky.`,
    );
  }
  const requestedAgents = list(ctx.flags.agent);
  const agents = requestedAgents.length > 0 ? requestedAgents : readConfig().defaultAgents;
  const scope = ctx.flags.scope || readConfig().defaultScope;
  const result = installSkills(skills, {
    agents,
    scope,
    cwd: ctx.cwd,
    home: ctx.home,
    force: bool(ctx.flags, 'force'),
    allowRisky: allowRisky(ctx),
    failOn: ctx.flags.failOn || readConfig().security.failOn,
    dryRun: bool(ctx.flags, 'dryRun'),
  });
  for (const warning of licenseWarning(skills)) output(c.yellow(`warning: ${warning}`));
  if (bool(ctx.flags, 'json')) return emitJson(result);
  for (const item of result.results) {
    const verb = item.status === 'skipped' ? c.gray('skip') : c.green('install');
    output(`${verb} ${item.name}@${item.version || '0.0.0'} ${c.gray(`[${item.security?.badge || 'unknown'}]`)}`);
    for (const target of item.targets) {
      output(`  ${target.action === 'skipped' ? c.gray('·') : c.green('→')} ${target.agent} ${target.path}`);
    }
    for (const warning of item.warnings || []) output(c.yellow(`  warning: ${warning}`));
  }
  output(
    `\n${result.results.filter((item) => item.status !== 'skipped').length} installed, ${result.results.filter((item) => item.status === 'skipped').length} skipped (${scope}).`,
  );
}

async function cmdRemove(ctx) {
  if (ctx.positional.length === 0) throw new UsageError('Usage: skillrig remove <name...>');
  const result = uninstallSkills(ctx.positional, {
    agents: list(ctx.flags.agent).length ? list(ctx.flags.agent) : null,
    scope: ctx.flags.scope || readConfig().defaultScope,
    allScopes: bool(ctx.flags, 'allScopes'),
    cwd: ctx.cwd,
    home: ctx.home,
    force: bool(ctx.flags, 'force'),
  });
  if (bool(ctx.flags, 'json')) return emitJson(result);
  for (const item of result.removed) output(`${c.red('remove')} ${item.name} (${item.agent}, ${item.scope}) ${c.gray(item.path)}`);
  for (const name of result.notFound) output(c.yellow(`not installed: ${name}`));
  if (result.removed.length === 0 && result.notFound.length > 0) process.exitCode = 1;
}

async function cmdList(ctx) {
  const items = listInstalled({ cwd: ctx.cwd, home: ctx.home }).filter(
    (item) =>
      (!ctx.flags.agent || list(ctx.flags.agent).map(normalizeAgentId).includes(item.agent)) &&
      (!ctx.flags.scope || item.scope === ctx.flags.scope),
  );
  if (bool(ctx.flags, 'json')) return emitJson({ count: items.length, skills: items });
  if (items.length === 0) {
    output('No skills installed. Try: skillrig install codex-cli-workflows');
    return;
  }
  const status = (item) =>
    item.status === 'ok' ? c.green('ok') : item.status === 'modified' ? c.yellow('modified') : c.red(item.status);
  output(
    renderTable(
      items.map((item) => [
        item.name,
        item.version || '—',
        item.agent,
        item.scope,
        status(item),
        truncate(item.displayPath, 52),
      ]),
      ['NAME', 'VERSION', 'AGENT', 'SCOPE', 'STATUS', 'PATH'],
    ),
  );
  output(c.gray(`\n${items.length} install(s) across ${new Set(items.map((item) => item.agent)).size} agent(s).`));
}

async function cmdUpdate(ctx) {
  const installed = listInstalled({ cwd: ctx.cwd, home: ctx.home });
  const byName = new Map();
  for (const item of installed) {
    if (!byName.has(item.name)) byName.set(item.name, []);
    byName.get(item.name).push(item);
  }
  const wanted = ctx.positional.length > 0 ? ctx.positional : bool(ctx.flags, 'all') ? [...byName.keys()] : [];
  if (wanted.length === 0) {
    throw new UsageError('Usage: skillrig update <name...> | --all. Installed: ' + ([...byName.keys()].join(', ') || 'none'));
  }
  const index = loadIndex();
  const agentFilter = list(ctx.flags.agent);
  const scopeFilter = ctx.flags.scope || null;
  let changed = 0;
  for (const name of wanted) {
    const installs = byName.get(name);
    if (!installs) {
      output(c.yellow(`not installed: ${name}`));
      continue;
    }
    const entry = getSkill(index, name);
    let skill = null;
    try {
      if (entry?.source?.type === 'bundled') {
        skill = loadBundled(name).skills[0];
      } else if (entry?.source?.type === 'github') {
        const result = await loadSpec(`${entry.source.repo}@${name}`, { index, cwd: ctx.cwd });
        skill = result.skills[0];
      }
    } catch (error) {
      output(c.yellow(`skip ${name}: ${error.message}`));
      continue;
    }
    if (!skill) {
      output(c.yellow(`not updatable: ${name} (installed from a local path or bundle)`));
      continue;
    }
    const targets = installs.filter(
      (item) => (agentFilter.length === 0 || agentFilter.includes(item.agent)) && (!scopeFilter || item.scope === scopeFilter),
    );
    const seen = new Set();
    for (const target of targets) {
      const key = `${target.agent}|${target.scope}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = installSkills([skill], {
        agents: [target.agent],
        scope: target.scope,
        cwd: ctx.cwd,
        home: ctx.home,
        force: true,
        allowRisky: allowRisky(ctx),
        dryRun: bool(ctx.flags, 'dryRun'),
      });
      if (bool(ctx.flags, 'json')) {
        emitJson(result);
      } else {
        for (const item of result.results) {
          output(`${item.status === 'skipped' ? c.gray('skip') : c.green('update')} ${item.name}@${item.version || '0.0.0'} ${c.gray(`(${target.agent}, ${target.scope})`)}`);
          if (item.status !== 'skipped') changed += 1;
        }
      }
    }
    if (targets.length === 0) output(c.yellow(`no matching installs for ${name}`));
  }
  if (changed > 0) output(c.gray('Run "skillrig doctor" to verify the new files.'));
}

async function cmdDoctor(ctx) {
  const report = doctorReport({ cwd: ctx.cwd, home: ctx.home });
  if (bool(ctx.flags, 'fix')) {
    const installed = listInstalled({ cwd: ctx.cwd, home: ctx.home }).filter((item) => item.scope === 'project');
    if (installed.length > 0) {
      const result = syncAgentsBlock(
        installed.map((item) => ({
          name: item.name,
          scope: item.scope,
          entry: { description: item.description, version: item.version },
          install: { path: item.path, agent: item.agent },
        })),
        { cwd: ctx.cwd },
      );
      report.fixed = result;
    }
  }
  if (bool(ctx.flags, 'json')) return emitJson(report);
  if (report.issues.length === 0) {
    output(c.green(`ok: ${report.skills} skill(s), ${report.installs} install(s), no issues.`));
    return;
  }
  for (const issue of report.issues) {
    const marker = issue.severity === 'error' ? c.bgRed(' error ') : issue.severity === 'warning' ? c.bgYellow(' warn ') : c.blue(' info ');
    output(`${marker} ${issue.message}`);
  }
  if (report.fixed) output(c.gray(`synced ${report.fixed.displayPath}`));
  const errors = report.issues.filter((issue) => issue.severity === 'error').length;
  output(c.gray(`\n${report.issues.length} issue(s), ${errors} error(s).`));
  if (errors > 0) process.exitCode = 1;
}

async function cmdScan(ctx) {
  const specs = [...ctx.positional];
  if (specs.length === 0) throw new UsageError('Usage: skillrig scan <source...> [--fail-on high] [--sarif]');
  const index = loadIndex();
  const skills = await resolveSkills(specs, { all: bool(ctx.flags, 'all'), skill: ctx.flags.skill, index, cwd: ctx.cwd });
  const failOn = ctx.flags.failOn || 'high';
  const scans = skills.map((skill) => {
    const result = scanFiles(skill.files, { manifest: skill.manifest, respectSuppressions: !bool(ctx.flags, 'strict') });
    const quality = scoreQuality({ manifest: skill.manifest, body: skill.body, files: skill.files });
    return {
      name: skill.manifest.name,
      source: skill.source,
      quality: { score: quality.score, grade: quality.grade },
      security: riskSummary(result),
      findings: result.findings,
      suppressed: result.suppressed,
      scan: result,
    };
  });
  if (bool(ctx.flags, 'sarif')) {
    const findings = scans.flatMap((item) => [...item.findings, ...item.suppressed]);
    process.stdout.write(`${JSON.stringify(toSarif(findings, { version: pkg.version }), null, 2)}\n`);
  } else if (bool(ctx.flags, 'json')) {
    emitJson({
      skills: scans.map(({ scan, ...rest }) => rest),
      failOn,
      failed: scans.some((item) => item.findings.some((finding) => severityAtLeast(finding.severity, failOn))),
    });
  } else {
    for (const item of scans) {
      output(
        `${c.bold(item.name)}  quality ${item.quality.grade} (${item.quality.score})  security ${badgeFor({ security: item.security })}  ${c.gray(item.source?.repo || item.source?.type || '')}`,
      );
      for (const finding of item.findings) {
        const marker =
          finding.severity === 'critical' || finding.severity === 'high'
            ? c.red(finding.severity.padEnd(8))
            : finding.severity === 'medium'
              ? c.yellow(finding.severity.padEnd(8))
              : c.gray(finding.severity.padEnd(8));
        output(`  ${marker} ${finding.ruleId}  ${finding.file}:${finding.line}`);
        output(`           ${truncate(finding.excerpt || finding.title, 110)}`);
      }
      if (bool(ctx.flags, 'showSuppressed') && item.suppressed.length > 0) {
        output(c.gray(`  ${item.suppressed.length} suppressed finding(s):`));
        for (const finding of item.suppressed) {
          output(c.gray(`    ${finding.ruleId}  ${finding.file}:${finding.line} — ${finding.suppressionReason || 'no reason recorded'}`));
        }
      } else if (item.suppressed.length > 0) {
        output(c.gray(`  ${item.suppressed.length} suppressed finding(s); pass --show-suppressed to inspect.`));
      }
      if (item.findings.length === 0) output(c.green('  no active findings'));
    }
  }
  const failed = scans.some((item) => item.findings.some((finding) => severityAtLeast(finding.severity, failOn)));
  if (failed && failOn !== 'none') process.exitCode = 3;
}

async function cmdAudit(ctx) {
  const failOn = ctx.flags.failOn || 'high';
  const items = auditInstalled({ cwd: ctx.cwd, home: ctx.home, failOn });
  if (bool(ctx.flags, 'json')) return emitJson({ failOn, skills: items });
  if (items.length === 0) {
    output('No installed skills to audit.');
    return;
  }
  for (const item of items) {
    output(
      `${c.bold(item.name)} ${c.gray(`(${item.agent}, ${item.scope})`)}  security ${badgeFor({ security: item.security })}  ${item.findings.length} finding(s) at or above ${failOn}`,
    );
    for (const finding of item.findings) output(`  ${c.red(finding.severity.padEnd(8))} ${finding.ruleId}  ${finding.file}:${finding.line}`);
  }
  if (items.some((item) => item.findings.length > 0) && failOn !== 'none') process.exitCode = 3;
}

async function cmdVerify(ctx) {
  if (bool(ctx.flags, 'installed')) {
    const items = listInstalled({ cwd: ctx.cwd, home: ctx.home });
    const result = items.map((item) => ({
      name: item.name,
      agent: item.agent,
      scope: item.scope,
      status: item.status,
      changed: item.verification.changed,
      missing: item.verification.missing,
      extra: item.verification.extra,
    }));
    if (bool(ctx.flags, 'json')) return emitJson({ installs: result });
    for (const item of result) {
      const marker = item.status === 'ok' ? c.green('ok') : c.red(item.status);
      output(`${marker.padEnd(12)} ${item.name} (${item.agent}, ${item.scope})`);
      if (item.changed.length) output(c.yellow(`  changed: ${item.changed.join(', ')}`));
      if (item.missing.length) output(c.red(`  missing: ${item.missing.join(', ')}`));
      if (item.extra.length) output(c.yellow(`  extra: ${item.extra.join(', ')}`));
    }
    if (result.some((item) => item.status !== 'ok')) process.exitCode = 4;
    return;
  }
  const target = ctx.positional[0];
  if (target) {
    const dir = path.resolve(ctx.cwd, target);
    if (!fs.existsSync(dir)) throw new UsageError(`Path not found: ${target}`);
    const { files } = readTreeFromDir(dir);
    const hash = treeHash(files);
    if (bool(ctx.flags, 'json')) return emitJson({ path: dir, integrity: hash, files: files.size });
    output(`path       ${dir}`);
    output(`integrity  ${hash}`);
    output(`files      ${files.size}`);
    if (ctx.flags.expect && ctx.flags.expect !== hash) {
      output(c.red('integrity does not match --expect'));
      process.exitCode = 4;
    } else if (ctx.flags.expect) {
      output(c.green('integrity matches --expect'));
    }
    return;
  }
  const result = verifyRegistry({});
  if (bool(ctx.flags, 'json')) return emitJson(result.index ? { verified: result.verified, keyId: result.keyId, record: result.record } : { verified: false });
  const summary = registrySummary(result.index);
  output(c.green(`registry verified: ${summary.skills} skills, ${summary.packs} packs`));
  output(`key        ${result.keyId}`);
  output(`digest     ${result.record?.digest}`);
  output(`signed     ${result.record?.signedAt}`);
}

async function cmdBudget(ctx) {
  const report = contextBudget({
    cwd: ctx.cwd,
    home: ctx.home,
    warnAtTokens: number(ctx.flags.warnAt, readConfig().contextBudget.warnAtTokens),
  });
  if (bool(ctx.flags, 'json')) return emitJson(report);
  if (report.entries.length === 0) {
    output('No installed skills to measure.');
    return;
  }
  output(
    renderTable(
      report.entries.map((entry) => [
        entry.name,
        String(entry.alwaysOnTokens),
        String(entry.activationTokens),
        String(entry.totalTokens),
      ]),
      ['NAME', 'ALWAYS-ON', 'ACTIVATION', 'TOTAL'],
      { align: ['left', 'right', 'right', 'right'] },
    ),
  );
  output(
    `\nTotal always-on ${report.totals.alwaysOnTokens} tokens · activation ${report.totals.activationTokens} · full ${report.totals.totalTokens}.`,
  );
  for (const warning of report.warnings) output(c.yellow(`warning: ${warning}`));
  output(c.gray('Always-on = name + description loaded into every session. Tokens are estimated at 4 characters per token.'));
}

function skillTemplate(name, description) {
  const title = name.replace(/-/g, ' ');
  return `---
name: ${name}
description: ${description}
license: MIT
metadata:
  version: 0.1.0
  author: your-handle
  categories:
    - engineering
  tags:
    - ${name.split('-')[0]}
---

# ${title}

One paragraph that states the job this skill does and the output it produces. Keep it concrete.

## When to use

Use this skill when:

- The user asks for ${title}.
- A task needs the same procedure twice and improvisation would cause drift.
- You need a repeatable checklist instead of a one-off answer.

Do not use it when a single command or a one-line answer is enough.

## Workflow

1. Gather the minimum inputs: repository path, target branch, and the failing command.
2. Inspect before changing anything. Record the evidence you will compare against.
3. Apply the change in the smallest reversible step.
4. Verify with a command whose output proves the change worked.
5. Report what changed, what was verified, and what remains uncertain.

## Examples

Typical request:

> Use ${name} on this repository and report the result.

Expected output: a short summary, the exact commands run, and the verification evidence.

## Guardrails

- Never report success without running the verification command.
- Never delete user files or rewrite shared history without explicit approval.
- If a required tool is missing, stop and report it instead of simulating the result.

## Verification checklist

- [ ] The command in the workflow was executed successfully.
- [ ] The output matches the stated success criteria.
- [ ] No unrelated files changed.
- [ ] Remaining risks are listed.
`;
}

function cmdInit(ctx) {
  const rawName = ctx.positional[0] || ctx.flags.name;
  if (!rawName) throw new UsageError('Usage: skillrig init <name>');
  const name = String(rawName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new UsageError('Skill names must be 1-64 lowercase letters, digits, or single hyphens.');
  }
  const target = ctx.flags.dir ? path.resolve(ctx.cwd, ctx.flags.dir) : path.join(ctx.cwd, 'skills', name);
  const file = path.join(target, 'SKILL.md');
  if (fs.existsSync(file) && !bool(ctx.flags, 'force')) throw new UsageError(`${file} already exists. Use --force to overwrite.`);
  const description =
    ctx.flags.description ||
    `Use when the user needs ${name.replace(/-/g, ' ')} handled with a consistent, verifiable procedure. Replace this sentence with the concrete trigger, the inputs, and the output.`;
  if (description.length > 1024) throw new UsageError('description must be 1024 characters or fewer');
  fs.mkdirSync(path.join(target, 'references'), { recursive: true });
  fs.writeFileSync(file, skillTemplate(name, description));
  fs.writeFileSync(
    path.join(target, 'references', 'checklist.md'),
    `# ${name} checklist\n\n- [ ] Inputs recorded\n- [ ] Change applied\n- [ ] Verification command run\n- [ ] Result reported with evidence\n`,
  );
  output(`${c.green('created')} ${displayPath(file, { cwd: ctx.cwd, home: ctx.home })}`);
  output(c.gray(`Next: edit the description and workflow, then run "skillrig scan ${target}".`));
}

async function cmdPack(ctx) {
  if (ctx.positional.length === 0) throw new UsageError('Usage: skillrig pack <dir...> [--name <name>] [--out <file.skm>]');
  const skills = [];
  for (const dir of ctx.positional) {
    const result = loadLocal(dir, { all: bool(ctx.flags, 'all') });
    skills.push(...result.skills);
  }
  if (skills.length === 0) throw new UsageError('No skills found in the given paths.');
  const name = ctx.flags.name || (skills.length === 1 ? skills[0].manifest.name : 'skillrig-bundle');
  const version = ctx.flags.version || '1.0.0';
  let signature = null;
  if (ctx.flags.key) {
    const bundle = buildBundle(skills, { name, version });
    signature = signBytes(bundleSigningPayload(bundle.manifest), loadPrivateKey(ctx.flags.key));
  }
  const bundle = buildBundle(skills, { name, version, signature });
  const out = path.resolve(ctx.cwd, ctx.flags.out || ctx.flags.output || `${name}-${version}.skm`);
  fs.writeFileSync(out, bundle.data);
  if (bool(ctx.flags, 'json')) return emitJson({ file: out, bytes: bundle.data.length, name, version, skills: skills.map((skill) => skill.manifest.name), signed: Boolean(signature) });
  output(`${c.green('packed')} ${displayPath(out, { cwd: ctx.cwd, home: ctx.home })} ${c.gray(`${formatBytes(bundle.data.length)}, ${skills.length} skill(s)${signature ? ', signed' : ''}`)}`);
}

async function cmdPublish(ctx) {
  const dir = ctx.positional[0];
  if (!dir) throw new UsageError('Usage: skillrig publish <dir> [--key <pem>] [--out <file>]');
  const loaded = loadLocal(dir, { all: bool(ctx.flags, 'all') });
  const skills = loaded.skills;
  const name = ctx.flags.name || (skills.length === 1 ? skills[0].manifest.name : 'bundle');
  const version = ctx.flags.version || '1.0.0';
  let signature = null;
  if (ctx.flags.key) {
    const unsigned = buildBundle(skills, { name, version });
    signature = signBytes(bundleSigningPayload(unsigned.manifest), loadPrivateKey(ctx.flags.key));
  }
  const bundle = buildBundle(skills, { name, version, signature });
  if (ctx.flags.out || ctx.flags.output) {
    const out = path.resolve(ctx.cwd, ctx.flags.out || ctx.flags.output);
    fs.writeFileSync(out, bundle.data);
    output(`${c.green('bundle')} ${displayPath(out, { cwd: ctx.cwd, home: ctx.home })}`);
  }
  const entries = skills.map((skill) => {
    const quality = scoreQuality({ manifest: skill.manifest, body: skill.body, files: skill.files });
    const security = scanFiles(skill.files, { manifest: skill.manifest });
    return {
      name: skill.manifest.name,
      version: skill.manifest.version || version,
      description: oneLine(skill.manifest.description, 300),
      license: skill.manifest.license || null,
      integrity: skill.integrity,
      quality: { score: quality.score, grade: quality.grade },
      security: riskSummary(security),
      source: { type: 'bundle', file: path.basename(ctx.flags.out || `${name}-${version}.skm`) },
      verified: false,
    };
  });
  if (bool(ctx.flags, 'json')) return emitJson({ bundle: { name, version, signed: Boolean(signature) }, entries });
  output(c.bold('Registry entries'));
  output(JSON.stringify({ skills: entries }, null, 2));
  output(c.gray('\nSubmit these entries to the registry in a pull request, or host the .skm file yourself.'));
}

async function cmdMigrate(ctx) {
  const from = path.resolve(ctx.cwd, ctx.flags.from || path.join(ctx.home, '.claude', 'skills'));
  if (!fs.existsSync(from)) throw new UsageError(`Source directory not found: ${from}. Pass --from <dir>.`);
  const loaded = loadLocal(from, { all: true });
  if (loaded.skills.length === 0) throw new UsageError(`No skills found in ${from}`);
  const agents = list(ctx.flags.to || ctx.flags.agent);
  const scope = ctx.flags.scope || 'global';
  const result = installSkills(loaded.skills, {
    agents: agents.length > 0 ? agents : ['codex'],
    scope,
    cwd: ctx.cwd,
    home: ctx.home,
    force: bool(ctx.flags, 'force'),
    dryRun: bool(ctx.flags, 'dryRun'),
    failOn: ctx.flags.failOn || 'high',
    allowRisky: allowRisky(ctx),
  });
  if (bool(ctx.flags, 'json')) return emitJson(result);
  output(`Migrating ${loaded.skills.length} skill(s) from ${from}`);
  for (const item of result.results) output(`${c.green('install')} ${item.name} → ${item.targets.map((target) => target.agent).join(', ')}`);
  for (const item of result.results) for (const warning of item.warnings || []) output(c.yellow(`warning: ${warning}`));
}

function completionScript(shell) {
  const names = COMMANDS.join(' ');
  if (shell === 'bash') {
    return `_skillrig() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "\$prev" in
    --agent|--scope|--sort|--fail-on|--license|--category|--grade|--security) COMPREPLY=( \$(compgen -W "global project critical high medium low none relevance quality updated name" -- "\$cur") ); return 0 ;;
    completion) COMPREPLY=( \$(compgen -W "bash zsh fish powershell" -- "\$cur") ); return 0 ;;
  esac
  if [ "\$COMP_CWORD" -eq 1 ]; then COMPREPLY=( \$(compgen -W "${names}" -- "\$cur") ); fi
}
complete -F _skillrig skillrig skr`;
  }
  if (shell === 'zsh') {
    return `#compdef skillrig skr
_skillrig() {
  local -a commands
  commands=(${COMMANDS.map((name) => `'${name}'`).join(' ')})
  _arguments '1:command:->cmds' '*::arg:->args'
  case \$state in
    cmds) _describe 'command' commands ;;
  esac
}
_skillrig "$@"`;
  }
  if (shell === 'fish') {
    return COMMANDS.map((name) => `complete -c skillrig -f -n "__fish_use_subcommand" -a "${name}"`).join('\n');
  }
  if (shell === 'powershell') {
    return `Register-ArgumentCompleter -Native -CommandName skillrig,skr -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @(${COMMANDS.map((name) => `'${name}'`).join(',')})
  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}`;
  }
  throw new UsageError(`Unsupported shell: ${shell}. Use bash, zsh, fish, or powershell.`);
}

function cmdConfig(ctx) {
  const action = ctx.positional[0] || 'list';
  if (action === 'path') return output(configPath());
  if (action === 'list' || action === 'get') {
    const config = readConfig();
    if (action === 'get') {
      const key = ctx.positional[1];
      if (!key) throw new UsageError('Usage: skillrig config get <key>');
      const value = key.split('.').reduce((target, part) => (target == null ? target : target[part]), config);
      if (value === undefined) throw new UsageError(`Unknown config key: ${key}`);
      if (bool(ctx.flags, 'json')) return emitJson({ key, value });
      return output(typeof value === 'string' ? value : JSON.stringify(value));
    }
    if (bool(ctx.flags, 'json')) return emitJson(config);
    output(JSON.stringify(config, null, 2));
    return;
  }
  if (action === 'set') {
    const [key, ...rest] = ctx.positional.slice(1);
    const value = rest.join(' ');
    if (!key || !value) throw new UsageError('Usage: skillrig config set <key> <value>');
    const result = setConfigValue(key, value);
    output(`${c.green('set')} ${result.key} = ${JSON.stringify(result.value)}`);
    return;
  }
  throw new UsageError('Usage: skillrig config [list|get <key>|set <key> <value>|path]');
}

async function cmdTargets(ctx) {
  const detected = new Set(detectAgents({ cwd: ctx.cwd, home: ctx.home, includeBins: true }).map((agent) => agent.id));
  const rows = listAgents().map((agent) => [
    agent.id,
    agent.name,
    agent.globalPath || '—',
    agent.projectPath || '—',
    detected.has(agent.id) ? c.green('yes') : c.gray('no'),
  ]);
  if (bool(ctx.flags, 'json')) return emitJson({ agents: listAgents(), detected: [...detected] });
  output(renderTable(rows, ['ID', 'NAME', 'GLOBAL', 'PROJECT', 'DETECTED']));
  output(c.gray(`\n${rows.length} agents supported. Install with --agent <id>, or comma-separated ids.`));
}

function cmdSync(ctx) {
  const items = listInstalled({ cwd: ctx.cwd, home: ctx.home }).filter((item) => item.scope === 'project');
  const entries = items.map((item) => ({
    name: item.name,
    scope: item.scope,
    entry: { description: item.description, version: item.version, integrity: item.integrity, source: item.source },
    install: { path: item.path, agent: item.agent },
  }));
  const result = syncAgentsBlock(entries, { cwd: ctx.cwd });
  if (bool(ctx.flags, 'json')) return emitJson(result);
  if (!result.exists && entries.length === 0) {
    output('No project-scope skills installed; nothing to sync.');
    return;
  }
  output(`${result.changed ? c.green('updated') : c.gray('unchanged')} ${result.displayPath} ${c.gray(`(${result.skills.length} skills)`)}`);
}

async function main(argv = process.argv.slice(2)) {
  const { flags, positional } = parseArgv(argv);
  if (flags.json) process.env.SKILLRIG_JSON = '1';
  if (flags.verbose) process.env.SKILLRIG_DEBUG = '1';
  if (bool(flags, 'quiet')) process.env.SKILLRIG_QUIET = '1';
  if (bool(flags, 'noColor') || bool(flags, 'color') === false) process.env.NO_COLOR = '1';
  const [rawCommand, ...rest] = positional;
  if (!rawCommand || flags.help && !rawCommand) {
    output(globalHelp());
    return;
  }
  const command = ALIASES[rawCommand] || rawCommand;
  if (flags.help) {
    const help = commandHelp(command);
    output(help || globalHelp());
    return;
  }
  if (command === 'version') {
    output(pkg.version);
    return;
  }
  if (!COMMANDS.includes(command)) {
    throw new UsageError(`Unknown command: ${rawCommand}. Run "skillrig --help".`);
  }
  const ctx = {
    flags,
    positional: rest,
    cwd: flags.cwd ? path.resolve(String(flags.cwd)) : process.cwd(),
    home: flags.home ? path.resolve(String(flags.home)) : os.homedir(),
  };
  const handlers = {
    search: cmdSearch,
    info: cmdInfo,
    install: cmdInstall,
    remove: cmdRemove,
    list: cmdList,
    update: cmdUpdate,
    doctor: cmdDoctor,
    scan: cmdScan,
    audit: cmdAudit,
    verify: cmdVerify,
    budget: cmdBudget,
    init: cmdInit,
    pack: cmdPack,
    publish: cmdPublish,
    migrate: cmdMigrate,
    targets: cmdTargets,
    sync: cmdSync,
    config: cmdConfig,
    completion: (context) => {
      const shell = context.positional[0];
      if (!shell) throw new UsageError('Usage: skillrig completion <bash|zsh|fish|powershell>');
      output(completionScript(shell));
    },
    mcp: async () => runMcpServer({ cwd: ctx.cwd, home: ctx.home }),
  };
  await handlers[command](ctx);
}

export { main, parseArgv, COMMANDS };
