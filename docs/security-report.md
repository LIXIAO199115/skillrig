# Security scan report: 15,275 agent skills

Scan date: 2026-10-22 · registry v1.2.0 · 22 rules · five severities

This is the aggregate result of running the SkillRig security scanner over every entry in the bundled registry, including all upstream sources indexed on that date. Repro steps and caveats are at the bottom.

## What was scanned

| Metric | Count |
| --- | --- |
| Skills scanned | 15,275 |
| Upstream repositories indexed | 76 |
| Files hashed | 60,461 |
| Body lines scanned | 3,493,750 |
| Rules applied per entry | 22 |

## What was found

| Result | Count |
| --- | --- |
| Entries blocked by the security gate | **591** |
| Findings inside those blocked entries | 3,615 |
| Critical findings | 495 |
| High findings | 927 |
| Medium findings | 1,128 |
| Low findings | 1,050 |
| Informational findings | 15 |
| Blocked entries with at least one critical finding | 215 |
| Blocked entries with at least one high finding | 421 |
| Upstream sources contributing at least one blocked entry | 47 of 76 |
| Entries scanned clean (no findings at all) | 13,266 |
| Installable entries with medium/low findings only | 1,418 |

Blocking rule: an entry is blocked when the scan reports at least one `critical` or `high` finding. Medium and low findings are surfaced in the entry but do not block an install.

## What the rules catch

The scanner looks for instruction-level risk, not just file types. The 22 rules cover, among others:

- remote shell execution: `curl | bash`, `iwr | iex`, piping into an interpreter
- destructive filesystem operations: `rm -rf /`, disk wipes, Windows wipe commands
- credential access: reads of `.env`, `.npmrc`, `.netrc`, `.git-credentials`, `id_rsa`, `id_ed25519`
- exfiltration: secrets sent to a network endpoint, environment variables posted outbound, known exfil hosts
- obfuscation: base64-encoded execution, hidden Unicode, instructions concealed in HTML comments
- instruction hijacking: prompt overrides, "do not tell the user", embedded exfiltration instructions
- persistence and privilege: cron/systemd persistence, `sudo`, `chmod 777`, dangerous git operations
- supply chain: remote downloads, global installs, bundled executables

## Why this matters

A skill file is executable instruction, not documentation. It is handed to an agent that already has a shell, a filesystem, and your credentials. Most skill collections publish a name and a description; the file itself is never examined.

Roughly one in twenty-five indexed entries carried at least one high or critical finding. That is the reason SkillRig verifies every file hash, scans every entry, and blocks at install time instead of warning after the fact.

## Reproduce

```bash
# verify the signed index and its counts
node bin/skillrig.mjs verify

# inspect the gate: every entry carries security counts and a blocked flag
node --input-type=module -e "import('./registry/index.json',{with:{type:'json'}}).then(m=>{const s=m.default.skills;console.log(s.filter(x=>x.blocked).length+' blocked of '+s.length)})"

# scan a single skill before installing it
node bin/skillrig.mjs scan <skill-name>
```

## Caveats

- The scanner is static and rule-based. It does not execute skill code.
- False positives are possible: a skill that quotes a dangerous command in order to warn about it can still trigger a rule. Suppressions exist (`skillrig-ignore` with a reason) and are counted separately.
- False negatives are possible: obfuscated or multi-stage payloads can pass static rules. A clean scan is not a guarantee of safety.
- Upstream repositories are not named here. Every entry in `registry/index.json` records its source repository, path, and pinned commit, so any specific result can be traced.
- Counts describe the registry as indexed on 2026-10-22 and will change as sources are re-crawled.
