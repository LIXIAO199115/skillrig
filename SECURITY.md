# Security Policy

SkillRig installs instructions that an AI agent will follow. A vulnerability here can become code execution, credential exposure, or destructive file operations on a user's machine. Reports are taken seriously.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Use **GitHub private vulnerability reporting** on this repository:

1. Open the **Security** tab.
2. Click **Report a vulnerability**.
3. Include the affected command, a minimal reproduction, the SkillRig version, and the operating system.

Do not open a public issue for a suspected vulnerability. Do not include real credentials, private keys, or personal data in the report; redact them.

You can expect an acknowledgement within 72 hours and a status update within 7 days. If the report is valid, a fix and advisory will be published, and the reporter will be credited unless they ask otherwise.

## Scope

In scope:

- Signature verification bypasses in `registry/index.json` handling.
- Integrity bypasses in `.skm` bundles, lockfiles, or installed file checks.
- Path traversal or writes outside an agent skill directory during install, update, migrate, or remove.
- Command injection, shell injection, or unsafe deserialization reachable from CLI input or registry content.
- Security scanner bypasses that let a known-dangerous pattern install without `--allow-risky`.
- Privilege escalation or arbitrary file deletion caused by SkillRig itself.
- MCP server vulnerabilities (JSON-RPC handling, tool argument validation).

Out of scope:

- A skill containing malicious instructions that the scanner does **not** detect. This is a known limitation, not a vulnerability in the installer. Report it as a scanner improvement, and include the sample.
- Issues that require the user to pass `--allow-risky`, edit the lockfile, or run an untrusted private key.
- Vulnerabilities in upstream skills. Report those to the upstream repository; SkillRig will block the entry after verification.

## Design guarantees

SkillRig aims to guarantee the following:

1. **Signed index.** `registry/index.json` is verified against `registry/keys/skillrig.pub.pem` with Ed25519 before skills are read. A digest mismatch or bad signature is a hard failure.
2. **Pinned upstream commits.** Indexed GitHub skills record a commit SHA; installs fetch that commit, not the current branch head.
3. **Per-file integrity.** Each skill has a SHA-256 tree hash. Installs verify it, and lockfiles store per-file hashes for later drift detection.
4. **No execution during install.** Skill scripts are copied, never run, during install, update, scan, or audit.
5. **Restricted writes.** Installs and removals are confined to the resolved agent skill directory. Removal refuses a path outside that directory or a path whose final component does not match the skill name.
6. **Explicit risk acceptance.** Blocked entries require `--allow-risky`. Non-permissive or missing licenses produce warnings and are visible in `info`.
7. **Auditable suppressions.** Inline `skillrig-ignore` markers suppress a finding only for the named rule or the documented scope. Suppressed findings are counted and displayed by `scan --show-suppressed` and in SARIF `suppressions`.

## Signing key

The registry public key is committed at `registry/keys/skillrig.pub.pem`. The private key is never committed; it lives outside the repository at `~/.skillrig/keys/skillrig.private.pem` with mode `0600`.

The key id is the first 16 hex characters of the SHA-256 of the public key PEM. Key rotation requires a new public key, a new signature, and a changelog entry. Old signatures must not verify against a new key.

If the private key is suspected to be compromised:

1. Rotate the key with `npm run sign -- --generate --force`.
2. Rebuild and sign the registry.
3. Publish an advisory and a changelog entry naming the old and new key ids.
4. Treat every registry snapshot signed by the old key as untrusted.

## Scanner limitations

The scanner is a static, pattern-based review aid. It does not:

- prove that a skill is safe;
- understand intent or multi-step obfuscation;
- sandbox commands a skill asks an agent to run;
- inspect binary payloads or remote resources a skill links to;
- replace human review of scripts and `allowed-tools`.

The default install gate blocks `critical` and `high` findings. That is a floor, not a guarantee. For skills you do not control, read `SKILL.md`, `scripts/`, and `references/` directly.

## Supply chain

- No runtime dependencies. The CLI runs on Node built-ins only.
- GitHub API requests use a token from `SKILLRIG_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN` if present. Tokens are never written to disk or logs.
- Downloaded tarballs and API responses are cached under `~/.skillrig/cache`; integrity of GitHub content comes from the pinned commit and the registry hash.
- The registry build and signature happen locally. CI verifies the signature and re-runs the security scan on every curated skill.

## Disclosure timeline

- Day 0: report acknowledged.
- Day 1-7: triage, reproduction, severity assessment.
- Day 7-30: fix, tests, advisory, coordinated release.
- After release: public advisory with credit, unless the reporter prefers to remain anonymous.

Thank you for helping keep the agent skill ecosystem safe.
