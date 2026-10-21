import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill, NAME_RE, validateManifest } from '../src/core/manifest.mjs';
import { skillMarkdown } from './helpers.mjs';

test('parses a valid SKILL.md manifest and preserved body', () => {
  const parsed = parseSkill(skillMarkdown({ name: 'pdf-tools' }), { dirName: 'pdf-tools' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.manifest.name, 'pdf-tools');
  assert.match(parsed.manifest.description, /^Use when/);
  assert.equal(parsed.manifest.license, 'MIT');
  assert.equal(parsed.manifest.version, '1.0.0');
  assert.equal(parsed.manifest.author, 'test');
  assert.match(parsed.body, /## Workflow/);
});

test('rejects uppercase and underscored names', () => {
  for (const name of ['PDF-Tools', 'pdf_tools', '-pdf', 'a'.repeat(65)]) {
    assert.equal(NAME_RE.test(name), false, name);
  }
  const parsed = parseSkill(skillMarkdown({ name: 'Bad_Name' }));
  assert.ok(parsed.errors.some((error) => error.includes('lowercase')));
});

test('requires name and description', () => {
  const parsed = parseSkill('---\nlicense: MIT\n---\nbody');
  assert.ok(parsed.errors.some((error) => error.includes('name')));
  assert.ok(parsed.errors.some((error) => error.includes('description')));
});

test('rejects descriptions over 1024 characters', () => {
  const parsed = parseSkill(skillMarkdown({ description: `Use when ${'x'.repeat(1100)}` }));
  assert.ok(parsed.errors.some((error) => error.includes('1024')));
});

test('warns on unknown fields and folder mismatch without failing', () => {
  const parsed = parseSkill(skillMarkdown({ name: 'demo-skill', extra: 'random_field: true\n' }), {
    dirName: 'other-folder',
  });
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.warnings.some((warning) => warning.includes('random_field')));
  assert.ok(parsed.warnings.some((warning) => warning.includes('does not match')));
});

test('parses allowed-tools and comma-separated compatibility arrays', () => {
  const parsed = parseSkill(skillMarkdown({ extra: 'allowed-tools: Bash(git status:*), Read\n' }));
  assert.deepEqual(parsed.manifest.allowedTools, ['Bash(git status:*)', 'Read']);
  assert.equal(parsed.manifest.version, '1.0.0');
});

test('validateManifest flags invalid skills in strict mode', () => {
  const parsed = parseSkill('---\nname: x\n---\n', { dirName: 'x' });
  const result = validateManifest(parsed, { strict: true });
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some((error) => error.includes('description')));
});
