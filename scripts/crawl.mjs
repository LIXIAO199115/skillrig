#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  globToRegExp,
  oneLine,
  treeHash,
} from '../src/core/util.mjs';
import { githubHeaders, githubToken, githubRepoInfo, githubCommit, githubTarball } from '../src/core/net.mjs';
import { readTarGz } from '../src/core/tar.mjs';
import { buildSkillFromFiles } from '../src/core/source.mjs';
import { scoreQuality } from '../src/core/quality.mjs';
import { scanFiles, riskSummary } from '../src/core/security.mjs';
import { licenseStatusFor } from '../src/core/license.mjs';

const SOURCES_PATH = path.join(PACKAGE_ROOT, 'registry', 'sources.json');
const OUTPUT_PATH = path.join(PACKAGE_ROOT, 'registry', 'upstream.json');
const args = process.argv.slice(2);
const only = args.filter((arg) => arg.startsWith('--repo=')).map((arg) => arg.split('=')[1]);
const dryRun = args.includes('--dry-run');
const merge = args.includes('--merge');
const defaultMinQuality = Number((args.find((arg) => arg.startsWith('--min-quality=')) || '').split('=')[1] || 55);
const maxFiles = 60;
const maxFileBytes = 1024 * 1024;
const maxSkillBytes = 8 * 1024 * 1024;
const maxTarBytes = Number((args.find((arg) => arg.startsWith('--max-tar-bytes=')) || '').split('=')[1] || 512 * 1024 * 1024);
const maxTarEntries = Number((args.find((arg) => arg.startsWith('--max-tar-entries=')) || '').split('=')[1] || 80000);
const SKIP_PATH = /(^|\/)(node_modules|\.git|test|tests|__tests__|fixtures?|vendor|dist|build|target)\//i;
const TRUST_RANK = { official: 3, verified: 2, community: 1 };

function log(message) {
  process.stdout.write(`${message}\n`);
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function better(candidate, current) {
  const left = [
    candidate.entry.blocked ? 0 : 1,
    TRUST_RANK[candidate.entry.trust] || 0,
    candidate.entry.quality.score,
    candidate.entry.security.score,
    candidate.entry.bodyBytes,
  ];
  const right = [
    current.entry.blocked ? 0 : 1,
    TRUST_RANK[current.entry.trust] || 0,
    current.entry.quality.score,
    current.entry.security.score,
    current.entry.bodyBytes,
  ];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function skillDirsFromFiles(files, source) {
  const include = (source.include || []).map(globToRegExp);
  const exclude = (source.exclude || []).map(globToRegExp);
  const dirs = new Set();
  for (const filePath of files.keys()) {
    if (filePath !== 'SKILL.md' && !filePath.endsWith('/SKILL.md')) continue;
    if (SKIP_PATH.test(filePath)) continue;
    const dir = filePath === 'SKILL.md' ? '.' : filePath.slice(0, -'/SKILL.md'.length);
    if (include.length > 0 && !include.some((rule) => rule.test(dir))) continue;
    if (exclude.some((rule) => rule.test(dir))) continue;
    dirs.add(dir);
  }
  return [...dirs].sort();
}

function filesForDir(files, dir) {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const selected = new Map();
  let bytes = 0;
  for (const [filePath, file] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!filePath.startsWith(prefix)) continue;
    const rel = filePath.slice(prefix.length);
    if (!rel) continue;
    if (rel !== 'SKILL.md' && rel.endsWith('/SKILL.md')) continue;
    if (SKIP_PATH.test(rel)) continue;
    if (file.data.length > maxFileBytes) continue;
    if (selected.size >= maxFiles) break;
    if (bytes + file.data.length > maxSkillBytes) continue;
    selected.set(rel, file);
    bytes += file.data.length;
  }
  return selected;
}

async function crawlSource(source, { curatedNames, seenHashes, best, stats }) {
  const repo = source.repo;
  const info = await githubRepoInfo(repo);
  const branch = info.default_branch;
  const commit = await githubCommit(repo, branch);
  const license = info.license?.spdx_id || null;
  const licenseStatus = licenseStatusFor(license);
  const tarball = await githubTarball(repo, commit, {
    noCache: true,
    persist: false,
    timeout: 240000,
  });
  let files;
  try {
    files = readTarGz(tarball, {
      stripTopLevel: true,
      maxEntries: maxTarEntries,
      maxTotal: maxTarBytes,
    });
  } catch (error) {
    throw new Error(`archive rejected (${error.message}); ${(tarball.length / 1024 / 1024).toFixed(1)} MB downloaded`);
  }
  const dirs = skillDirsFromFiles(files, source);
  const minQuality = Number(source.minQuality ?? defaultMinQuality);
  const maxSkills = Number(source.maxSkills ?? 5000);
  log(
    `  ${repo}@${branch.slice(0, 12)} ${commit.slice(0, 7)}: ${dirs.length} skill dir(s), ` +
      `${files.size} files, ${(tarball.length / 1024 / 1024).toFixed(1)} MB, license ${license || 'none'}`,
  );

  let skipped = 0;
  let blocked = 0;
  let candidates = 0;
  const perSource = new Map();
  for (const dir of dirs) {
    const selected = filesForDir(files, dir);
    if (!selected.has('SKILL.md')) {
      skipped += 1;
      continue;
    }
    let skill;
    try {
      skill = buildSkillFromFiles({
        files: selected,
        dir: '.',
        source: {
          type: 'github',
          repo,
          ref: commit,
          branch,
          path: dir,
          url: `https://github.com/${repo}/tree/${commit}/${dir === '.' ? '' : dir}`,
        },
        allowInvalid: true,
        origin: `${repo}/${dir}`,
      });
    } catch {
      skipped += 1;
      continue;
    }
    if (!skill) {
      skipped += 1;
      continue;
    }
    if (curatedNames.has(skill.manifest.name)) {
      skipped += 1;
      continue;
    }
    if (seenHashes.has(skill.integrity)) {
      skipped += 1;
      continue;
    }
    const quality = scoreQuality({ manifest: skill.manifest, body: skill.body, files: skill.files });
    if (quality.score < minQuality) {
      skipped += 1;
      continue;
    }
    const security = scanFiles(selected, { manifest: skill.manifest });
    const securitySummary = riskSummary(security);
    const skillLicense = skill.manifest.license || license;
    const hash = treeHash(selected);
    if (seenHashes.has(hash)) {
      skipped += 1;
      continue;
    }
    seenHashes.add(skill.integrity);
    seenHashes.add(hash);
    candidates += 1;
    const entry = {
      name: skill.manifest.name,
      description: oneLine(skill.manifest.description, 300),
      version: skill.manifest.version || '0.0.0',
      license: skillLicense,
      licenseStatus: licenseStatusFor(skillLicense),
      author: skill.manifest.author || repo.split('/')[0],
      categories: skill.manifest.categories,
      tags: skill.manifest.tags,
      compatibility: skill.manifest.compatibility,
      allowedTools: skill.manifest.allowedTools,
      requires: skill.manifest.requires,
      conflicts: skill.manifest.conflicts,
      source: skill.source,
      trust: source.trust || 'community',
      verified: false,
      integrity: hash,
      quality: { score: quality.score, grade: quality.grade },
      security: securitySummary,
      blocked: security.blocking,
      bodyBytes: skill.bodyBytes,
      bodyLines: skill.bodyLines,
      fileCount: selected.size,
      updatedAt: info.pushed_at || null,
    };
    const key = normalizeName(entry.name);
    const current = perSource.get(key);
    if (!current || better({ entry }, current)) perSource.set(key, { entry, repo });
  }

  const kept = [...perSource.values()].sort(
    (a, b) => b.entry.quality.score - a.entry.quality.score || a.entry.name.localeCompare(b.entry.name),
  );
  const capped = Math.max(0, kept.length - maxSkills);
  let sourceKept = 0;
  let sourceBlocked = 0;
  let collisions = 0;
  for (const candidate of kept.slice(0, maxSkills)) {
    const key = normalizeName(candidate.entry.name);
    const current = best.get(key);
    if (!current) {
      best.set(key, candidate);
      sourceKept += 1;
      if (candidate.entry.blocked) sourceBlocked += 1;
      continue;
    }
    collisions += 1;
    if (better(candidate, current)) {
      best.set(key, candidate);
      const previous = stats.get(current.repo);
      if (previous) {
        previous.kept -= 1;
        if (current.entry.blocked) previous.blocked -= 1;
        previous.duplicates += 1;
      }
      sourceKept += 1;
      if (candidate.entry.blocked) sourceBlocked += 1;
    }
  }
  blocked += sourceBlocked;
  const duplicates = collisions + capped;
  skipped += capped;
  stats.set(repo, {
    kept: (stats.get(repo)?.kept || 0) + sourceKept,
    blocked: (stats.get(repo)?.blocked || 0) + sourceBlocked,
    duplicates: (stats.get(repo)?.duplicates || 0) + duplicates,
    skipped,
    candidates,
  });
  log(
    `    kept ${sourceKept}${collisions ? ` (${collisions} name collision(s))` : ''}, blocked ${sourceBlocked}, ` +
      `duplicates ${duplicates}, skipped ${skipped}`,
  );
  return {
    repo,
    label: source.label || repo,
    trust: source.trust || 'community',
    branch,
    commit,
    license,
    licenseStatus,
    stars: info.stargazers_count ?? null,
    sizeMB: info.size ? Math.round(info.size / 1024) : null,
    pushedAt: info.pushed_at || null,
    skills: sourceKept,
    blocked: sourceBlocked,
    duplicates,
    skipped,
    candidates,
  };
}

const config = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
const curatedNames = new Set(
  fs
    .readdirSync(path.join(PACKAGE_ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const enabled = config.sources.filter(
  (source) => source.enabled !== false && (only.length === 0 || only.includes(source.repo)),
);
const disabled = config.sources.filter((source) => source.enabled === false);

if (dryRun) {
  for (const source of enabled) {
    const info = await githubRepoInfo(source.repo);
    log(`${source.repo}: ${Math.round(info.size / 1024)} MB, license ${info.license?.spdx_id || 'none'}`);
  }
  process.exit(0);
}

log(`Crawling ${enabled.length} upstream source(s) → ${path.relative(PACKAGE_ROOT, OUTPUT_PATH)}`);
const seenHashes = new Set();
const best = new Map();
const stats = new Map();
const sourceRecords = [];

if (merge && only.length && fs.existsSync(OUTPUT_PATH)) {
  const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  for (const entry of previous.skills || []) {
    best.set(normalizeName(entry.name), { entry, repo: entry.source?.repo });
    if (entry.integrity) seenHashes.add(entry.integrity);
  }
  for (const record of previous.sources || []) {
    if (record.skipped === true || only.includes(record.repo)) continue;
    sourceRecords.push(record);
    stats.set(record.repo, {
      kept: record.skills || 0,
      blocked: record.blocked || 0,
      duplicates: record.duplicates || 0,
      skipped: record.skipped || 0,
      candidates: record.candidates || 0,
    });
  }
  log(`Merging into ${sourceRecords.length} existing source record(s) and ${best.size} existing skill(s)`);
}

for (const source of enabled) {
  log(`\n${source.repo}`);
  try {
    sourceRecords.push(await crawlSource(source, { curatedNames, seenHashes, best, stats }));
  } catch (error) {
    log(`  ERROR ${error.message}`);
    sourceRecords.push({
      repo: source.repo,
      label: source.label || source.repo,
      trust: source.trust || 'community',
      error: error.message,
    });
  }
  const partial = [...best.values()].map((item) => item.entry);
  const payload = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    minQuality: defaultMinQuality,
    sources: [...sourceRecords, ...disabled.map((item) => ({ ...item, skipped: true, reason: item.reason }))],
    skills: partial,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

const skills = [...best.values()].map((item) => item.entry).sort((a, b) => a.name.localeCompare(b.name));
for (const record of sourceRecords) {
  const stat = stats.get(record.repo);
  if (!stat) continue;
  record.skills = stat.kept;
  record.blocked = stat.blocked;
  record.duplicates = stat.duplicates;
  record.skipped = stat.skipped;
  record.candidates = stat.candidates;
}
const payload = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  minQuality: defaultMinQuality,
  sources: [...sourceRecords, ...disabled.map((item) => ({ ...item, skipped: true, reason: item.reason }))],
  skills,
};
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
const blocked = skills.filter((skill) => skill.blocked).length;
log(
  `\nWrote ${skills.length} unique upstream skill(s) from ${sourceRecords.filter((record) => !record.error).length} source(s); ` +
    `${blocked} blocked by security scan; ${seenHashes.size} file trees hashed.`,
);
if (skills.length > 0) {
  const avg = Math.round(skills.reduce((sum, skill) => sum + skill.quality.score, 0) / skills.length);
  log(`Average upstream quality: ${avg}/100.`);
}
