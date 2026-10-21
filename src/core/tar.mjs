import zlib from 'node:zlib';
import path from 'node:path';
import { SkillRigError, IntegrityError } from './errors.mjs';

const BLOCK = 512;
const MAX_ENTRIES = 20000;
const MAX_TOTAL = 256 * 1024 * 1024;

function readString(buffer, start, length) {
  return buffer.toString('utf8', start, start + length).replace(/\0.*$/s, '').trim();
}

function readOctal(buffer, start, length) {
  const text = buffer.toString('ascii', start, start + length).replace(/\0.*$/s, '').trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function parsePax(buffer) {
  const result = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number(buffer.toString('ascii', offset, space));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = buffer.toString('utf8', space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals > 0) result[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return result;
}

function safeArchivePath(name, stripTopLevel) {
  let normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (stripTopLevel && parts.length > 1) parts.shift();
  normalized = parts.join('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

export function readTarGz(
  buffer,
  { maxEntries = MAX_ENTRIES, maxTotal = MAX_TOTAL, stripTopLevel = true } = {},
) {
  let raw;
  try {
    raw = zlib.gunzipSync(buffer, { maxOutputLength: maxTotal + 1024 * 1024 });
  } catch (cause) {
    throw new SkillRigError('Could not decompress archive (expected .tar.gz or .skm)', {
      code: 'ERR_ARCHIVE',
      cause,
    });
  }
  const files = new Map();
  let offset = 0;
  let count = 0;
  let total = 0;
  let pax = {};
  let longName = null;

  while (offset + BLOCK <= raw.length) {
    const header = raw.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    offset += BLOCK;
    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (longName) {
      name = longName;
      longName = null;
    }
    if (pax.path) {
      name = pax.path;
      pax = {};
    }
    const mode = readOctal(header, 100, 8) & 0o777;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isFinite(size) || size < 0 || size > maxTotal) {
      throw new IntegrityError('Archive contains an invalid entry size', { name, size });
    }
    const content = raw.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;
    count += 1;
    if (count > maxEntries) throw new IntegrityError('Archive contains too many entries');

    if (type === 'x' || type === 'g') {
      pax = parsePax(content);
      continue;
    }
    if (type === 'L') {
      longName = content.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type === '1' || type === '2') continue;
    if (type !== '0' && type !== '\0' && type !== '5' && type !== '7') continue;
    const safe = safeArchivePath(name, stripTopLevel);
    if (!safe) continue;
    if (type === '5') continue;
    total += size;
    if (total > maxTotal) throw new IntegrityError('Archive expands beyond the safety limit');
    files.set(safe, { data: Buffer.from(content), mode: mode || 0o644 });
  }
  return files;
}

function writeOctal(buffer, offset, length, value) {
  const text = Math.max(0, Number(value) || 0)
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1));
  buffer.write(text, offset, length - 1, 'ascii');
  buffer.write('\0', offset + length - 1, 1, 'ascii');
}

function splitUstarPath(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  const parts = name.split('/');
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const prefix = parts.slice(0, i).join('/');
    const rest = parts.slice(i).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  throw new SkillRigError(`Path is too long for ustar: ${name}`, { code: 'ERR_ARCHIVE_PATH' });
}

function headerFor(name, { size, mode = 0o644, mtime = Math.floor(Date.now() / 1000) }) {
  const header = Buffer.alloc(BLOCK, 0);
  const { name: shortName, prefix } = splitUstarPath(name);
  header.write(shortName, 0, 100, 'utf8');
  header.write(prefix, 345, 155, 'utf8');
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 32, 'ascii');
  header.write('root', 297, 32, 'ascii');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header.write('\0 ', 154, 2, 'ascii');
  return header;
}

export function writeTarGz(files, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  const chunks = [];
  for (const [name, file] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const data = file.data ?? file;
    const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some((part) => part === '..')) {
      throw new SkillRigError(`Unsafe path in archive: ${name}`, { code: 'ERR_ARCHIVE_PATH' });
    }
    chunks.push(headerFor(normalized, { size: data.length, mode: file.mode || 0o644, mtime }));
    chunks.push(data);
    const padding = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
}

export function listArchive(files) {
  return [...files.entries()]
    .map(([name, file]) => ({ name, size: (file.data ?? file).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function archiveBasename(file) {
  return path.basename(file).replace(/\.(skm|tar\.gz|tgz)$/i, '');
}
