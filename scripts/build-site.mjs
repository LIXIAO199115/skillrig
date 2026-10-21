#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, packageInfo } from '../src/core/util.mjs';
import { verifyRegistry } from '../src/core/registry.mjs';
import { listAgents } from '../src/core/agents.mjs';
import { mcpToolCount } from '../src/core/mcp.mjs';

const SITE_DIR = path.join(PACKAGE_ROOT, 'site');
const SOURCES_PATH = path.join(PACKAGE_ROOT, 'registry', 'sources.json');

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function trimDescription(value, max = 300) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildData() {
  const verified = verifyRegistry();
  const index = verified.index;
  const pkg = packageInfo();
  const sourceConfig = readJson(SOURCES_PATH, { sources: [] });
  const sourceMeta = new Map((sourceConfig.sources || []).map((source) => [source.repo, source]));

  const sourceIndex = new Map();
  const compactSources = [];
  for (const source of index.sources || []) {
    const configured = sourceMeta.get(source.repo) || {};
    sourceIndex.set(source.repo, compactSources.length);
    compactSources.push({
      repo: source.repo,
      label: configured.label || source.repo.split('/')[0],
      type: 'github',
      trust: source.trust || configured.trust || 'community',
      commit: source.commit || null,
      license: source.license || null,
      licenseStatus: source.licenseStatus || null,
      skills: source.skills ?? null,
      blocked: source.blocked ?? null,
      skipped: source.skipped ?? null,
      enabled: true,
      reason: configured.reason || null,
      error: source.error || null,
    });
  }

  const skills = (index.skills || [])
    .map((skill) => {
      const counts = skill.security?.counts || {};
      const hasCounts = ['critical', 'high', 'medium', 'low', 'info'].some((key) => (counts[key] || 0) > 0);
      return {
        name: skill.name,
        description: trimDescription(skill.description, 240),
        version: skill.version || '0.0.0',
        license: skill.license || null,
        licenseStatus: skill.licenseStatus || 'unlicensed',
        categories: skill.categories || [],
        tags: skill.tags || [],
        requires: skill.requires || [],
        conflicts: skill.conflicts || [],
        trust: skill.trust || 'community',
        q: [skill.quality?.score || 0, skill.quality?.grade || 'F'],
        sec: [
          skill.security?.score ?? 0,
          skill.security?.badge || 'unknown',
          hasCounts ? [counts.critical || 0, counts.high || 0, counts.medium || 0, counts.low || 0, counts.info || 0] : null,
          skill.security?.suppressed || 0,
        ],
        src: sourceIndex.has(skill.source?.repo) ? sourceIndex.get(skill.source.repo) : -1,
        path: skill.source?.path || null,
        blocked: Boolean(skill.blocked),
        hash: skill.integrity ? skill.integrity.replace(/^sha256:/, '').slice(0, 12) : null,
        lines: skill.bodyLines || 0,
        files: skill.fileCount || 0,
        updatedAt: skill.updatedAt || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.src - b.src));

  const packs = (index.packs || []).map((pack) => ({
    id: pack.id,
    name: pack.name,
    title: pack.title || pack.name,
    version: pack.version || '1.0.0',
    description: pack.description || '',
    skills: pack.skills || [],
    tags: pack.tags || [],
  }));

  const categoryCounts = new Map();
  for (const skill of skills) {
    for (const category of skill.categories) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }
  const categories = [...categoryCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const sources = [...compactSources];
  for (const configured of sourceConfig.sources || []) {
    if (sourceIndex.has(configured.repo)) continue;
    sources.push({
      repo: configured.repo,
      label: configured.label || configured.repo.split('/')[0],
      type: 'github',
      trust: configured.trust || 'community',
      commit: null,
      license: null,
      licenseStatus: null,
      skills: null,
      blocked: null,
      skipped: null,
      enabled: configured.enabled !== false,
      reason: configured.reason || null,
      error: null,
    });
  }

  const counts = index.counts || {};
  const qualityTotal = skills.reduce((sum, skill) => sum + (skill.q[0] || 0), 0);
  const clean = skills.filter((skill) => skill.sec[1] === 'clean').length;
  const licenses = {};
  for (const skill of skills) {
    licenses[skill.licenseStatus] = (licenses[skill.licenseStatus] || 0) + 1;
  }

  return {
    meta: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      repoUrl: 'https://github.com/LIXIAO199115/skillrig',
      siteUrl: 'https://lixiao199115.github.io/skillrig/',
      generatedAt: index.generatedAt || null,
      upstreamGeneratedAt: index.upstreamGeneratedAt || null,
      signedAt: verified.record?.signedAt || null,
      keyId: verified.keyId || null,
      digest: verified.record?.digest || null,
      agentCount: listAgents().length,
      mcpTools: mcpToolCount(),
      packCount: packs.length,
      categoryCount: categories.length,
      averageQuality: skills.length ? Math.round(qualityTotal / skills.length) : 0,
      clean,
      installable: skills.length - skills.filter((skill) => skill.blocked).length,
      licenses,
      counts,
    },
    categories,
    skills,
    packs,
    sources,
  };
}

function writeSitemap(data) {
  const lastmod = (data.meta.generatedAt || new Date().toISOString()).slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${data.meta.siteUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${data.meta.repoUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
`;
  fs.writeFileSync(path.join(SITE_DIR, 'sitemap.xml'), xml);
  fs.writeFileSync(path.join(SITE_DIR, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://lixiao199115.github.io/skillrig/sitemap.xml\n');
}

function main() {
  const data = buildData();
  fs.mkdirSync(SITE_DIR, { recursive: true });
  const payload = JSON.stringify(data);
  fs.writeFileSync(
    path.join(SITE_DIR, 'data.js'),
    `/* Generated by scripts/build-site.mjs. Do not edit. */\nwindow.SKILLRIG_DATA = ${payload};\n`,
  );
  writeSitemap(data);
  const size = Buffer.byteLength(payload);
  process.stdout.write(
    `Built site/data.js: ${data.skills.length} skills, ${data.packs.length} packs, ${data.sources.length} sources, ${(size / 1024).toFixed(1)} KB.\n`,
  );
  process.stdout.write(
    `Registry ${data.meta.keyId || 'unsigned'} · ${data.meta.counts.blocked || 0} blocked · avg quality ${data.meta.averageQuality}.\n`,
  );
}

main();
