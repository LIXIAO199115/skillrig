import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, readTreeFromDir, treeHash, canonicalJson, oneLine } from './util.mjs';
import { SkillRigError, UsageError, IntegrityError } from './errors.mjs';
import { parseSkill } from './manifest.mjs';
import { readTarGz, writeTarGz } from './tar.mjs';
import { githubCommit, githubTarball } from './net.mjs';
import { getPack, getSkillsByName } from './registry.mjs';
import { isValidSemver } from './semver.mjs';

const MAX_SKILL_FILES = 400;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const REF_LIKE = /^(?:[0-9a-f]{7,40}|v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|main|master|HEAD|latest|trunk|develop)$/i;
const SKIP_DIR_RE = /(^|\/)(node_modules|\.git|\.github|test|tests|__tests__|fixtures?|vendor)\//i;

export function discoverSkillDirs(files) {
  const dirs = new Set();
  for (const file of files.keys()) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized !== 'SKILL.md' && !normalized.endsWith('/SKILL.md')) continue;
    if (SKIP_DIR_RE.test(normalized)) continue;
    const dir = normalized === 'SKILL.md' ? '.' : normalized.slice(0, -'/SKILL.md'.length);
    dirs.add(dir);
  }
  return [...dirs].sort();
}

export function filesInDir(files, dir) {
  const prefix = dir === '.' ? '' : `${dir.replace(/\/$/, '')}/`;
  const result = new Map();
  for (const [file, value] of files) {
    const normalized = file.replace(/\\/g, '/');
    if (prefix && !normalized.startsWith(prefix)) continue;
    const rel = normalized.slice(prefix.length);
    if (!rel) continue;
    const data = value.data ?? value;
    if (data.length > MAX_FILE_BYTES) continue;
    if (result.size >= MAX_SKILL_FILES) break;
    result.set(rel, value);
  }
  return result;
}

export function buildSkillFromFiles({
  files,
  dir,
  source,
  expectedIntegrity = null,
  allowInvalid = false,
  origin = null,
}) {
  const skillFiles = filesInDir(files, dir);
  const skillMd = skillFiles.get('SKILL.md');
  if (!skillMd) {
    throw new SkillRigError(`No SKILL.md found in ${dir || '.'}`, { code: 'ERR_NO_SKILL_MD' });
  }
  const hash = treeHash(skillFiles);
  if (expectedIntegrity && expectedIntegrity !== hash) {
    throw new IntegrityError(
      `Integrity mismatch${dir !== '.' ? ` for ${dir}` : ''}: expected ${expectedIntegrity}, got ${hash}`,
      { expected: expectedIntegrity, actual: hash },
    );
  }
  const raw = (skillMd.data ?? skillMd).toString('utf8');
  const parsed = parseSkill(raw, { dirName: dir === '.' ? null : path.basename(dir) });
  if (parsed.errors.length > 0) {
    if (allowInvalid) return null;
    throw new SkillRigError(
      `Invalid skill${dir !== '.' ? ` at ${dir}` : ''}: ${parsed.errors.join('; ')}`,
      { code: 'ERR_INVALID_SKILL', details: { warnings: parsed.warnings, dir } },
    );
  }
  return {
    manifest: parsed.manifest,
    body: parsed.body,
    raw,
    rawFrontmatter: parsed.rawFrontmatter,
    warnings: parsed.warnings,
    errors: parsed.errors,
    files: skillFiles,
    integrity: hash,
    treeHash: hash,
    source,
    origin: origin || sourceLabel(source),
    bodyBytes: parsed.bodyBytes,
    bodyLines: parsed.bodyLines,
  };
}

export function sourceLabel(source) {
  if (!source) return 'unknown';
  if (source.type === 'bundled') return 'skillrig';
  if (source.type === 'github') return `${source.repo}${source.path && source.path !== '.' ? `/${source.path}` : ''}`;
  if (source.type === 'local') return source.path;
  if (source.type === 'bundle') return source.file;
  return source.type;
}

export function parseSourceSpec(spec, { cwd = process.cwd(), index = null } = {}) {
  const raw = String(spec).trim();
  if (!raw) throw new UsageError('Empty skill source');

  if (raw.startsWith('pack/') || raw.startsWith('pack:')) {
    return { type: 'pack', name: raw.replace(/^pack[:/]/, '') };
  }

  const localCandidate = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  if (
    raw.startsWith('.') ||
    raw.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.startsWith('file:') ||
    fs.existsSync(localCandidate)
  ) {
    const file = raw.startsWith('file:') ? raw.slice(5) : localCandidate;
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (stat.isFile() && /\.(skm|tgz|tar\.gz)$/i.test(file)) return { type: 'bundle', file };
      if (stat.isFile() && path.basename(file) === 'SKILL.md') return { type: 'local', path: path.dirname(file) };
      if (stat.isDirectory()) return { type: 'local', path: file };
    }
    if (raw.startsWith('.') || raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
      throw new UsageError(`Local path not found: ${file}`);
    }
  }

  const urlMatch = raw.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/\s#?]+)(?:\/([^\s#?]+))?)?\/?$/i,
  );
  if (urlMatch) {
    return {
      type: 'github',
      repo: `${urlMatch[1]}/${urlMatch[2]}`,
      ref: urlMatch[3] || null,
      path: urlMatch[4] ? decodeURIComponent(urlMatch[4]).replace(/\/$/, '') : null,
      skill: null,
      original: raw,
    };
  }

  const at = raw.lastIndexOf('@');
  let base = at > 0 ? raw.slice(0, at) : raw;
  const suffix = at > 0 ? raw.slice(at + 1) : null;
  base = base.replace(/\.git$/, '');

  const parts = base.split('/').filter(Boolean);
  if (parts.length >= 2 && !base.startsWith('@')) {
    const repo = `${parts[0]}/${parts[1]}`;
    const subpath = parts.slice(2).join('/') || null;
    let ref = null;
    let skill = null;
    if (suffix) {
      if (REF_LIKE.test(suffix)) ref = suffix;
      else skill = suffix;
    }
    return { type: 'github', repo, ref, path: subpath, skill, original: raw };
  }

  if (index) {
    let name = raw;
    let wantedVersion = null;
    if (suffix && isValidSemver(suffix)) {
      name = base;
      wantedVersion = suffix;
    }
    const matches = getSkillsByName(index, name);
    if (matches.length > 0) {
      const entry =
        matches.sort(
          (a, b) => Number(b.verified) - Number(a.verified) || (b.quality?.score || 0) - (a.quality?.score || 0),
        )[0];
      if (wantedVersion && entry.version !== wantedVersion) {
        throw new UsageError(
          `Registry has ${entry.name}@${entry.version}, not @${wantedVersion}. Run "skillrig info ${entry.name}" for details.`,
        );
      }
      return { type: 'registry', name: entry.name, entry, original: raw };
    }
  }

  if (raw.includes('/')) {
    throw new UsageError(
      `Could not resolve "${raw}". Use owner/repo, owner/repo@skill, a local path, or a registry skill name.`,
    );
  }

  const suggestions = index
    ? (index.skills || [])
        .filter((skill) => skill.name.includes(raw.toLowerCase()) || skill.name.startsWith(raw.toLowerCase().slice(0, 3)))
        .slice(0, 5)
        .map((skill) => skill.name)
    : [];
  throw new UsageError(
    `Skill "${raw}" is not in the registry${suggestions.length ? `. Did you mean: ${suggestions.join(', ')}?` : '.'} Run "skillrig search ${raw}" to look for it.`,
  );
}

function selectCandidate(candidates, selector, { repo } = {}) {
  if (!selector) return candidates;
  const needle = selector.toLowerCase();
  return candidates.filter(
    (candidate) => candidate.name.toLowerCase() === needle || candidate.dir.toLowerCase() === needle,
  );
}

export async function loadGithub({
  repo,
  ref = null,
  subpath = null,
  skill = null,
  all = false,
  expectedIntegrity = null,
  token = undefined,
  noCache = false,
  allowInvalid = false,
}) {
  const commit = await githubCommit(repo, ref, { token });
  const tarball = await githubTarball(repo, commit, { token, noCache });
  const files = readTarGz(tarball, { stripTopLevel: true });
  let dirs = discoverSkillDirs(files);
  if (subpath) {
    const clean = subpath.replace(/^\/+|\/+$/g, '').replace(/\/SKILL\.md$/i, '');
    dirs = dirs.filter((dir) => dir === clean || dir.startsWith(`${clean}/`));
    if (dirs.length === 0) {
      throw new UsageError(`No SKILL.md found under ${repo}/${subpath}`);
    }
  }

  const candidates = [];
  for (const dir of dirs) {
    const skillMd = filesInDir(files, dir).get('SKILL.md');
    if (!skillMd) continue;
    const parsed = parseSkill((skillMd.data ?? skillMd).toString('utf8'), {
      dirName: path.basename(dir === '.' ? repo.split('/')[1] : dir),
    });
    const name = parsed.manifest.name || path.basename(dir);
    candidates.push({ dir, name, parsed, errors: parsed.errors });
  }

  let selected = selectCandidate(candidates, skill);
  if (skill && selected.length === 0) {
    throw new UsageError(
      `Skill "${skill}" was not found in ${repo}. Available: ${candidates
        .slice(0, 25)
        .map((candidate) => candidate.name)
        .join(', ')}${candidates.length > 25 ? ', …' : ''}`,
    );
  }
  if (selected.length > 1 && !all) {
    throw new UsageError(
      `${repo} contains ${selected.length} skills. Pick one with --skill, or install all with --all:\n  ${selected
        .slice(0, 30)
        .map((candidate) => candidate.name)
        .join('\n  ')}`,
    );
  }
  if (selected.length === 0) selected = candidates;
  if (selected.length === 0) throw new SkillRigError(`No installable skills found in ${repo}`);

  const skills = [];
  for (const candidate of selected) {
    const built = buildSkillFromFiles({
      files,
      dir: candidate.dir,
      source: {
        type: 'github',
        repo,
        ref: commit,
        path: candidate.dir,
        url: `https://github.com/${repo}/tree/${commit}/${candidate.dir === '.' ? '' : candidate.dir}`,
      },
      expectedIntegrity: selected.length === 1 ? expectedIntegrity : null,
      allowInvalid,
      origin: `${repo}${candidate.dir === '.' ? '' : `/${candidate.dir}`}`,
    });
    if (built) skills.push(built);
  }
  if (skills.length === 0) {
    throw new SkillRigError(`No valid skills found in ${repo}${skill ? ` matching "${skill}"` : ''}`);
  }
  return { skills, commit, repo, candidates };
}

export function loadLocal(dir, { skill = null, all = false, expectedIntegrity = null } = {}) {
  const absolute = path.resolve(dir);
  if (!fs.existsSync(absolute)) throw new UsageError(`Path not found: ${dir}`);
  const skillFile = path.join(absolute, 'SKILL.md');
  if (fs.existsSync(skillFile)) {
    const { files, warnings } = readTreeFromDir(absolute);
    const built = buildSkillFromFiles({
      files,
      dir: '.',
      source: { type: 'local', path: absolute },
      expectedIntegrity,
      origin: absolute,
    });
    built.warnings.push(...warnings);
    return { skills: [built], absolute };
  }

  const candidates = new Map();
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const child = path.join(absolute, entry.name);
    if (fs.existsSync(path.join(child, 'SKILL.md'))) candidates.set(entry.name, child);
    const nested = path.join(child, 'skills');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
      for (const nestedEntry of fs.readdirSync(nested, { withFileTypes: true })) {
        if (!nestedEntry.isDirectory()) continue;
        const nestedSkill = path.join(nested, nestedEntry.name);
        if (fs.existsSync(path.join(nestedSkill, 'SKILL.md'))) candidates.set(nestedEntry.name, nestedSkill);
      }
    }
  }
  if (candidates.size === 0) throw new UsageError(`No SKILL.md found in ${absolute} or its immediate subdirectories.`);
  const selected = skill ? [...candidates.entries()].filter(([name]) => name === skill) : [...candidates.entries()];
  if (skill && selected.length === 0) {
    throw new UsageError(`Skill "${skill}" not found in ${absolute}. Available: ${[...candidates.keys()].join(', ')}`);
  }
  if (selected.length > 1 && !all) {
    throw new UsageError(
      `${absolute} contains ${selected.length} skills. Pick one with --skill or use --all:\n  ${[...candidates.keys()].join('\n  ')}`,
    );
  }
  const skills = selected.map(([name, child]) => {
    const { files, warnings } = readTreeFromDir(child);
    const built = buildSkillFromFiles({
      files,
      dir: '.',
      source: { type: 'local', path: child },
      expectedIntegrity: selected.length === 1 ? expectedIntegrity : null,
      origin: child,
    });
    built.warnings.push(...warnings, ...(built.manifest.name !== name ? [`Folder ${name} does not match name ${built.manifest.name}`] : []));
    return built;
  });
  return { skills, absolute };
}

export function loadBundled(name, { expectedIntegrity = null } = {}) {
  const dir = path.join(PACKAGE_ROOT, 'skills', name);
  if (!fs.existsSync(dir)) {
    throw new SkillRigError(`Bundled skill not found: ${name}`, { code: 'ERR_BUNDLED_SKILL' });
  }
  const { files, warnings } = readTreeFromDir(dir);
  const built = buildSkillFromFiles({
    files,
    dir: '.',
    source: { type: 'bundled', path: `skills/${name}`, ref: 'bundled' },
    expectedIntegrity,
    origin: `skillrig/${name}`,
  });
  built.warnings.push(...warnings);
  return { skills: [built] };
}

export async function loadRegistryEntry(entry, { all = false, repo = null } = {}) {
  if (entry.source?.type === 'bundled') {
    return loadBundled(entry.name, { expectedIntegrity: entry.integrity });
  }
  if (entry.source?.type === 'github') {
    const result = await loadGithub({
      repo: entry.source.repo,
      ref: entry.source.ref,
      subpath: entry.source.path,
      all,
      expectedIntegrity: entry.integrity,
    });
    for (const skill of result.skills) skill.entry = entry;
    return result;
  }
  throw new SkillRigError(`Unsupported registry source for ${entry.name}: ${entry.source?.type}`, {
    code: 'ERR_REGISTRY_SOURCE',
  });
}

export function loadBundle(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) throw new UsageError(`Bundle not found: ${file}`);
  const files = readTarGz(fs.readFileSync(absolute), { stripTopLevel: false });
  const manifestFile = files.get('skillrig-bundle.json');
  if (!manifestFile) throw new IntegrityError('Bundle is missing skillrig-bundle.json');
  const manifest = JSON.parse((manifestFile.data ?? manifestFile).toString('utf8'));
  const skills = [];
  for (const record of manifest.skills || []) {
    const dir = record.path || `skills/${record.name}`;
    const built = buildSkillFromFiles({
      files,
      dir,
      source: { type: 'bundle', file: absolute },
      expectedIntegrity: record.integrity,
      origin: `${path.basename(absolute)}:${record.name}`,
    });
    built.bundle = manifest;
    skills.push(built);
  }
  if (skills.length === 0) throw new IntegrityError('Bundle contains no skills');
  return { skills, bundle: manifest, absolute };
}

export function buildBundle(skills, { name, version = '1.0.0', publisher = null, signature = null } = {}) {
  const manifestSkills = skills.map((skill) => ({
    name: skill.manifest.name,
    version: skill.manifest.version || '0.0.0',
    path: `skills/${skill.manifest.name}`,
    integrity: skill.integrity,
    description: oneLine(skill.manifest.description, 300),
    source: skill.source,
  }));
  const manifest = {
    schemaVersion: 1,
    name: name || (skills.length === 1 ? skills[0].manifest.name : 'skillrig-bundle'),
    version,
    createdAt: new Date().toISOString(),
    publisher,
    skills: manifestSkills,
  };
  if (signature) {
    manifest.signature = signature;
    manifest.signed = true;
  }
  const files = new Map();
  files.set('skillrig-bundle.json', { data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), mode: 0o644 });
  for (const skill of skills) {
    const dir = `skills/${skill.manifest.name}`;
    for (const [rel, file] of skill.files) {
      files.set(`${dir}/${rel}`, file);
    }
  }
  return { files, manifest, data: writeTarGz(files) };
}

export function bundleSigningPayload(manifest) {
  const copy = { ...manifest };
  delete copy.signature;
  delete copy.signed;
  return Buffer.from(canonicalJson(copy));
}

export async function loadSpec(
  spec,
  { index = null, cwd = process.cwd(), all = false, skill = null, ref = null, token = undefined, noCache = false } = {},
) {
  const parsed = parseSourceSpec(spec, { cwd, index });
  if (ref) parsed.ref = ref;
  if (skill) parsed.skill = skill;

  if (parsed.type === 'pack') {
    if (!index) throw new UsageError('Packs require the registry');
    const pack = getPack(index, parsed.name);
    if (!pack) throw new UsageError(`Pack not found: ${parsed.name}`);
    const skills = [];
    for (const name of pack.skills || []) {
      const matches = getSkillsByName(index, name);
      if (matches.length === 0) throw new SkillRigError(`Pack ${pack.name} references missing skill ${name}`);
      const result = await loadRegistryEntry(matches[0]);
      skills.push(...result.skills);
    }
    return { skills, pack, parsed };
  }
  if (parsed.type === 'registry') {
    const result = await loadRegistryEntry(parsed.entry, { all });
    for (const skill of result.skills) skill.entry = parsed.entry;
    return { ...result, parsed };
  }
  if (parsed.type === 'github') {
    const result = await loadGithub({ ...parsed, all, token, noCache });
    return { ...result, parsed };
  }
  if (parsed.type === 'local') {
    const result = loadLocal(parsed.path, { skill: parsed.skill, all });
    return { ...result, parsed };
  }
  if (parsed.type === 'bundle') {
    const result = loadBundle(parsed.file);
    return { ...result, parsed };
  }
  throw new UsageError(`Unsupported source: ${spec}`);
}

export function describeCandidates(candidates, { repo = null } = {}) {
  return candidates
    .slice(0, 30)
    .map((candidate) => `  ${candidate.name}${candidate.description ? ` — ${oneLine(candidate.description, 100)}` : ''}`)
    .join('\n');
}
