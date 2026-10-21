import { isBinary } from './util.mjs';
import { gradeFor } from './quality.mjs';

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const SEVERITY_WEIGHT = { critical: 45, high: 22, medium: 8, low: 2, info: 0 };
const DOWNGRADE = { critical: 'high', high: 'medium', medium: 'low', low: 'info', info: 'info' };

const NEGATION_RE =
  /\b(never|don't|do not|avoid|forbidden|must not|should not|refuse|prohibit|not allowed|instead of|dangerous|unsafe|beware)\b/i;

export const RULES = [
  {
    id: 'remote-shell',
    severity: 'critical',
    category: 'execution',
    title: 'Pipes downloaded content into a shell',
    pattern: /\b(?:curl|wget)\b[^\n|]{0,240}\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/i,
    advice: 'Download the script, show it to the user, verify a checksum, then run it explicitly.',
  },
  {
    id: 'powershell-iex',
    severity: 'critical',
    category: 'execution',
    title: 'Pipes downloaded content into Invoke-Expression',
    pattern: /\b(?:iwr|invoke-webrequest|curl)\b[^\n|]{0,240}\|\s*(?:iex|invoke-expression)\b/i,
    advice: 'Download to a file and inspect it before execution.',
  },
  {
    id: 'remote-interpreter',
    severity: 'high',
    category: 'execution',
    title: 'Pipes downloaded content into an interpreter',
    pattern: /\b(?:curl|wget)\b[^\n|]{0,240}\|\s*(?:python3?|node|ruby|perl|php)\b/i,
    advice: 'Write the payload to disk, review it, and run it from a pinned local file.',
  },
  {
    id: 'rm-rf-root',
    severity: 'critical',
    category: 'destructive',
    title: 'Recursive delete of a root or home path',
    pattern:
      /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\s+(?:\/|~|\$HOME|\$\{HOME\})(?:\s|$|["'`])/i,
    advice: 'Never delete a filesystem root or home directory. Scope deletes to a project subdirectory.',
  },
  {
    id: 'windows-wipe',
    severity: 'critical',
    category: 'destructive',
    title: 'Recursive Windows delete against a drive root',
    pattern: /\b(?:del|rd|rmdir)\s+\/[a-z]*[fsq][a-z]*\s+[A-Za-z]:\\(?:\s|$|["'`*])/i,
    advice: 'Do not run drive-wide deletes. Operate inside a known project directory.',
  },
  {
    id: 'disk-wipe',
    severity: 'critical',
    category: 'destructive',
    title: 'Formats a filesystem or writes raw disk blocks',
    pattern: /\b(?:mkfs(?:\.\w+)?|dd\s+if=[^\n]{0,80}of=\/dev\/)/i,
    advice: 'Disk-level operations must never be encoded in a portable agent skill.',
  },
  {
    id: 'secret-file-read',
    severity: 'high',
    category: 'secrets',
    title: 'Reads well-known credential files',
    pattern:
      /\b(?:cat|type|get-content|readfile|open)\b[^\n]{0,100}(?:\.ssh[\\/]id_|\.aws[\\/]credentials|\.git-credentials|\.npmrc|\.netrc|\.env\b)/i,
    advice: 'Never read credential stores. Ask the user for a scoped environment variable instead.',
  },
  {
    id: 'credential-network',
    severity: 'high',
    category: 'secrets',
    title: 'Combines network calls with credential or token access',
    pattern:
      /\b(?:curl|wget|invoke-restmethod|invoke-webrequest|fetch)\b[^\n]{0,180}(?:\.ssh|\.aws|\.env|credential|api[_-]?key|access[_-]?token)/i,
    advice: 'Keep credentials out of network commands. Use an explicit, user-approved secret store.',
  },
  {
    id: 'embedded-secret',
    severity: 'critical',
    category: 'secrets',
    title: 'Contains what looks like a live secret',
    pattern:
      /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----)/,
    advice: 'Revoke and rotate the credential, then remove it from the skill and its git history.',
  },
  {
    id: 'env-exfil',
    severity: 'high',
    category: 'exfiltration',
    title: 'Pipes environment data into the network',
    pattern: /\b(?:printenv|env)\b[^\n|]{0,100}\|\s*(?:curl|wget|nc|netcat)\b/i,
    advice: 'Never transmit environment variables. Print only the specific non-secret value needed.',
  },
  {
    id: 'encoded-exec',
    severity: 'high',
    category: 'obfuscation',
    title: 'Executes decoded or obfuscated content',
    pattern:
      /\beval\s*\(\s*(?:atob|buffer\.from|string\.fromcharcode|base64)|(?:echo|printf)[^\n]{0,240}\|\s*base64\s+(?:-d|--decode)[^\n]{0,80}\|\s*(?:ba|z)?sh\b/i,
    advice: 'Keep the readable source in the repository. Do not execute encoded payloads.',
  },
  {
    id: 'suspicious-exfil-host',
    severity: 'high',
    category: 'exfiltration',
    title: 'References a known throwaway or webhook host',
    pattern:
      /\b(?:webhook\.site|requestbin\.|ngrok\.(?:io|app|dev)|pastebin\.com|transfer\.sh|0x0\.st|discord(?:app)?\.com\/api\/webhooks)/i,
    advice: 'Use a documented, stable endpoint that reviewers can audit.',
  },
  {
    id: 'prompt-override',
    severity: 'high',
    category: 'prompt-injection',
    title: 'Attempts to override higher-priority instructions',
    pattern:
      /\b(?:ignore|disregard|forget)\b[^\n]{0,40}\b(?:previous|prior|above|system|developer|safety)\b[^\n]{0,40}\b(?:instructions?|prompts?|rules?|messages?)\b/i,
    advice: 'Remove instruction-override language. A skill may add context but must not rewrite the system contract.',
  },
  {
    id: 'hide-from-user',
    severity: 'high',
    category: 'prompt-injection',
    title: 'Instructs the agent to hide actions from the user',
    pattern:
      /\b(?:do not|don't|never)\b[^\n]{0,30}\b(?:tell|inform|show|notify|reveal)\b[^\n]{0,30}\b(?:the )?(?:user|human)\b/i,
    advice: 'Agent actions must be visible. Remove concealment instructions.',
  },
  {
    id: 'exfil-instruction',
    severity: 'high',
    category: 'exfiltration',
    title: 'Instructs sending secrets or private files elsewhere',
    pattern:
      /\b(?:send|post|upload|exfiltrate|transmit)\b[^\n]{0,90}\b(?:api[ _-]?key|token|credentials?|\.env|private key|password)\b/i,
    advice: 'Never move secrets off the machine. Escalate to the user instead.',
  },
  {
    id: 'persistence',
    severity: 'high',
    category: 'persistence',
    title: 'Installs background persistence',
    pattern:
      /\b(?:crontab|schtasks|launchctl|systemctl\s+enable|reg\s+add|new-scheduledtask)\b/i,
    advice: 'Do not install persistent background jobs from a skill without explicit user approval.',
  },
  {
    id: 'remote-download',
    severity: 'medium',
    category: 'network',
    title: 'Downloads remote files to disk',
    pattern: /\b(?:curl|wget)\b[^\n]{0,200}(?:-o|--output-document|-O|--output)\s+\S+/i,
    advice: 'Pin the URL, verify a published checksum, and tell the user what is downloaded.',
  },
  {
    id: 'global-install',
    severity: 'medium',
    category: 'supply-chain',
    title: 'Installs a package globally or from a URL',
    pattern:
      /\b(?:npm|pnpm|yarn|pip|pip3|gem|go)\s+(?:install|add)\b[^\n]{0,100}(?:--global|-g\b|https?:\/\/)/i,
    advice: 'Prefer project-local, lockfile-pinned dependencies. Global installs mutate the user machine.',
  },
  {
    id: 'dangerous-git',
    severity: 'medium',
    category: 'destructive',
    title: 'Uses destructive git operations',
    pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f[a-z]*d|push\s+--force|push\s+-f)\b/i,
    advice: 'Avoid history rewrites and forced pushes. Ask the user before discarding local work.',
  },
  {
    id: 'sudo',
    severity: 'low',
    category: 'privilege',
    title: 'Requests elevated privileges',
    pattern: /\bsudo\b/i,
    advice: 'Explain why elevation is needed and let the user run the privileged command.',
  },
  {
    id: 'chmod-777',
    severity: 'low',
    category: 'privilege',
    title: 'Makes files world-writable',
    pattern: /\bchmod\s+(?:-R\s+)?777\b/i,
    advice: 'Use the narrowest permissions that work.',
  },
  {
    id: 'hidden-unicode',
    severity: 'high',
    category: 'obfuscation',
    title: 'Contains zero-width or bidirectional control characters',
    pattern: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/,
    advice: 'Remove invisible control characters. They can hide instructions from human reviewers.',
  },
];

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.ps1',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
]);
const SENSITIVE_FILE_NAMES = new Set(['.env', '.netrc', '.npmrc', '.git-credentials', 'id_rsa', 'id_ed25519']);

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function excerpt(line, max = 150) {
  const text = line.trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const SUPPRESSION_RE = /skillrig-ignore(?:-file|-block|-next-line|-line)?(?:\s*:\s*([^\n]*?))?(?:-->\s*)?$/i;
const RULE_IDS = new Set([...RULES.map((rule) => rule.id), 'sensitive-file', 'executable-file', 'html-comment', 'broad-tools', 'all']);
const FENCE_RE = /^\s*(?:```|~~~)/;

function parseSuppression(line) {
  const match = line.match(/skillrig-ignore(-file|-block|-next-line|-line)?(?:\s*:\s*(.*?))?(?:-->)?\s*$/i);
  if (!match) return null;
  const kind = (match[1] || '-line').slice(1);
  const body = (match[2] || '').replace(/-->\s*$/, '').trim();
  const [rulePart, ...reasonParts] = body.split('--');
  const reason = reasonParts.join('--').trim() || null;
  const tokens = (rulePart || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => RULE_IDS.has(item));
  const rules = tokens.length > 0 ? tokens : null;
  return { kind, rules, reason, index: match.index };
}

function appliesTo(suppression, ruleId) {
  return !suppression.rules || suppression.rules.includes('all') || suppression.rules.includes(ruleId);
}

function buildSuppressionMap(lines) {
  const fileLevel = [];
  const inline = new Map();
  const scopes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseSuppression(lines[index]);
    if (!parsed) continue;
    if (parsed.kind === 'file') {
      fileLevel.push(parsed);
      continue;
    }
    if (parsed.kind === 'line') {
      const set = inline.get(index) || [];
      set.push(parsed);
      inline.set(index, set);
      continue;
    }
    if (parsed.kind === 'next-line') {
      const set = inline.get(index + 1) || [];
      set.push(parsed);
      inline.set(index + 1, set);
      continue;
    }
    let end = index;
    const next = lines[index + 1] || '';
    if (FENCE_RE.test(next)) {
      end = lines.length - 1;
      for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
        if (FENCE_RE.test(lines[cursor])) {
          end = cursor;
          break;
        }
      }
    } else if (next.trim().startsWith('|')) {
      end = index + 1;
      for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
        if (!lines[cursor].trim().startsWith('|')) break;
        end = cursor;
      }
    } else {
      end = index + 1;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (!lines[cursor].trim()) break;
        end = cursor;
      }
    }
    scopes.push({ start: index + 1, end, ...parsed });
  }
  return { fileLevel, inline, scopes };
}

function suppressionFor(map, lineIndex, ruleId) {
  for (const suppression of map.fileLevel) {
    if (appliesTo(suppression, ruleId)) return { by: 'file', reason: suppression.reason };
  }
  for (const suppression of map.inline.get(lineIndex) || []) {
    if (appliesTo(suppression, ruleId)) return { by: 'line', reason: suppression.reason };
  }
  for (const scope of map.scopes) {
    if (lineIndex >= scope.start && lineIndex <= scope.end && appliesTo(scope, ruleId)) {
      return { by: 'block', reason: scope.reason };
    }
  }
  return null;
}

export function scanFiles(files, { manifest = null, maxFindings = 300, respectSuppressions = true } = {}) {
  const findings = [];
  const suppressed = [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const suppressedCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  function push(finding, suppression = null) {
    if (suppression) {
      if (suppressed.length >= maxFindings) return;
      suppressed.push({ ...finding, suppressed: true, suppressedBy: suppression.by, suppressionReason: suppression.reason });
      suppressedCounts[finding.severity] += 1;
      return;
    }
    if (findings.length >= maxFindings) return;
    findings.push(finding);
    counts[finding.severity] += 1;
  }

  function emit(finding, map, lineIndex) {
    const suppression =
      respectSuppressions && map ? suppressionFor(map, lineIndex, finding.ruleId) : null;
    push(finding, suppression);
  }

  for (const [rel, file] of files) {
    const data = file.data ?? file;
    const lower = rel.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.'));
    const base = lower.split('/').pop();
    const text = isBinary(data) ? null : data.toString('utf8');
    const lines = text === null ? null : text.split(/\r?\n/);
    const suppressions = lines ? buildSuppressionMap(lines) : null;
    if (SENSITIVE_FILE_NAMES.has(base)) {
      emit({
        ruleId: 'sensitive-file',
        severity: 'critical',
        category: 'secrets',
        title: 'Bundles a credential-like file',
        file: rel,
        line: 1,
        excerpt: rel,
        advice: 'Remove credential stores and generated secret files from the skill.',
      }, suppressions, 0);
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      emit({
        ruleId: 'executable-file',
        severity: ext === '.ps1' || ext === '.sh' || ext === '.bat' || ext === '.cmd' ? 'medium' : 'high',
        category: 'execution',
        title: 'Ships an executable or shell script',
        file: rel,
        line: 1,
        excerpt: rel,
        advice: 'Keep scripts readable, reviewed, and limited to the narrow task in the skill.',
      }, suppressions, 0);
    }
    if (lines === null) continue;

    for (const rule of RULES) {
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line || line.length > 8000) continue;
        const marker = parseSuppression(line);
        const content = marker ? line.slice(0, marker.index).trimEnd() : line;
        if (!content) continue;
        const match = rule.pattern.exec(content);
        if (!match) continue;
        let severity = rule.severity;
        const before = content.slice(Math.max(0, match.index - 100), match.index);
        if (NEGATION_RE.test(before)) severity = DOWNGRADE[severity];
        emit({
          ruleId: rule.id,
          severity,
          category: rule.category,
          title: rule.title,
          file: rel,
          line: index + 1,
          excerpt: excerpt(content),
          advice: rule.advice,
        }, suppressions, index);
      }
    }

    const htmlComments = text.match(/<!--[\s\S]{0,800}?-->/g) || [];
    for (const comment of htmlComments) {
      if (SUPPRESSION_RE.test(comment)) continue;
      if (/\b(ignore|instruction|password|token|system prompt|exfiltrate)\b/i.test(comment)) {
        const commentIndex = text.indexOf(comment);
        emit({
          ruleId: 'html-comment',
          severity: 'medium',
          category: 'prompt-injection',
          title: 'HTML comment contains instruction-like text',
          file: rel,
          line: lineAt(text, commentIndex),
          excerpt: excerpt(comment),
          advice: 'Use normal Markdown so humans can review every instruction.',
        }, suppressions, lineAt(text, commentIndex) - 1);
      }
    }
  }

  if (manifest) {
    const broad = manifest.allowedTools?.filter((tool) =>
      /^(?:\*|bash|shell|exec|write|edit)(?:\(\s*\*+\s*\))?$/i.test(String(tool).trim()),
    );
    if (broad && broad.length > 0) {
      const manifestFile = files.get('SKILL.md');
      const manifestText =
        manifestFile && !isBinary(manifestFile.data ?? manifestFile)
          ? (manifestFile.data ?? manifestFile).toString('utf8')
          : null;
      emit({
        ruleId: 'broad-tools',
        severity: 'high',
        category: 'permissions',
        title: 'Declares broad tool permissions',
        file: 'SKILL.md',
        line: 1,
        excerpt: `allowed-tools: ${broad.join(', ')}`,
        advice: 'Scope allowed-tools to the exact commands the skill needs, for example Bash(git status:*).',
      }, manifestText === null ? null : buildSuppressionMap(manifestText.split(/\r?\n/)), 0);
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  suppressed.sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  const penalty = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0);
  const score = Math.max(0, 100 - penalty);
  return {
    score,
    grade: gradeFor(score),
    findings,
    counts,
    suppressed,
    suppressedCounts,
    suppressedTotal: suppressed.length,
    maxSeverity: findings[0]?.severity || 'none',
    blocking: findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high'),
  };
}

export function severityAtLeast(severity, threshold) {
  return (SEVERITY_ORDER[severity] ?? -1) >= (SEVERITY_ORDER[threshold] ?? 99);
}

export function filterFindings(findings, threshold = 'medium') {
  return findings.filter((finding) => severityAtLeast(finding.severity, threshold));
}

export function securityBadge(result) {
  if (result.counts.critical > 0) return 'critical';
  if (result.counts.high > 0) return 'high-risk';
  if (result.counts.medium > 0) return 'review';
  return 'clean';
}

export function toSarif(findings, { version = '1.0.0' } = {}) {
  const ruleMap = new Map(RULES.map((rule) => [rule.id, rule]));
  const results = findings.map((finding) => ({
    ruleId: finding.ruleId,
    level:
      finding.severity === 'critical' || finding.severity === 'high'
        ? 'error'
        : finding.severity === 'medium'
          ? 'warning'
          : 'note',
    message: { text: `${finding.title}: ${finding.advice}` },
    ...(finding.suppressed
      ? { suppressions: [{ kind: 'inSource', justification: `skillrig-ignore (${finding.suppressedBy})` }] }
      : {}),
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.file.replace(/\\/g, '/') },
          region: { startLine: finding.line || 1 },
        },
      },
    ],
  }));
  const usedRules = [...new Set(findings.map((finding) => finding.ruleId))];
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'SkillRig',
            informationUri: 'https://github.com/LIXIAO199115/skillrig',
            version,
            rules: usedRules.map((id) => {
              const rule = ruleMap.get(id);
              return {
                id,
                name: rule?.title || id,
                shortDescription: { text: rule?.title || id },
                help: { text: rule?.advice || '' },
                properties: { category: rule?.category || 'other', severity: rule?.severity || 'medium' },
              };
            }),
          },
        },
        results,
      },
    ],
  };
}

export function riskSummary(result) {
  return {
    score: result.score,
    grade: result.grade,
    badge: securityBadge(result),
    counts: result.counts,
    blocking: result.blocking,
    suppressed: result.suppressedTotal || 0,
  };
}
