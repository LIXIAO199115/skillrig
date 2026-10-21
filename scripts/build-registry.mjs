#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PACKAGE_ROOT, readTreeFromDir, packageInfo } from '../src/core/util.mjs';
import { buildSkillFromFiles } from '../src/core/source.mjs';
import { scoreQuality } from '../src/core/quality.mjs';
import { scanFiles } from '../src/core/security.mjs';
import { registryIndexEntry, signRegistry } from '../src/core/registry.mjs';
import { licenseStatusFor } from '../src/core/license.mjs';

const ROOT = PACKAGE_ROOT;
const SKILLS_DIR = path.join(ROOT, 'skills');
const PACKS_DIR = path.join(ROOT, 'packs');
const DEFAULT_UPSTREAM = path.join(ROOT, 'registry', 'upstream.json');
const DEFAULT_INDEX = path.join(ROOT, 'registry', 'index.json');
const SIG_PATH = path.join(ROOT, 'registry', 'index.json.sig');
const PUBLIC_KEY_PATH = path.join(ROOT, 'registry', 'keys', 'skillrig.pub.pem');
const DEFAULT_KEY = path.join(os.homedir(), '.skillrig', 'keys', 'skillrig.private.pem');

function flags(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function curatedSkills() {
  const dirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const skills = [];
  for (const name of dirs) {
    const dir = path.join(SKILLS_DIR, name);
    const { files, warnings } = readTreeFromDir(dir);
    const source = {
      type: 'bundled',
      repo: 'skillrig',
      branch: 'main',
      ref: 'main',
      path: `skills/${name}`,
      url: `https://github.com/LIXIAO199115/skillrig/tree/main/skills/${name}`,
    };
    const skill = buildSkillFromFiles({ files, dir: '.', source });
    if (skill.manifest.name !== name) {
      throw new Error(`Folder ${name} does not match frontmatter name ${skill.manifest.name}`);
    }
    const quality = scoreQuality({ manifest: skill.manifest, body: skill.body, files: skill.files });
    const security = scanFiles(skill.files, { manifest: skill.manifest });
    const entry = registryIndexEntry({
      manifest: skill.manifest,
      treeHash: skill.integrity,
      source,
      quality,
      security,
      verified: true,
      updatedAt: null,
      bodyBytes: skill.bodyBytes,
      bodyLines: skill.bodyLines,
      files: skill.files.size,
      trust: 'official',
      licenseStatus: licenseStatusFor(skill.manifest.license),
    });
    if (warnings.length) entry.warnings = warnings;
    skills.push(entry);
  }
  return skills;
}

function upstreamSkills(file) {
  const upstream = readJson(file, null);
  if (!upstream) return { skills: [], sources: [] };
  const skills = (upstream.skills || []).map((entry) => ({
    ...entry,
    id: entry.id || `${entry.source?.repo || 'skillrig'}::${entry.name}`,
    licenseStatus: licenseStatusFor(entry.license),
    trust: entry.trust || 'community',
    blocked: Boolean(entry.blocked),
    source: {
      ...entry.source,
      branch: entry.source?.branch || entry.source?.ref?.slice(0, 7) || 'main',
    },
  }));
  return { skills, sources: (upstream.sources || []).map((source) => ({ ...source, licenseStatus: licenseStatusFor(source.license) })), generatedAt: upstream.generatedAt };
}

function packs(skillNames) {
  if (!fs.existsSync(PACKS_DIR)) return [];
  const available = new Set(skillNames);
  return fs
    .readdirSync(PACKS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const pack = readJson(path.join(PACKS_DIR, file), null);
      if (!pack) return null;
      const missing = (pack.skills || []).filter((name) => !available.has(name));
      if (missing.length) throw new Error(`Pack ${pack.name} references unknown skills: ${missing.join(', ')}`);
      return {
        id: `skillrig::pack:${pack.name}`,
        name: pack.name,
        title: pack.title || pack.name,
        version: pack.version || '1.0.0',
        description: pack.description || '',
        skills: pack.skills || [],
        tags: pack.tags || [],
        verified: true,
      };
    })
    .filter(Boolean);
}

function main() {
  const opts = flags(process.argv.slice(2));
  const upstreamPath = opts.upstream ? path.resolve(String(opts.upstream)) : DEFAULT_UPSTREAM;
  const outPath = opts.out ? path.resolve(String(opts.out)) : DEFAULT_INDEX;
  const keyPath = opts.key ? path.resolve(String(opts.key)) : DEFAULT_KEY;
  const noSign = Boolean(opts['no-sign']);

  const curated = curatedSkills();
  const { skills: upstream, sources } = upstreamSkills(upstreamPath);
  const allNames = new Set([...curated, ...upstream].filter((skill) => !skill.blocked).map((skill) => skill.name));
  const packList = packs(allNames);

  const curatedNames = new Set(curated.map((skill) => skill.name));
  const shadowed = upstream.filter((skill) => curatedNames.has(skill.name)).length;
  const skills = [...curated.sort((a, b) => a.name.localeCompare(b.name)), ...upstream.sort((a, b) => a.name.localeCompare(b.name))];

  const index = {
    schemaVersion: 1,
    name: 'skillrig',
    version: packageInfo().version,
    generatedAt: new Date().toISOString(),
    upstreamGeneratedAt: readJson(upstreamPath, {}).generatedAt || null,
    counts: {
      skills: skills.length,
      curated: curated.length,
      upstream: upstream.length,
      packs: packList.length,
      blocked: skills.filter((skill) => skill.blocked).length,
      verified: skills.filter((skill) => skill.verified).length,
      sources: sources.filter((source) => source.enabled !== false && !source.error && (source.skills ?? 0) > 0).length,
      shadowed,
    },
    sources: sources
      .filter((source) => source.enabled !== false && (source.skills ?? 0) > 0)
      .map((source) => ({
        repo: source.repo,
        trust: source.trust || 'community',
        branch: source.branch || null,
        commit: source.commit || null,
        license: source.license || null,
        licenseStatus: licenseStatusFor(source.license),
        skills: source.skills ?? source.skillCount ?? null,
        blocked: source.blocked ?? null,
        skipped: source.skipped ?? null,
        error: source.error || null,
      })),
    skills,
    packs: packList,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`);

  let signature = null;
  if (!noSign) {
    if (fs.existsSync(keyPath)) {
      const signaturePath = outPath === DEFAULT_INDEX ? SIG_PATH : `${outPath}.sig`;
      signature = signRegistry({ indexPath: outPath, signaturePath, privateKey: keyPath });
    } else {
      console.warn(`No signing key at ${keyPath}; registry written unsigned. Run "npm run sign -- --generate" first.`);
    }
  }

  const avgQuality = skills.length
    ? Math.round(skills.reduce((sum, skill) => sum + (skill.quality?.score || 0), 0) / skills.length)
    : 0;
  console.log(
    `Registry: ${skills.length} skills (${curated.length} curated, ${upstream.length} upstream, ` +
      `${skills.filter((skill) => skill.blocked).length} blocked), ${packList.length} packs.`,
  );
  console.log(`Average quality: ${avgQuality}/100. Sources: ${index.counts.sources}. Shadowed names: ${shadowed}.`);
  console.log(`Wrote ${path.relative(ROOT, outPath)}${signature ? ` and signed with ${signature.keyId}` : ''}.`);
  if (signature) console.log(`Signature: ${path.relative(ROOT, outPath === DEFAULT_INDEX ? SIG_PATH : `${outPath}.sig`)}`);
  if (!fs.existsSync(PUBLIC_KEY_PATH) && fs.existsSync(DEFAULT_KEY)) {
    console.warn('Public key missing at registry/keys/skillrig.pub.pem; run "npm run sign" to export it.');
  }
}

main();
