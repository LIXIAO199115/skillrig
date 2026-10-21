import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { SkillRigError } from './errors.mjs';
import { ensureDir, sha256, packageInfo } from './util.mjs';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;

export function cacheRoot() {
  return process.env.SKILLRIG_CACHE_DIR || path.join(os.homedir(), '.skillrig', 'cache');
}

export function githubToken() {
  return process.env.SKILLRIG_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

export function githubHeaders(token = githubToken(), extra = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': `skillrig/${packageInfo().version}`,
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchBuffer(
  url,
  { headers = {}, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, maxBytes = 128 * 1024 * 1024 } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': `skillrig/${packageInfo().version}`, ...headers },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message = `HTTP ${response.status} ${response.statusText} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`;
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          lastError = new SkillRigError(message, { code: 'ERR_HTTP' });
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
          continue;
        }
        throw new SkillRigError(message, { code: 'ERR_HTTP' });
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > maxBytes) {
        throw new SkillRigError(`Response is too large (${length} bytes): ${url}`, { code: 'ERR_TOO_LARGE' });
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > maxBytes) {
        throw new SkillRigError(`Response exceeded ${maxBytes} bytes: ${url}`, { code: 'ERR_TOO_LARGE' });
      }
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') {
        lastError = new SkillRigError(`Request timed out after ${timeout}ms: ${url}`, { code: 'ERR_TIMEOUT' });
      }
      if (attempt >= retries) break;
      await sleep(400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new SkillRigError(`Request failed: ${url}`, { code: 'ERR_HTTP' });
}

export async function fetchJson(url, options = {}) {
  const buffer = await fetchBuffer(url, options);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (cause) {
    throw new SkillRigError(`Invalid JSON from ${url}`, { code: 'ERR_JSON', cause });
  }
}

export function cachePath(...parts) {
  return path.join(cacheRoot(), ...parts);
}

export function readCache(key, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const file = cachePath('objects', key);
  try {
    const stat = fs.statSync(file);
    if (maxAgeMs >= 0 && Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export function writeCache(key, buffer) {
  const file = cachePath('objects', key);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, buffer);
  return file;
}

export async function githubRepoInfo(repo, { token = githubToken(), cache = true } = {}) {
  const key = `repo-${sha256(repo).slice(0, 32)}.json`;
  if (cache) {
    const hit = readCache(key, { maxAgeMs: 10 * 60 * 1000 });
    if (hit) return JSON.parse(hit.toString('utf8'));
  }
  const info = await fetchJson(`https://api.github.com/repos/${repo}`, { headers: githubHeaders(token) });
  if (info.message === 'Not Found') {
    throw new SkillRigError(`GitHub repository not found: ${repo}`, { code: 'ERR_NOT_FOUND' });
  }
  if (cache) writeCache(key, Buffer.from(JSON.stringify(info)));
  return info;
}

export async function githubCommit(repo, ref, { token = githubToken() } = {}) {
  if (/^[0-9a-f]{40}$/i.test(ref || '')) return ref.toLowerCase();
  const info = await githubRepoInfo(repo, { token });
  const target = ref || info.default_branch;
  const key = `commit-${sha256(`${repo}@${target}`).slice(0, 32)}.json`;
  const hit = readCache(key, { maxAgeMs: 10 * 60 * 1000 });
  if (hit) return JSON.parse(hit.toString('utf8')).sha;
  const commit = await fetchJson(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(target)}`, {
    headers: githubHeaders(token),
  });
  if (!commit.sha) {
    throw new SkillRigError(`Could not resolve ${repo}@${target}`, { code: 'ERR_GIT_REF' });
  }
  writeCache(key, Buffer.from(JSON.stringify({ sha: commit.sha, date: commit.commit?.committer?.date || null })));
  return commit.sha;
}

export async function githubTarball(
  repo,
  ref,
  { token = githubToken(), noCache = false, persist = true, timeout = 90000, maxBytes = 512 * 1024 * 1024 } = {},
) {
  const key = `tar-${sha256(`${repo}@${ref}`).slice(0, 40)}.tgz`;
  if (!noCache) {
    const hit = readCache(key, { maxAgeMs: /^[0-9a-f]{40}$/i.test(ref || '') ? -1 : 60 * 60 * 1000 });
    if (hit) return hit;
  }
  const url = `https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(ref || 'HEAD')}`;
  const buffer = await fetchBuffer(url, {
    headers: githubHeaders(token, { Accept: 'application/vnd.github+json' }),
    timeout,
    retries: 2,
    maxBytes,
  });
  if (persist) writeCache(key, buffer);
  return buffer;
}

export function moduleDir(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}
