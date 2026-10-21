import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PACKAGE_ROOT, sha256, canonicalJson, oneLine } from './util.mjs';
import { IntegrityError, SkillRigError } from './errors.mjs';
import { compareSemver } from './semver.mjs';

export const REGISTRY_PATH = path.join(PACKAGE_ROOT, 'registry', 'index.json');
export const SIGNATURE_PATH = path.join(PACKAGE_ROOT, 'registry', 'index.json.sig');
export const PUBLIC_KEY_PATH = path.join(PACKAGE_ROOT, 'registry', 'keys', 'skillrig.pub.pem');

export function keyIdFor(publicKeyPem) {
  return sha256(publicKeyPem).slice(0, 16);
}

export function generateSigningKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey, keyId: keyIdFor(publicKey) };
}

export function loadPrivateKey(value) {
  if (!value) throw new SkillRigError('No signing key provided', { code: 'ERR_SIGNING_KEY' });
  if (value.includes('BEGIN PRIVATE KEY')) return crypto.createPrivateKey(value);
  if (fs.existsSync(value)) return crypto.createPrivateKey(fs.readFileSync(value));
  return crypto.createPrivateKey(Buffer.from(value, 'base64'));
}

export function loadPublicKey(value = PUBLIC_KEY_PATH) {
  if (!value) throw new SkillRigError('No public key provided', { code: 'ERR_PUBLIC_KEY' });
  const pem = value.includes('BEGIN PUBLIC KEY') ? value : fs.readFileSync(value, 'utf8');
  return crypto.createPublicKey(pem);
}

export function signBytes(bytes, privateKey) {
  return crypto.sign(null, bytes, privateKey).toString('base64');
}

export function verifyBytes(bytes, signature, publicKey) {
  try {
    return crypto.verify(null, bytes, publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

export function signRegistry({
  indexPath = REGISTRY_PATH,
  signaturePath = SIGNATURE_PATH,
  privateKey,
  signedAt = new Date().toISOString(),
} = {}) {
  const bytes = fs.readFileSync(indexPath);
  const index = JSON.parse(bytes.toString('utf8'));
  const key = typeof privateKey === 'object' && privateKey.type === 'private' ? privateKey : loadPrivateKey(privateKey);
  const signature = signBytes(bytes, key);
  const publicKeyPem = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const keyId = keyIdFor(publicKeyPem);
  const record = {
    schemaVersion: 1,
    algorithm: 'ed25519',
    keyId,
    digest: `sha256:${sha256(bytes)}`,
    signature,
    signedAt,
  };
  fs.writeFileSync(signaturePath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function verifyRegistry({
  indexPath = REGISTRY_PATH,
  signaturePath = SIGNATURE_PATH,
  publicKeyPath = PUBLIC_KEY_PATH,
  requireSignature = true,
} = {}) {
  if (!fs.existsSync(indexPath)) {
    throw new SkillRigError(`Registry not found: ${indexPath}`, { code: 'ERR_REGISTRY_MISSING' });
  }
  const bytes = fs.readFileSync(indexPath);
  const index = JSON.parse(bytes.toString('utf8'));
  if (!fs.existsSync(signaturePath)) {
    if (requireSignature) {
      throw new IntegrityError(
        `Registry signature missing: ${signaturePath}. Run "skillrig verify" after rebuilding the registry.`,
      );
    }
    return { verified: false, index, bytes, reason: 'unsigned' };
  }
  const record = JSON.parse(fs.readFileSync(signaturePath, 'utf8'));
  const digest = `sha256:${sha256(bytes)}`;
  if (record.digest !== digest) {
    throw new IntegrityError('Registry digest does not match its signature record (tampered or stale index)');
  }
  const publicKey = loadPublicKey(publicKeyPath);
  if (!verifyBytes(bytes, record.signature, publicKey)) {
    throw new IntegrityError('Registry signature verification failed');
  }
  const keyId = keyIdFor(publicKey.export({ type: 'spki', format: 'pem' }));
  if (record.keyId && record.keyId !== keyId) {
    throw new IntegrityError(`Registry key id mismatch: signature=${record.keyId} key=${keyId}`);
  }
  return { verified: true, index, bytes, record, keyId };
}

export function loadRegistry({ requireSignature = true, indexPath = REGISTRY_PATH } = {}) {
  const signaturePath = indexPath === REGISTRY_PATH ? SIGNATURE_PATH : `${indexPath}.sig`;
  const publicKeyPath =
    indexPath === REGISTRY_PATH ? PUBLIC_KEY_PATH : path.join(path.dirname(indexPath), 'keys', 'skillrig.pub.pem');
  const result = verifyRegistry({ indexPath, signaturePath, publicKeyPath, requireSignature });
  return { ...result.index, _verified: result.verified, _keyId: result.keyId || null };
}

export function getSkillsByName(index, name) {
  const needle = String(name).toLowerCase();
  return (index.skills || []).filter(
    (entry) => entry.name.toLowerCase() === needle || entry.id?.toLowerCase() === needle,
  );
}

export function getSkill(index, name) {
  const matches = getSkillsByName(index, name);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => Number(b.verified) - Number(a.verified) || (b.quality?.score || 0) - (a.quality?.score || 0))[0];
}

export function getPack(index, name) {
  return (index.packs || []).find((pack) => pack.name === name || pack.id === name) || null;
}

export function listCategories(index) {
  const counts = new Map();
  for (const skill of index.skills || []) {
    for (const category of skill.categories || []) counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function searchSkills(index, query = '', filters = {}) {
  const tokens = String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const limit = filters.limit || 50;
  const results = [];
  for (const skill of index.skills || []) {
    if (filters.category && !(skill.categories || []).includes(filters.category.toLowerCase())) continue;
    if (filters.agent) {
      const agents = skill.agents || [];
      if (agents.length > 0 && !agents.includes(filters.agent) && !agents.includes('*')) continue;
    }
    if (filters.source && !(skill.source?.repo || '').toLowerCase().includes(filters.source.toLowerCase())) continue;
    if (filters.grade && skill.quality?.grade !== filters.grade) continue;
    if (filters.security && skill.security?.badge !== filters.security) continue;
    if (filters.license && (skill.license || '').toLowerCase() !== filters.license.toLowerCase()) continue;

    const haystack = [
      skill.name,
      skill.description,
      ...(skill.tags || []),
      ...(skill.categories || []),
      skill.source?.repo || '',
      skill.author || '',
    ]
      .join(' ')
      .toLowerCase();
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      if (!haystack.includes(token)) {
        matched = false;
        break;
      }
      if (skill.name.toLowerCase() === token) score += 120;
      else if (skill.name.toLowerCase().startsWith(token)) score += 60;
      else if (skill.name.toLowerCase().includes(token)) score += 40;
      if ((skill.tags || []).includes(token)) score += 20;
      if ((skill.categories || []).includes(token)) score += 15;
      if (skill.description.toLowerCase().includes(token)) score += 8;
    }
    if (!matched) continue;
    score += Math.round((skill.quality?.score || 0) / 5);
    if (skill.verified) score += 25;
    results.push({ ...skill, _score: score });
  }

  const sort = filters.sort || (query ? 'relevance' : 'quality');
  results.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'quality') return (b.quality?.score || 0) - (a.quality?.score || 0);
    if (sort === 'updated') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    return b._score - a._score || (b.quality?.score || 0) - (a.quality?.score || 0);
  });
  return results.slice(0, limit);
}

export function registrySummary(index) {
  const skills = index.skills || [];
  const categories = [...new Set(skills.flatMap((skill) => skill.categories || []))];
  const sources = Array.isArray(index.sources)
    ? index.sources
    : [...new Set(skills.map((skill) => skill.source?.repo).filter(Boolean))];
  return {
    name: index.name,
    generatedAt: index.generatedAt,
    skills: skills.length,
    verified: skills.filter((skill) => skill.verified).length,
    categories: categories.length,
    sources: sources.length,
    packs: (index.packs || []).length,
    avgQuality: skills.length
      ? Math.round(skills.reduce((sum, skill) => sum + (skill.quality?.score || 0), 0) / skills.length)
      : 0,
    cleanSecurity: skills.filter((skill) => skill.security?.badge === 'clean').length,
  };
}

function countValues(skills, pick) {
  const counts = new Map();
  for (const skill of skills) {
    const value = pick(skill) || 'unknown';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function registryStats(index) {
  const skills = index.skills || [];
  const blocked = skills.filter((skill) => skill.blocked);
  return {
    ...registrySummary(index),
    version: index.version || null,
    generatedAt: index.generatedAt || null,
    signedAt: index.signedAt || null,
    installable: skills.length - blocked.length,
    blocked: blocked.length,
    totalBodyBytes: skills.reduce((sum, skill) => sum + (skill.bodyBytes || 0), 0),
    totalFiles: skills.reduce((sum, skill) => sum + (skill.fileCount || 0), 0),
    byTrust: countValues(skills, (skill) =>
      skill.verified ? 'curated' : skill.trust === 'official' ? 'official' : 'community',
    ),
    byGrade: countValues(skills, (skill) => skill.quality?.grade),
    bySecurity: countValues(skills, (skill) => skill.security?.badge),
    byLicense: countValues(skills, (skill) => skill.licenseStatus),
    bySource: countValues(skills, (skill) => skill.source?.repo),
    topCategories: listCategories(index),
  };
}

const RECOMMEND_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'my', 'me', 'in', 'on', 'with', 'and', 'or', 'of',
  'that', 'this', 'please', 'help', 'i', 'want', 'need', 'how', 'do', 'does', 'is',
  'it', 'can', 'you', 'we', 'our', 'from', 'at', 'by', 'be', 'as', 'into', 'about',
]);

export function recommendSkills(index, query, { limit = 8, category = null, agent = null, includeBlocked = false } = {}) {
  const tokens = [...new Set(
    (String(query || '').toLowerCase().match(/[\p{L}\p{N}+#._-]+/gu) || [])
      .filter((token) => token.length > 1 && !RECOMMEND_STOPWORDS.has(token)),
  )];
  const scored = [];
  for (const skill of index.skills || []) {
    if (skill.blocked && !includeBlocked) continue;
    if (category && !(skill.categories || []).includes(category.toLowerCase())) continue;
    if (agent) {
      const agents = skill.agents || [];
      if (agents.length > 0 && !agents.includes(agent) && !agents.includes('*')) continue;
    }
    const name = String(skill.name || '').toLowerCase();
    const tags = (skill.tags || []).map((tag) => String(tag).toLowerCase());
    const categories = (skill.categories || []).map((item) => String(item).toLowerCase());
    const description = String(skill.description || '').toLowerCase();
    const meta = `${skill.author || ''} ${skill.source?.repo || ''}`.toLowerCase();
    const matched = [];
    let score = 0;
    for (const token of tokens) {
      let points = 0;
      if (name === token) points = 120;
      else if (name.startsWith(token)) points = 60;
      else if (name.includes(token)) points = 40;
      else if (tags.some((tag) => tag.includes(token))) points = 24;
      else if (categories.some((item) => item.includes(token))) points = 18;
      else if (description.includes(token)) points = 8;
      else if (meta.includes(token)) points = 4;
      if (points > 0) {
        score += points;
        matched.push(token);
      }
    }
    if (tokens.length > 0 && matched.length === 0) continue;
    const coverage = tokens.length ? matched.length / tokens.length : 0;
    score += Math.round(coverage * 60);
    score += Math.round((skill.quality?.score || 0) / 5);
    if (skill.verified) score += 25;
    if (skill.trust === 'official') score += 10;
    scored.push({ ...skill, _score: score, _matched: matched });
  }
  const sort = query ? (a, b) => b._score - a._score || (b.quality?.score || 0) - (a.quality?.score || 0) : (a, b) =>
    (b.quality?.score || 0) - (a.quality?.score || 0);
  return scored.sort(sort).slice(0, limit);
}

export function compareEntryVersions(a, b) {
  return compareSemver(a.version, b.version);
}

export function registryIndexEntry({
  manifest,
  treeHash: hash,
  source,
  quality,
  security,
  verified,
  updatedAt,
  bodyBytes,
  bodyLines,
  files,
  trust,
  licenseStatus,
  blocked = false,
}) {
  return {
    id: `${source.repo || 'skillrig'}::${manifest.name}`,
    name: manifest.name,
    description: oneLine(manifest.description, 300),
    version: manifest.version || '0.0.0',
    license: manifest.license || null,
    licenseStatus: licenseStatus || null,
    author: manifest.author || null,
    categories: manifest.categories || [],
    tags: manifest.tags || [],
    compatibility: manifest.compatibility || null,
    allowedTools: manifest.allowedTools || [],
    requires: manifest.requires || [],
    conflicts: manifest.conflicts || [],
    agents: ['*'],
    source,
    trust: trust || (source.type === 'bundled' ? 'official' : 'community'),
    quality: quality ? { score: quality.score, grade: quality.grade } : null,
    security: security
      ? {
          score: security.score,
          grade: security.grade,
          badge: securityBadge(security),
          counts: security.counts,
        }
      : null,
    verified: Boolean(verified),
    blocked: Boolean(blocked),
    integrity: hash,
    bodyBytes,
    bodyLines,
    fileCount: files,
    updatedAt: updatedAt || null,
  };
}

function securityBadge(security) {
  if (security.counts.critical > 0) return 'critical';
  if (security.counts.high > 0) return 'high-risk';
  if (security.counts.medium > 0) return 'review';
  return 'clean';
}

export function canonicalEntryForSignature(entry) {
  return canonicalJson(entry);
}
