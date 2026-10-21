import path from 'node:path';
import { splitFrontmatter, parseScalar } from './frontmatter.mjs';
import { sha256, oneLine, splitCommaList } from './util.mjs';

export const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
export const TOLERATED_FIELDS = new Set(['version', 'author', 'homepage', 'repository', 'tags', 'category']);
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function normalizeStringArray(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeStringArray(item));
  return splitCommaList(String(value));
}

export function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

export function parseSkill(raw, { dirName = null, sourcePath = null } = {}) {
  const parsed = splitFrontmatter(raw);
  const errors = [];
  const warnings = [];
  if (!parsed.hasFrontmatter) {
    errors.push('SKILL.md must start with YAML frontmatter (---)');
  }
  if (parsed.error) errors.push(parsed.error);
  const data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : {};

  for (const key of Object.keys(data)) {
    if (!SPEC_FIELDS.has(key) && !TOLERATED_FIELDS.has(key)) {
      warnings.push(`Unknown frontmatter field "${key}" (ignored by most agents)`);
    }
  }

  let name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name && dirName) {
    name = dirName;
    warnings.push(`Missing name; using directory name "${dirName}"`);
  }
  if (!name) errors.push('Missing required field: name');
  else if (!NAME_RE.test(name)) {
    errors.push('name must be 1-64 chars of lowercase letters, digits, and hyphens');
  }

  let description = typeof data.description === 'string' ? data.description.trim() : '';
  description = description.replace(/\s+/g, ' ').trim();
  if (!description) errors.push('Missing required field: description');
  else if (description.length > 1024) errors.push('description must be 1024 characters or fewer');
  else if (description.length < 40) warnings.push('description is short; agents use it to decide when to load the skill');

  if (dirName && name && dirName !== name) {
    warnings.push(`Directory "${dirName}" does not match skill name "${name}"`);
  }

  const license = typeof data.license === 'string' ? data.license.trim() : null;
  const compatibility = typeof data.compatibility === 'string' ? data.compatibility.trim() : null;
  if (compatibility && compatibility.length > 500) {
    warnings.push('compatibility should be 500 characters or fewer');
  }

  const metadata = normalizeMetadata(data.metadata);
  const allowedToolsRaw = data['allowed-tools'] ?? metadata['allowed-tools'] ?? null;
  const allowedTools = normalizeStringArray(allowedToolsRaw);
  const version =
    (typeof metadata.version === 'string' && metadata.version.trim()) ||
    (typeof data.version === 'string' && data.version.trim()) ||
    null;
  const author =
    (typeof metadata.author === 'string' && metadata.author.trim()) ||
    (typeof data.author === 'string' && data.author.trim()) ||
    null;

  const skillrigMeta = normalizeMetadata(metadata.skillrig);
  const requires = normalizeStringArray(skillrigMeta.requires ?? metadata.requires ?? []);
  const conflicts = normalizeStringArray(skillrigMeta.conflicts ?? metadata.conflicts ?? []);
  const replaces = normalizeStringArray(skillrigMeta.replaces ?? []);
  const categories = normalizeStringArray(
    metadata.categories ?? metadata.category ?? data.category ?? data.tags ?? [],
  ).map((item) => item.toLowerCase());
  const tags = normalizeStringArray(metadata.tags ?? data.tags ?? []);
  const homepage =
    (typeof metadata.homepage === 'string' && metadata.homepage) ||
    (typeof data.homepage === 'string' && data.homepage) ||
    null;
  const repository =
    (typeof metadata.repository === 'string' && metadata.repository) ||
    (typeof data.repository === 'string' && data.repository) ||
    null;

  const body = parsed.body.trim();
  const bodyBytes = Buffer.byteLength(parsed.body, 'utf8');

  return {
    manifest: {
      name,
      description,
      license,
      compatibility,
      metadata,
      allowedTools,
      allowedToolsRaw: allowedToolsRaw == null ? null : String(allowedToolsRaw),
      version,
      author,
      requires,
      conflicts,
      replaces,
      categories: [...new Set(categories)],
      tags: [...new Set(tags.map((tag) => String(tag).toLowerCase()))],
      homepage,
      repository,
      hasFrontmatter: parsed.hasFrontmatter,
    },
    body,
    rawFrontmatter: parsed.rawFrontmatter,
    errors,
    warnings,
    bodyBytes,
    bodyLines: body ? body.split(/\r?\n/).length : 0,
  };
}

export function readSkillFile(fs, filePath) {
  return parseSkill(fs.readFileSync(filePath, 'utf8'), {
    dirName: path.basename(path.dirname(filePath)),
    sourcePath: filePath,
  });
}

export function normalizeManifestForRegistry(parsed) {
  const m = parsed.manifest;
  return {
    name: m.name,
    description: oneLine(m.description, 1024),
    version: m.version,
    license: m.license,
    author: m.author,
    compatibility: m.compatibility,
    categories: m.categories,
    tags: m.tags,
    allowedTools: m.allowedTools,
    requires: m.requires,
    conflicts: m.conflicts,
    homepage: m.homepage,
    repository: m.repository,
    bodyBytes: parsed.bodyBytes,
    bodyLines: parsed.bodyLines,
    contentHash: `sha256:${sha256(parsed.body)}`,
  };
}

export function validateManifest(parsed, { dirName = null, strict = false } = {}) {
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  if (dirName && parsed.manifest.name !== dirName) {
    const message = `Folder name "${dirName}" must match skill name "${parsed.manifest.name}"`;
    if (strict) errors.push(message);
    else warnings.push(message);
  }
  if (parsed.manifest.allowedTools.includes('*')) {
    warnings.push('allowed-tools contains "*" which is broader than most agents support safely');
  }
  return { errors, warnings };
}

export function frontmatterValue(value) {
  return parseScalar(value);
}
