const PERMISSIVE = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'CC-BY-4.0',
]);

const COPYLEFT = new Set(['CC-BY-SA-4.0', 'MPL-2.0', 'EPL-2.0', 'EUPL-1.2']);

export function licenseStatusFor(license) {
  if (!license) return 'unlicensed';
  const normalized = String(license).trim();
  if (!normalized) return 'unlicensed';
  if (PERMISSIVE.has(normalized)) return 'permissive';
  if (COPYLEFT.has(normalized) || /^(?:A|L)?GPL-/i.test(normalized)) return 'copyleft';
  return 'review';
}

export function isPermissiveLicense(license) {
  return licenseStatusFor(license) === 'permissive';
}
