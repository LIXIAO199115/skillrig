#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, readTreeFromDir } from '../src/core/util.mjs';
import { parseSkill } from '../src/core/manifest.mjs';
import { scoreQuality, gradeFor } from '../src/core/quality.mjs';
import { scanFiles, riskSummary } from '../src/core/security.mjs';

const skillsDir = path.join(PACKAGE_ROOT, 'skills');
const json = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const minScore = Number(
  (process.argv.find((arg) => arg.startsWith('--min-score=')) || '').split('=')[1] || 70,
);

const rows = [];
let failed = 0;

for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const dir = path.join(skillsDir, entry.name);
  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    rows.push({ name: entry.name, errors: ['Missing SKILL.md'], warnings: [] });
    failed += 1;
    continue;
  }
  const raw = fs.readFileSync(skillFile, 'utf8');
  const parsed = parseSkill(raw, { dirName: entry.name });
  const { files } = readTreeFromDir(dir);
  const quality = scoreQuality({ manifest: parsed.manifest, body: parsed.body, files });
  const security = scanFiles(files, { manifest: parsed.manifest });
  const row = {
    name: parsed.manifest.name,
    version: parsed.manifest.version,
    quality: quality.score,
    grade: gradeFor(quality.score),
    security: riskSummary(security),
    securityTotal: Object.values(security.counts).reduce((sum, value) => sum + value, 0),
    suppressed: security.suppressedTotal,
    files: files.size,
    bodyBytes: parsed.bodyBytes,
    errors: parsed.errors,
    warnings: [...parsed.warnings, ...quality.checks.filter((check) => !check.passed).map((check) => check.detail)],
  };
  rows.push(row);
  if (parsed.errors.length > 0) failed += 1;
  if (quality.score < minScore) failed += 1;
  if (security.counts.high > 0 || security.counts.critical > 0) failed += 1;
}

if (json) {
  console.log(JSON.stringify({ skills: rows, failed, minScore }, null, 2));
} else {
  const nameWidth = Math.max(4, ...rows.map((row) => String(row.name).length));
  console.log(`\nValidating ${rows.length} skills in skills/ (min quality ${minScore})\n`);
  for (const row of rows) {
    const status = row.errors.length > 0 ? 'FAIL' : row.quality < minScore ? 'LOW ' : 'OK  ';
    console.log(
      `${status} ${String(row.name).padEnd(nameWidth)}  q=${String(row.quality).padStart(3)} ${row.grade}  ` +
        `sec=${row.security.grade}(${row.securityTotal})${row.suppressed ? `/${row.suppressed}s` : ''}  files=${row.files}  body=${row.bodyBytes}B`,
    );
    for (const error of row.errors) console.log(`     error: ${error}`);
    for (const warning of row.warnings) console.log(`     warn:  ${warning}`);
  }
  console.log(`\n${failed === 0 ? 'All skills valid.' : `${failed} skill(s) failed.`}\n`);
}

process.exitCode = failed > 0 ? 1 : 0;
