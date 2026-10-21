# Security model

SkillRig installs instructions that an AI agent will later follow. That makes a skill closer to source code than to a document, and it makes the installer part of the trust boundary.

This document states what SkillRig defends against, how, and where the defence stops.

## Threat model

SkillRig assumes:

- **the registry can be served over an untrusted network** — an index or bundle may be modified in transit or at rest;
- **an upstream repository can be compromised or abandoned** — a pinned commit is trustworthy only until someone rewrites history;
- **a skill can contain hostile instructions** — including instructions aimed at the agent rather than the human reviewer;
- **the user's machine contains credentials** — SSH keys, cloud credentials, tokens, environment files;
- **the scanner is incomplete** — it is a review aid, not a sandbox.

It does **not** assume that hashes, signatures, or static analysis can prove a skill safe. They prove provenance and consistency. Judgement remains with the reviewer.

## What each layer guarantees

| Layer | Guarantee | Failure mode it prevents |
| --- | --- | --- |
| Ed25519 signature over `registry/index.json` | The index is byte-for-byte the one published by the maintainer | Tampered catalogue, injected entries, downgraded security metadata |
| Key id + digest in the signature record | The verifier cannot silently use a different key | Key confusion, stale index paired with a new signature |
| Pinned commit per upstream source | Indexed content cannot change under the same identity | Moving branch, force-push replacement |
| SHA-256 tree hash per skill | Every file matches the reviewed content | Modified `references/`, appended scripts, added files |
| Per-file hashes in the lockfile | Installed files match what was installed | Post-install edits, partial writes, drift |
| Static scan before install | Known dangerous patterns are surfaced | `curl \| bash`, credential reads, exfiltration instructions |
| Severity gate | Critical and high findings require an explicit override | Silent installation of a flagged skill |
| Restricted write targets | Files land only in the selected agent directory | Path traversal, arbitrary filesystem writes |
| No execution during install/scan | Installing a skill cannot run its payload | Install-time code execution |

## The scanner

### Line rules

Four severity levels plus `info`. The full rule set:

| Rule | Severity | Category | Detects |
| --- | --- | --- | --- |
| `remote-shell` | critical | execution | `curl`/`wget` piped into `sh`, `bash`, `zsh`, `ksh` |
| `powershell-iex` | critical | execution | Downloaded content piped into `Invoke-Expression`/`iex` |
| `remote-interpreter` | high | execution | Downloaded content piped into Python, Node, Ruby, Perl, or PHP |
| `rm-rf-root` | critical | destructive | Recursive forced delete of `/`, `~`, or `$HOME` |
| `windows-wipe` | critical | destructive | `del /s /q C:\` and equivalent drive-root deletes |
| `disk-wipe` | critical | destructive | `mkfs*` or `dd ... of=/dev/...` |
| `secret-file-read` | high | secrets | Reading `.ssh/id_*`, `.aws/credentials`, `.git-credentials`, `.npmrc`, `.netrc`, `.env` |
| `credential-network` | high | secrets | Network commands combined with credential or token access |
| `embedded-secret` | critical | secrets | AWS keys, GitHub tokens, OpenAI-style keys, private-key headers |
| `env-exfil` | high | exfiltration | `printenv`/`env` piped to a network client |
| `encoded-exec` | high | obfuscation | `eval` of base64/atob, `base64 -d \| sh` |
| `suspicious-exfil-host` | high | exfiltration | Webhook.site, requestbin, ngrok, pastebin, transfer.sh, Discord webhooks |
| `prompt-override` | high | prompt-injection | "ignore previous instructions" and variants |
| `hide-from-user` | high | prompt-injection | Instructions not to tell or show the user |
| `exfil-instruction` | high | exfiltration | Instructions to send keys, tokens, credentials, or private keys elsewhere |
| `persistence` | high | persistence | `crontab`, `schtasks`, `launchctl`, `systemctl enable`, registry run keys |
| `remote-download` | medium | network | Writing a downloaded file to disk |
| `global-install` | medium | supply-chain | Global or URL-based package installs |
| `dangerous-git` | medium | destructive | `git reset --hard`, `git clean -fd`, force-push |
| `sudo` | low | privilege | Any `sudo` use |
| `chmod-777` | low | privilege | World-writable permissions |
| `hidden-unicode` | high | obfuscation | Zero-width and bidirectional control characters |

### Structural checks

| Rule | Severity | Detects |
| --- | --- | --- |
| `sensitive-file` | critical | A bundled `.env`, `.netrc`, `.npmrc`, `.git-credentials`, `id_rsa`, or `id_ed25519` |
| `executable-file` | medium/high | A shipped `.exe`, `.dll`, `.so`, `.dylib`, `.msi`, `.bat`, `.cmd`, `.com`, `.scr`, `.ps1`, `.sh`, `.bash`, `.zsh`, `.fish` |
| `html-comment` | medium | An HTML comment containing instruction-like text |
| `broad-tools` | high | `allowed-tools` containing `*`, bare `bash`, `shell`, `exec`, `write`, or `edit` |

### Negation handling

A pattern preceded within 100 characters by words such as `never`, `do not`, `avoid`, `forbidden`, `must not`, or `instead of` is downgraded one level. This keeps the rule useful in guidance such as:

> Never run `curl … | bash`; download the script and inspect it first.

The downgrade is deliberately conservative. It reduces noise; it does not make the finding disappear.

### Scoring

```
score = max(0, 100 − Σ severity weight)
weights: critical 45, high 22, medium 8, low 2, info 0
```

Grades: `A+` ≥95, `A` ≥85, `B` ≥75, `C` ≥60, `D` ≥40, `F` below 40.

Badges: `critical` if any critical finding, `high-risk` if any high, `review` if any medium, otherwise `clean`.

Scores are deterministic and depend only on the scanned bytes. No network, no LLM, no machine state.

## Suppressions

A skill author may suppress a finding with an inline marker. The grammar:

```
skillrig-ignore[-file|-block|-next-line|-line][: rule1, rule2][-- reason]
```

| Kind | Scope |
| --- | --- |
| `-line` (default) | The line containing the marker, including code before the marker |
| `-next-line` | The following line |
| `-block` | The next fenced code block, table, or paragraph |
| `-file` | The entire file |

Rules are comma-separated ids from the tables above, plus `all`. An omitted rule list applies to every rule. The reason is free text after `--` and is stored with the suppressed finding.

Examples:

````markdown
Install the CLI: `npm install -g example-cli` <!-- skillrig-ignore: global-install -- the documented setup step is a global install -->

<!-- skillrig-ignore-next-line: sudo -- this workflow manages a root-owned service -->
sudo systemctl restart example

<!-- skillrig-ignore-block: remote-shell -- the vendor publishes a checksum; the block verifies it before execution -->
```bash
curl -fsSLO https://example.com/install.sh
sha256sum -c install.sh.sha256
bash install.sh
```
````

Rules for review:

1. Suppress the narrowest rule possible. Never `all` in a published skill.
2. Write a reason that a reviewer can verify, not "needed".
3. `--strict` ignores every marker.
4. Suppressed findings are counted and returned. `scan --show-suppressed` prints them with their reasons; `scan --sarif` includes them with a SARIF `suppressions` entry.

A suppression marker is itself scanned. Text before the marker on the same line is still evaluated by every rule, so hiding a command behind a marker does not hide the command.

## Install-time enforcement

The default gate is `high`. Before writing:

1. Every text file is scanned.
2. If any finding meets or exceeds the gate, install aborts with exit code 3.
3. `--allow-risky` proceeds, records the security summary in the lockfile, and prints the findings.
4. `--fail-on none` disables the gate; it is intended for inspection workflows, not automation.

Blocked registry entries (`blocked: true`) are refused even when they are requested by name. They can be installed only by passing `--allow-risky` and reading the warnings.

## Integrity enforcement

- The registry signature is checked before the index is parsed.
- For bundles and registry entries, the expected tree hash is compared before frontmatter parsing. A tampered bundle reports an integrity error.
- Local directories have no expected hash; the computed hash is recorded in the lockfile.
- Upstream installs are fetched from a pinned commit recorded in the index, then hashed. The tarball is cached by `<repo>@<commit>`.
- `verify --installed` recomputes every file hash and exits 4 on any discrepancy.

## Write safety

- Targets are resolved from the agent catalogue, never from user-supplied paths.
- The final path must equal `<agent skill dir>/<skill name>` after resolution.
- Archive entries are rejected if they contain `..`, absolute paths, drive letters, or backslash traversal.
- Writes occur in a temporary sibling directory, then replace the target.
- `remove` refuses any path that is not inside a known agent skill root or not recorded in the lockfile.
- Symlinks in a source tree are skipped with a warning rather than followed.

## Key management

The registry signing key is Ed25519.

- Private key: `~/.skillrig/keys/skillrig.private.pem`, mode `0600`, never committed, never printed by the tooling.
- Public key: `registry/keys/skillrig.pub.pem`, committed and shipped in the npm package.
- Key id: first 16 hex characters of `sha256(public key PEM)`.
- Rotation: generate a new key pair, publish the new public key and a signature made with it, and record the old key id in the release notes. Clients that pin an older package will reject a new signature until they update — this is intentional.

`scripts/sign-registry.mjs --check` verifies without signing. CI can run `npm run verify` with no secret access.

## What the scanner cannot do

- **Semantic judgement.** It matches patterns, not intent. A hostile skill written in plain, friendly prose can pass.
- **Runtime behaviour.** It never executes the skill, so it cannot observe what a script would do.
- **Supply-chain depth.** It scans the skill folder. A script that downloads another script at runtime is caught only if the download command matches a rule.
- **Prompt-influence analysis.** It flags known override and concealment phrasing, not subtle persuasion.
- **Dependency safety.** It does not audit package registries or lockfiles referenced by a skill.
- **Binary analysis.** Executables are reported by extension, not disassembled.

Treat a clean scan as a reason to keep reading, not a reason to stop.

## Reporting a vulnerability

Use GitHub private vulnerability reporting on `LIXIAO199115/skillrig`. Include the affected command, a minimal reproduction, and the impact. Do not open a public issue, and do not include live credentials.

See [../SECURITY.md](../SECURITY.md) for scope, timelines, and safe-harbour terms.
