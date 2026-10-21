#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  globToRegExp,
  oneLine,
  treeHash,
} from '../src/core/util.mjs';
import { fetchJson, githubHeaders, githubToken, githubRepoInfo, githubCommit, readCache, writeCache } from '../src/core/net.mjs';
import { buildSkillFromFiles } from '../src/core/source.mjs';
import { scoreQuality } from '../src/core/quality.mjs';
import { scanFiles, riskSummary } from '../src/core/security.mjs';

const SOURCES_PATH = path.join(PACKAGE_ROOT, 'registry', 'sources.json');
const OUTPUT_PATH = path.join(PACKAGE_ROOT, 'registry', 'upstream.json');
const args = process.argv.slice(2);
const only = args.filter((arg) => arg.startsWith('--repo=')).map((arg) => arg.split('=')[1]);
const dryRun = args.includes('--dry-run');
const minQuality = Number((args.find((arg) => arg.startsWith('--min-quality=')) || '').split('=')[1] || 55);
const concurrency = Number((args.find((arg) => arg.startsWith('--concurrency=')) || '').split('=')[1] || 8);
const maxFiles = 60;
const maxFileBytes = 1024 * 1024;
const SKIP_PATH = /(^|\/)(node_modules|\.git|test|tests|__tests__|fixtures?|vendor|dist|build)\//i;

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function fetchBlob(repo, sha) {
  const key = `blob-${sha}`;
  const hit = readCache(key, { maxAgeMs: -1 });
  if (hit) return hit;
  const payload = await fetchJson(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, {
    headers: githubHeaders(githubToken()),
    timeout: 45000,
  });
  const data = payload.encoding === 'base64' ? Buffer.from(payload.content, 'base64') : Buffer.from(payload.content, 'utf8');
  writeCache(key, data);
  return data;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function skillDirsFromTree(tree, source) {
  const include = (source.include || []).map(globToRegExp);
  const exclude = (source.exclude || []).map(globToRegExp);
  const dirs = new Set();
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    if (entry.path !== 'SKILL.md' && !entry.path.endsWith('/SKILL.md')) continue;
    if (SKIP_PATH.test(entry.path)) continue;
    const dir = entry.path === 'SKILL.md' ? '.' : entry.path.slice(0, -'/SKILL.md'.length);
    if (include.length > 0 && !include.some((rule) => rule.test(dir))) continue;
    if (exclude.some((rule) => rule.test(dir))) continue;
    dirs.add(dir);
  }
  return [...dirs].sort();
}

function filesForDir(tree, dir, hashes) {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const files = new Map();
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    if (!entry.path.startsWith(prefix)) continue;
    const rel = entry.path.slice(prefix.length);
    if (!rel) continue;
    if (rel !== 'SKILL.md' && rel.endsWith('/SKILL.md')) continue;
    if (SKIP_PATH.test(rel)) continue;
    if (entry.size > maxFileBytes) continue;
    if (files.size >= maxFiles) break;
    files.set(rel, { path: entry.path, sha: entry.sha, mode: entry.mode === '100755' ? 0o755 : 0o644 });
  }
  return files;
}

async function crawlSource(source, { curatedNames, seenHashes }) {
  const repo = source.repo;
  const info = await githubRepoInfo(repo);
  const branch = info.default_branch;
  const commit = await githubCommit(repo, branch);
  const license = info.license?.spdx_id || null;
  const licenseStatus = licenseStatusFor(license);
  const treePayload = await fetchJson(
    `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: githubHeaders(githubToken()), timeout: 60000 },
  );
  if (treePayload.truncated) {
    throw new Error(`Git tree for ${repo} is truncated; narrow the include patterns`);
  }
  const dirs = skillDirsFromTree(treePayload.tree, source);
  log(`  ${repo}@${branch} ${commit.slice(0, 7)}: ${dirs.length} skill dir(s), license ${license || 'none'}`);

  const candidates = dirs.map((dir) => ({ dir, files: filesForDir(treePayload.tree, dir, null) }));
  const jobs = [];
  for (const candidate of candidates) {
    for (const [rel, file] of candidate.files) jobs.push({ ...file, rel, dir: candidate.dir });
  }
  log(`    fetching ${jobs.length} file(s) with concurrency ${concurrency}`);
  const blobs = new Map();
  await pool(jobs, concurrency, async (job) => {
    try {
      blobs.set(`${job.dir}\u0000${job.rel}`, await fetchBlob(repo, job.sha));
    } catch (error) {
      log(`    ! ${job.dir}/${job.rel}: ${error.message.slice(0, 120)}`);
    }
  });

  const results = [];
  let blocked = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const files = new Map();
    for (const [rel, file] of candidate.files) {
      const data = blobs.get(`${candidate.dir}\u0000${rel}`);
      if (data) files.set(rel, { data, mode: file.mode });
    }
    if (!files.has('SKILL.md')) {
      skipped += 1;
      continue;
    }
    let skill;
    try {
      skill = buildSkillFromFiles({
        files,
        dir: '.',
        source: {
          type: 'github',
          repo,
          ref: commit,
          branch,
          path: candidate.dir,
          url: `https://github.com/${repo}/tree/${commit}/${candidate.dir === '.' ? '' : candidate.dir}`,
        },
        allowInvalid: true,
        origin: `${repo}/${candidate.dir}`,
      });
    } catch {
      skipped += 1;
      continue;
    }
    if (!skill) {
      skipped += 1;
      continue;
    }
    const name = skill.manifest.name;
    if (curatedNames.has(name)) {
      skipped += 1;
      continue;
    }
    if (seenHashes.has(skill.integrity)) {
      skipped += 1;
      continue;
    }
    const quality = scoreQuality({ manifest: skill.manifest, body: skill.body, files: skill.files });
    const security = scanFiles(files, { manifest: skill.manifest });
    if (quality.score < minQuality) {
      skipped += 1;
      continue;
    }
    const securitySummary = riskSummary(security);
    if (security.blocking) blocked += 1;
    const skillLicense = skill.manifest.license || license;
    const skillLicenseStatus = licenseStatusFor(skillLicense);
    const hash = treeHash(files);
    if (seenHashes.has(hash)) {
      skipped += 1;
      continue;
    }
    seenHashes.add(hash);
    results.push({
      name,
      description: oneLine(skill.manifest.description, 300),
      version: skill.manifest.version || '0.0.0',
      license: skillLicense,
      licenseStatus: skillLicenseStatus,
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
      fileCount: files.size,
      updatedAt: info.pushed_at || null,
    });
  }
  log(`    indexed ${results.length}, blocked ${blocked}, skipped ${skipped}`);
  return {
    record: {
      repo,
      label: source.label || repo,
      trust: source.trust || 'community',
      branch,
      commit,
      license,
      licenseStatus,
      skills: results.length,
      blocked,
      skipped,
      updatedAt: info.pushed_at || null,
    },
    skills: results,
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
const sourceRecords = [];
const skills = [];
for (const source of enabled) {
  log(`\n${source.repo}`);
  try {
    const { record, skills: found } = await crawlSource(source, { curatedNames, seenHashes });
    sourceRecords.push(record);
    skills.push(...found);
    if (!dryRun && !fs.existsSync(path.join(PACKAGE_ROOT, 'registry'))) fs.mkdirSync(path.join(PACKAGE_ROOT, 'registry'));
    fs.writeFileSync(
      OUTPUT_PATH,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          minQuality,
          sources: [...sourceRecords, ...disabled.map((item) => ({ ...item, skipped: true, reason: item.reason }))],
          skills,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    log(`  ERROR ${error.message}`);
    sourceRecords.push({
      repo: source.repo,
      label: source.label || source.repo,
      trust: source.trust || 'community',
      error: error.message,
    });
  }
}

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  minQuality,
  sources: [...sourceRecords, ...disabled.map((item) => ({ ...item, skipped: true, reason: item.reason }))],
  skills,
};
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
const blocked = skills.filter((skill) => skill.blocked).length;
log(
  `\nWrote ${skills.length} upstream skill(s) from ${sourceRecords.filter((record) => !record.error).length} source(s); ${blocked} blocked by security scan.`,
);
if (skills.length > 0) {
  const avg = Math.round(skills.reduce((sum, skill) => sum + skill.quality.score, 0) / skills.length);
  log(`Average upstream quality: ${avg}/100.`);
}
