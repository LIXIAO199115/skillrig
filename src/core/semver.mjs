const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    raw: value.trim(),
  };
}

export function isValidSemver(value) {
  return Boolean(parseSemver(value));
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNum = /^\d+$/.test(left);
    const rightNum = /^\d+$/.test(right);
    if (leftNum && rightNum) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (leftNum !== rightNum) {
      return leftNum ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function compareSemver(a, b) {
  const left = typeof a === 'string' ? parseSemver(a) : a;
  const right = typeof b === 'string' ? parseSemver(b) : b;
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function bumpVersion(value, kind = 'patch') {
  const parsed = parseSemver(value) || { major: 0, minor: 0, patch: 0 };
  if (kind === 'major') return `${parsed.major + 1}.0.0`;
  if (kind === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (kind === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  return parsed.raw || '0.0.0';
}

export function maxVersion(values) {
  return values.filter(Boolean).sort(compareSemver).at(-1) || null;
}
