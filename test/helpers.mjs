import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempDir(prefix = 'skillrig-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function skillMarkdown({
  name = 'demo-skill',
  description = 'Use when demonstrating a complete SkillRig skill with enough description length for validation and discovery.',
  extra = '',
  body = '# Demo\n\n## When to use\n\nUse this when demoing.\n\n## Workflow\n\n1. Do the thing.\n2. Verify the thing.\n\n## Examples\n\n```bash\nskillrig scan .\n```\n\n## Guardrails\n\nNever delete user data.\n',
} = {}) {
  return `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\nmetadata:\n  version: 1.0.0\n  author: test\n${extra}---\n\n${body}`;
}

export function fileMap(entries) {
  return new Map(Object.entries(entries).map(([key, value]) => [key, { data: Buffer.from(value), mode: 0o644 }]));
}
