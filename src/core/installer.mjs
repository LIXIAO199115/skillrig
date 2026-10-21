import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ensureDir,
  isSubPath,
  randomId,
  readTreeFromDir,
  safeRemoveDir,
  writeTree,
  displayPath,
  oneLine,
} from './util.mjs';
import { SkillRigError, SecurityError, UsageError } from './errors.mjs';
import { scanFiles, severityAtLeast, riskSummary } from './security.mjs';
import { resolveAgentSelection, agentSkillDir, listAgents } from './agents.mjs';
import {
  readLock,
  writeLock,
  installRecord,
  upsertSkill,
  removeInstallRecord,
  allLockEntries,
  verifyInstall,
  fileHashMap,
} from './lockfile.mjs';
import { parseSkill } from './manifest.mjs';
import { checkAgentsBlock } from './agentsmd.mjs';

export function resolveTargets({ agents, scope, cwd = process.cwd(), home = os.homedir() }) {
  const ids = Array.isArray(agents)
    ? agents
    : resolveAgentSelection(agents, { cwd, home, scope });
  const targets = [];
  const seen = new Map();
  for (const id of ids) {
    const { agent, dir } = agentSkillDir(id, scope, { cwd, home });
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key)) {
      targets[seen.get(key)].aliases.push(id);
      continue;
    }
    seen.set(key, targets.length);
    targets.push({ agent: id, agentName: agent.name, dir: path.resolve(dir), aliases: [] });
  }
  return targets;
}

function activeEntries({ cwd, home }) {
  return allLockEntries({ cwd, home });
}

function conflictsFor(skill, active, batchNames) {
  const conflicts = new Set([...(skill.manifest.conflicts || []), ...(batchNames || [])]);
  const issues = [];
  for (const item of active) {
    if (item.name === skill.manifest.name) continue;
    if (conflicts.has(item.name) || (item.entry.conflicts || []).includes(skill.manifest.name)) {
      issues.push(`${skill.manifest.name} conflicts with installed skill ${item.name}`);
    }
  }
  for (const name of skill.manifest.conflicts || []) {
    if (name !== skill.manifest.name && batchNames?.has(name)) {
      issues.push(`${skill.manifest.name} conflicts with ${name} in this batch`);
    }
  }
  return issues;
}

function assertSafeTarget(target, root, name) {
  const expected = path.join(root, name);
  if (path.resolve(target) !== path.resolve(expected)) {
    throw new SkillRigError(`Refusing to write outside the expected skill path: ${target}`, {
      code: 'ERR_UNSAFE_TARGET',
    });
  }
  if (!isSubPath(root, target)) {
    throw new SkillRigError(`Refusing to write outside ${root}`, { code: 'ERR_UNSAFE_TARGET' });
  }
}

function backupAndReplace(targetPath, skill) {
  const parent = path.dirname(targetPath);
  ensureDir(parent);
  const tmp = path.join(parent, `.skillrig-tmp-${path.basename(targetPath)}-${randomId(4)}`);
  ensureDir(tmp);
  writeTree(tmp, skill.files);
  let backup = null;
  if (fs.existsSync(targetPath)) {
    backup = path.join(parent, `.skillrig-backup-${path.basename(targetPath)}-${randomId(4)}`);
    fs.renameSync(targetPath, backup);
  }
  try {
    fs.renameSync(tmp, targetPath);
  } catch (error) {
    if (backup && fs.existsSync(backup)) {
      try {
        fs.renameSync(backup, targetPath);
      } catch {
        // keep original error
      }
    }
    safeRemoveDir(tmp, parent);
    throw error;
  }
  if (backup) safeRemoveDir(backup, parent);
}

export function installSkills(
  skills,
  {
    agents = null,
    scope = 'global',
    cwd = process.cwd(),
    home = os.homedir(),
    force = false,
    allowRisky = false,
    failOn = 'high',
    dryRun = false,
    logger = null,
  } = {},
) {
  const targets = resolveTargets({ agents, scope, cwd, home });
  if (targets.length === 0) throw new UsageError('No install targets resolved.');
  const active = activeEntries({ cwd, home });
  const batchNames = new Set(skills.map((skill) => skill.manifest.name));
  if (batchNames.size !== skills.length) {
    throw new UsageError('The same skill appears twice in one install batch.');
  }

  const plan = [];
  const results = [];

  for (const skill of skills) {
    const name = skill.manifest.name;
    const warnings = [...(skill.warnings || [])];
    const security = scanFiles(skill.files, { manifest: skill.manifest });
    const blocking = security.findings.filter((finding) => severityAtLeast(finding.severity, failOn));
    if (failOn !== 'none' && blocking.length > 0 && !allowRisky) {
      const summary = blocking
        .slice(0, 4)
        .map((finding) => `${finding.severity}/${finding.ruleId} ${finding.file}:${finding.line}`)
        .join(', ');
      throw new SecurityError(
        `Security scan blocked ${name} (${summary}). Review with "skillrig scan <source>" or re-run with --allow-risky.`,
        { findings: blocking, security },
      );
    }
    if (security.counts.medium > 0 && !allowRisky) {
      warnings.push(`${security.counts.medium} medium security finding(s); run "skillrig scan" for details`);
    }

    const conflictIssues = conflictsFor(skill, active, batchNames);
    if (conflictIssues.length > 0 && !force) {
      throw new UsageError(`${conflictIssues.join('; ')}. Use --force only if you intend to override.`);
    }
    if (conflictIssues.length > 0) warnings.push(...conflictIssues);

    const missingDeps = (skill.manifest.requires || []).filter(
      (dependency) => !active.some((item) => item.name === dependency) && !batchNames.has(dependency),
    );
    if (missingDeps.length > 0) {
      warnings.push(`Missing required skills: ${missingDeps.join(', ')}. Install them separately or use a pack.`);
    }

    const actions = [];
    for (const target of targets) {
      const targetPath = path.join(target.dir, name);
      assertSafeTarget(targetPath, target.dir, name);
      const lock = readLock(scope, { cwd, home });
      const owned = lock.skills[name]?.installs?.find(
        (install) => install.agent === target.agent && install.scope === scope,
      );
      const exists = fs.existsSync(targetPath);
      if (exists && !owned) {
        if (!force) {
          throw new UsageError(
            `${displayPath(targetPath, { cwd, home })} already exists and is not managed by SkillRig. Use --force to replace it.`,
          );
        }
        if (!fs.existsSync(path.join(targetPath, 'SKILL.md'))) {
          throw new UsageError(
            `Refusing to overwrite ${displayPath(targetPath, { cwd, home })}: it does not contain a SKILL.md.`,
          );
        }
      }
      if (owned && owned.path !== path.resolve(targetPath) && fs.existsSync(owned.path)) {
        actions.push({ target, targetPath, stalePath: owned.path });
      }
      if (owned && owned.integrity === skill.integrity && exists && !force) {
        actions.push({ target, targetPath, skip: true });
        continue;
      }
      if (owned && !force) {
        throw new UsageError(
          `${name} is already installed for ${target.agent}. Use --force to update or "skillrig update ${name}".`,
        );
      }
      actions.push({ target, targetPath, skip: false });
    }
    plan.push({ skill, security, warnings, actions });
  }

  if (dryRun) {
    return {
      dryRun: true,
      scope,
      targets: targets.map((target) => ({ agent: target.agent, path: target.dir })),
      results: plan.map(({ skill, security, warnings, actions }) => ({
        name: skill.manifest.name,
        version: skill.manifest.version,
        status: actions.every((action) => action.skip) ? 'skipped' : 'would-install',
        targets: actions.map((action) => ({
          agent: action.target.agent,
          scope,
          path: displayPath(action.targetPath, { cwd, home }),
          action: action.skip ? 'skip' : 'install',
        })),
        security: riskSummary(security),
        warnings,
      })),
    };
  }

  for (const item of plan) {
    const { skill, security, warnings, actions } = item;
    const records = [];
    const installedTargets = [];
    try {
      for (const action of actions) {
        if (action.skip) {
          const lock = readLock(scope, { cwd, home });
          const owned = lock.skills[skill.manifest.name]?.installs?.find(
            (install) => install.agent === action.target.agent && install.scope === scope,
          );
          if (owned) records.push(owned);
          installedTargets.push({ ...action, result: 'skipped' });
          continue;
        }
        backupAndReplace(action.targetPath, skill);
        if (action.stalePath && fs.existsSync(action.stalePath)) {
          const root = action.target.dir;
          if (isSubPath(root, action.stalePath) && fs.existsSync(path.join(action.stalePath, 'SKILL.md'))) {
            safeRemoveDir(action.stalePath, root);
          }
        }
        records.push(
          installRecord({
            skill,
            agent: action.target.agent,
            scope,
            targetPath: action.targetPath,
            aliases: action.target.aliases,
          }),
        );
        installedTargets.push({ ...action, result: 'installed' });
      }

      const lock = readLock(scope, { cwd, home });
      upsertSkill(lock, skill, records, {
        entryId: skill.entry?.id || null,
        security: riskSummary(security),
      });
      writeLock(lock, scope, { cwd, home });
      results.push({
        name: skill.manifest.name,
        version: skill.manifest.version,
        status: installedTargets.every((target) => target.result === 'skipped') ? 'skipped' : 'installed',
        targets: installedTargets.map((target) => ({
          agent: target.target.agent,
          agentName: target.target.agentName,
          scope,
          path: displayPath(target.targetPath, { cwd, home }),
          action: target.result,
        })),
        integrity: skill.integrity,
        security: riskSummary(security),
        warnings,
      });
      if (logger) {
        const status = results.at(-1).status;
        logger(
          `${status === 'skipped' ? 'skip' : 'install'} ${skill.manifest.name} -> ${installedTargets
            .map((target) => `${target.target.agent}:${displayPath(target.targetPath, { cwd, home })}`)
            .join(', ')}`,
        );
      }
    } catch (error) {
      for (const target of installedTargets) {
        if (target.result !== 'installed') continue;
        try {
          const root = target.target.dir;
          if (isSubPath(root, target.targetPath) && fs.existsSync(target.targetPath)) {
            safeRemoveDir(target.targetPath, root);
          }
        } catch {
          // best-effort rollback
        }
      }
      throw error;
    }
  }

  return { dryRun: false, scope, targets: targets.map((t) => ({ agent: t.agent, path: t.dir })), results };
}

export function uninstallSkills(
  names,
  {
    agents = null,
    scope = 'global',
    allScopes = false,
    cwd = process.cwd(),
    home = os.homedir(),
    force = false,
  } = {},
) {
  const wantedAgents = agents ? resolveAgentSelection(agents, { cwd, home, scope }) : null;
  const scopes = allScopes ? ['project', 'global'] : [scope];
  const removed = [];
  const notFound = [];

  for (const name of names) {
    let found = false;
    for (const currentScope of scopes) {
      const lock = readLock(currentScope, { cwd, home });
      const entry = lock.skills[name];
      if (!entry) continue;
      const targets = (entry.installs || []).filter(
        (install) => !wantedAgents || wantedAgents.includes(install.agent),
      );
      if (targets.length === 0) continue;
      for (const install of targets) {
        let root;
        try {
          root = agentSkillDir(install.agent, install.scope, { cwd, home }).dir;
        } catch {
          continue;
        }
        if (!isSubPath(root, install.path) || path.basename(install.path) !== name) {
          throw new SkillRigError(
            `Refusing to remove ${install.path}: it is outside the expected ${install.agent} skill directory.`,
            { code: 'ERR_UNSAFE_REMOVE' },
          );
        }
        if (fs.existsSync(install.path)) {
          if (!fs.existsSync(path.join(install.path, 'SKILL.md')) && !force) {
            throw new SkillRigError(
              `Refusing to remove ${install.path}: SKILL.md is missing. Use --force if this is intentional.`,
              { code: 'ERR_UNSAFE_REMOVE' },
            );
          }
          safeRemoveDir(install.path, root);
        }
        removed.push({
          name,
          agent: install.agent,
          scope: install.scope,
          path: displayPath(install.path, { cwd, home }),
        });
      }
      const remaining = (entry.installs || []).filter((install) => !targets.includes(install));
      if (remaining.length > 0) {
        lock.skills[name] = { ...entry, installs: remaining };
      } else {
        delete lock.skills[name];
      }
      writeLock(lock, currentScope, { cwd, home });
      found = true;
    }
    if (!found) notFound.push(name);
  }
  return { removed, notFound };
}

export function listInstalled({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const items = [];
  for (const scope of ['project', 'global']) {
    const lock = readLock(scope, { cwd, home });
    for (const [name, entry] of Object.entries(lock.skills)) {
      for (const install of entry.installs || []) {
        const verification = verifyInstall(install);
        items.push({
          name,
          version: entry.version,
          description: entry.description,
          agent: install.agent,
          scope,
          path: install.path,
          displayPath: displayPath(install.path, { cwd, home }),
          source: entry.source,
          integrity: entry.integrity,
          status: verification.status,
          installedAt: install.installedAt,
          verification,
        });
      }
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name) || a.agent.localeCompare(b.agent));
}

export function auditInstalled({ cwd = process.cwd(), home = os.homedir(), failOn = 'low' } = {}) {
  const items = [];
  for (const install of allLockEntries({ cwd, home })) {
    const dir = install.install.path;
    if (!fs.existsSync(dir)) continue;
    const { files } = readTreeFromDir(dir);
    const md = files.get('SKILL.md');
    const parsed = md ? parseSkill((md.data ?? md).toString('utf8'), { dirName: install.name }) : null;
    const result = scanFiles(files, { manifest: parsed?.manifest || null });
    const findings = result.findings.filter((finding) => severityAtLeast(finding.severity, failOn));
    items.push({
      name: install.name,
      agent: install.install.agent,
      scope: install.scope,
      path: dir,
      security: riskSummary(result),
      findings,
    });
  }
  return items;
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

export function contextBudget({ cwd = process.cwd(), home = os.homedir(), warnAtTokens = 1500 } = {}) {
  const byName = new Map();
  for (const item of allLockEntries({ cwd, home })) {
    if (byName.has(item.name)) continue;
    const skillFile = path.join(item.install.path, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const raw = fs.readFileSync(skillFile, 'utf8');
    const parsed = parseSkill(raw, { dirName: item.name });
    const alwaysOn = estimateTokens(`${parsed.manifest.name} ${parsed.manifest.description}`);
    const activation = estimateTokens(parsed.body);
    byName.set(item.name, {
      name: item.name,
      description: oneLine(parsed.manifest.description, 120),
      alwaysOnTokens: alwaysOn,
      activationTokens: activation,
      totalTokens: alwaysOn + activation,
      agent: item.install.agent,
      scope: item.scope,
    });
  }
  const entries = [...byName.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  const totals = entries.reduce(
    (sum, entry) => ({
      alwaysOnTokens: sum.alwaysOnTokens + entry.alwaysOnTokens,
      activationTokens: sum.activationTokens + entry.activationTokens,
      totalTokens: sum.totalTokens + entry.totalTokens,
    }),
    { alwaysOnTokens: 0, activationTokens: 0, totalTokens: 0 },
  );
  const warnings = [];
  if (entries.length > 0 && totals.alwaysOnTokens > warnAtTokens) {
    warnings.push(
      `Always-on skill metadata is ~${totals.alwaysOnTokens} tokens across ${entries.length} skills; trim descriptions or remove unused skills.`,
    );
  }
  if (entries.length > 40) {
    warnings.push(`${entries.length} skills installed. Most agents load every description into context; consider packs.`);
  }
  return { entries, totals, warnings, warnAtTokens };
}

export function doctorReport({ cwd = process.cwd(), home = os.homedir(), agents = null } = {}) {
  const issues = [];
  const entries = allLockEntries({ cwd, home });
  const knownPaths = new Set();
  for (const item of entries) {
    knownPaths.add(path.resolve(item.install.path).toLowerCase());
    const verification = verifyInstall(item.install);
    if (verification.status === 'missing') {
      issues.push({
        severity: 'error',
        code: 'missing',
        message: `${item.name} is recorded in the ${item.scope} lock but missing at ${displayPath(item.install.path, { cwd, home })}`,
      });
    } else if (verification.status === 'modified') {
      issues.push({
        severity: 'warning',
        code: 'drift',
        message: `${item.name} has local changes (${[
          ...verification.changed,
          ...verification.missing,
        ].slice(0, 4).join(', ')}${verification.extra.length ? `, ${verification.extra.length} extra file(s)` : ''})`,
        detail: verification,
      });
    }
    const missingDeps = (item.entry.requires || []).filter((dependency) => !entries.some((other) => other.name === dependency));
    if (missingDeps.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'missing-dependency',
        message: `${item.name} requires ${missingDeps.join(', ')} but it is not installed`,
      });
    }
  }

  const names = new Map();
  for (const item of entries) {
    if (!names.has(item.name)) names.set(item.name, new Set());
    names.get(item.name).add(item.entry.integrity);
  }
  for (const [name, hashes] of names) {
    if (hashes.size > 1) {
      issues.push({
        severity: 'warning',
        code: 'version-skew',
        message: `${name} is installed at different versions across agents or scopes`,
      });
    }
  }

  const roots = new Map();
  for (const agent of listAgents()) {
    if (agents && !agents.includes(agent.id)) continue;
    for (const scope of ['project', 'global']) {
      try {
        const { dir } = agentSkillDir(agent.id, scope, { cwd, home });
        if (!roots.has(dir)) roots.set(dir, { agent: agent.id, scope, dir });
      } catch {
        // not supported
      }
    }
  }
  const unmanaged = [];
  for (const { agent, scope, dir } of roots.values()) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (!fs.existsSync(path.join(full, 'SKILL.md'))) continue;
      if (!knownPaths.has(path.resolve(full).toLowerCase())) {
        unmanaged.push({ agent, scope, name: entry.name, path: displayPath(full, { cwd, home }) });
      }
    }
  }
  if (unmanaged.length > 0) {
    issues.push({
      severity: 'info',
      code: 'unmanaged',
      message: `${unmanaged.length} skill director${unmanaged.length === 1 ? 'y is' : 'ies are'} present but not tracked by SkillRig`,
      detail: unmanaged.slice(0, 30),
    });
  }

  let agentsBlock = null;
  try {
    agentsBlock = checkAgentsBlock(entries, { cwd });
    if (agentsBlock.exists && !agentsBlock.synced) {
      issues.push({
        severity: 'info',
        code: 'agents-md-stale',
        message: 'AGENTS.md skill block is out of date. Run "skillrig sync" to update it.',
      });
    }
  } catch {
    // ignore
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    installs: entries.length,
    skills: names.size,
    unmanaged,
    agentsBlock,
  };
}
