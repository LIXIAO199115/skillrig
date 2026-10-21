const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|\[TODO[^\]]*\]|lorem ipsum|replace me)\b/i;

function hasSection(body, patterns) {
  return patterns.some((pattern) => pattern.test(body));
}

export function scoreQuality({ manifest, body, files = new Map() }) {
  const checks = [];
  let score = 0;

  function check(id, label, points, passed, detail) {
    checks.push({ id, label, points: passed ? points : 0, max: points, passed, detail });
    if (passed) score += points;
  }

  const description = manifest.description || '';
  const lowerBody = body.toLowerCase();

  check(
    'trigger',
    'Description states when to use the skill',
    15,
    /\b(use (this|when|for)|when the user|trigger|use to|apply when)\b/i.test(description),
    'Add an explicit trigger phrase such as "Use when ...".',
  );
  check(
    'description-length',
    'Description is 60-500 characters',
    10,
    description.length >= 60 && description.length <= 500,
    `Length is ${description.length}.`,
  );
  check('body-size', 'Body is substantive (>=600 chars)', 10, body.length >= 600, `${body.length} chars.`);
  check(
    'headings',
    'Body has at least three headings',
    10,
    (body.match(/^#{2,3}\s+/gm) || []).length >= 3,
    'Structure the body with short, scannable sections.',
  );
  check(
    'when-to-use',
    'Explicit "When to use" section',
    10,
    hasSection(lowerBody, [/##\s+when to use/, /##\s+use when/, /##\s+triggers?/]),
    'Add a section that tells the agent when to activate the skill.',
  );
  check(
    'workflow',
    'Step-by-step workflow',
    10,
    hasSection(lowerBody, [/##\s+(workflow|process|procedure|steps|approach|method)/, /^1\.\s+/m]),
    'Add an ordered workflow the agent can follow.',
  );
  check(
    'examples',
    'Concrete examples or commands',
    10,
    hasSection(lowerBody, [/##\s+examples?/, /```/]),
    'Include examples, commands, or input/output pairs.',
  );
  check(
    'guardrails',
    'Guardrails and failure handling',
    10,
    hasSection(lowerBody, [/##\s+(guardrails?|safety|limits|boundaries|do not|anti-patterns?|failure)/, /\bnever\b/i]),
    'State what the agent must not do and how to fail safely.',
  );
  check(
    'resources',
    'Supporting references, scripts, or assets',
    5,
    [...files.keys()].some((file) => /^(references|scripts|assets|templates)\//.test(file)),
    'Bundle references or scripts when they reduce guesswork.',
  );
  check('version', 'Versioned with semver', 5, Boolean(manifest.version), 'Set metadata.version.');
  check('license', 'License declared', 5, Boolean(manifest.license), 'Add a license field.');
  check(
    'no-placeholders',
    'No unfinished placeholders',
    5,
    !PLACEHOLDER_RE.test(body) && !PLACEHOLDER_RE.test(description),
    'Remove TODO/FIXME markers before publishing.',
  );

  score = Math.min(100, score);
  return { score, grade: gradeFor(score), checks };
}

export function gradeFor(score) {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function qualitySummary(result) {
  const failed = result.checks.filter((check) => !check.passed);
  return {
    score: result.score,
    grade: result.grade,
    passed: result.checks.length - failed.length,
    total: result.checks.length,
    improvements: failed.map((check) => check.detail),
  };
}
