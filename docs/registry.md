# Registry format

The registry is one signed JSON document plus one signature record. Everything else — the CLI, the Codex plugin, the marketplace site — is derived from it.

```
registry/
├── index.json          the catalogue
├── index.json.sig      Ed25519 signature record
├── keys/
│   └── skillrig.pub.pem
├── sources.json        which upstream repositories to crawl (hand-edited)
└── upstream.json       crawled upstream metadata (generated)
```

## `index.json`

Top-level shape:

```json
{
  "schemaVersion": 1,
  "name": "skillrig",
  "version": "1.0.0",
  "generatedAt": "2026-10-21T16:03:54.536Z",
  "upstreamGeneratedAt": "2026-10-21T15:58:26.740Z",
  "counts": {
    "skills": 354,
    "curated": 18,
    "upstream": 336,
    "packs": 5,
    "blocked": 15,
    "verified": 18,
    "sources": 8,
    "shadowed": 0
  },
  "sources": [],
  "skills": [],
  "packs": []
}
```

- **skills** — every installable entry, curated and upstream, sorted by name then source.
- **packs** — named groups that resolve to skills at install time.
- **sources** — one record per indexed upstream repository: commit, license, skill count, blocked count, skip count, and any crawl error.
- **counts** — derived at build time. `shadowed` counts upstream entries whose name also exists in the curated set. Both records stay in the index; `getSkill()` prefers the verified (curated) entry when a name resolves to more than one.

### Skill entry

```json
{
  "id": "skillrig::agent-skill-author",
  "name": "agent-skill-author",
  "description": "Use when writing or reviewing a SKILL.md ...",
  "version": "1.0.0",
  "license": "MIT",
  "licenseStatus": "permissive",
  "author": "SkillRig",
  "categories": ["skills"],
  "tags": ["skills", "authoring", "agents", "prompt-design"],
  "compatibility": "Applies to the open Agent Skills format ...",
  "allowedTools": [],
  "requires": [],
  "conflicts": [],
  "agents": ["*"],
  "source": {
    "type": "bundled",
    "repo": "skillrig",
    "branch": "main",
    "ref": "main",
    "path": "skills/agent-skill-author",
    "url": "https://github.com/LIXIAO199115/skillrig/tree/main/skills/agent-skill-author"
  },
  "trust": "official",
  "quality": { "score": 100, "grade": "A+" },
  "security": {
    "score": 100,
    "grade": "A+",
    "badge": "clean",
    "counts": { "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0 }
  },
  "verified": true,
  "blocked": false,
  "integrity": "sha256:37abdf…",
  "bodyBytes": 9855,
  "bodyLines": 215,
  "fileCount": 2,
  "updatedAt": null
}
```

Field notes:

| Field | Meaning |
| --- | --- |
| `id` | `<repo-or-skillrig>::<name>`, stable across versions |
| `source.type` | `bundled`, `github`, `local`, or `bundle` (upstream uses `github`) |
| `source.commit` | Pinned SHA for upstream entries; absent for curated |
| `source.path` | Directory inside the repository |
| `trust` | `official`, `community`, or `local` |
| `licenseStatus` | `permissive`, `copyleft`, `review`, or `unlicensed` |
| `quality` | Deterministic 100-point authoring score and letter grade |
| `security` | Scanner score, grade, badge, and severity counts |
| `verified` | True for skills maintained in this repository |
| `blocked` | True when a high or critical finding exists |
| `integrity` | SHA-256 tree hash over every file in the skill |
| `bodyBytes` / `bodyLines` | Size of `SKILL.md` after frontmatter |
| `fileCount` | Number of files in the skill folder |

### Pack entry

```json
{
  "id": "skillrig::pack:backend-pack",
  "name": "backend-pack",
  "title": "Backend Pack",
  "version": "1.0.0",
  "description": "Contracts, migrations, latency, and incidents ...",
  "skills": ["api-contract-review", "sql-migration-review", "performance-profile", "incident-postmortem"],
  "tags": ["backend", "api", "database", "reliability"],
  "verified": true
}
```

Packs contain names, not copies. Installing a pack resolves each member through the normal pipeline, so security gates and hashes apply per skill. If a member is missing from the registry, the whole pack fails rather than installing a partial set.

## `index.json.sig`

```json
{
  "schemaVersion": 1,
  "algorithm": "ed25519",
  "keyId": "a159f773dbf9d466",
  "digest": "sha256:32f794…",
  "signature": "…",
  "signedAt": "2026-10-21T16:03:54.591Z"
}
```

The signature covers the **raw bytes** of `index.json`. Reformatting the JSON invalidates it. `keyId` is the first 16 hex characters of `sha256(publicKeyPem)`.

## License policy

The crawler records the repository licence (from `LICENSE`, `COPYING`, or `package.json`) and classifies it:

| Status | Licences |
| --- | --- |
| `permissive` | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, CC0-1.0, CC-BY-4.0 |
| `copyleft` | CC-BY-SA-4.0, MPL-2.0, EPL-2.0, EUPL-1.2, and any GPL/AGPL/LGPL identifier |
| `review` | Anything else recognised as a licence but not on the list |
| `unlicensed` | No licence file found |

All four statuses are indexed so the catalogue reflects what is actually published upstream. The CLI prints a licence warning on install for anything other than `permissive`, and every entry links to its source. Skills keep their original licence; SkillRig does not relicense them.

## Adding an upstream source

Edit `registry/sources.json`:

```json
{
  "repo": "owner/repository",
  "label": "Human readable name",
  "trust": "community",
  "include": ["skills/**"],
  "exclude": ["**/test/**", "**/fixtures/**"]
}
```

`include`/`exclude` are glob fragments matched against repository paths. Omit them to scan the default locations. Set `enabled: false` with a `reason` to list a repository as an external catalog without indexing it.

Then:

```bash
npm run crawl            # GitHub tree + blobs, pinned commit, scan
npm run build:registry   # merge, score, sign
npm run verify
```

The crawler requires network access to `api.github.com`. Set `GITHUB_TOKEN` (or `SKILLRIG_GITHUB_TOKEN`) to avoid anonymous rate limits; a token is not required for a small source list.

## Search semantics

`searchSkills(index, query, filters)`:

1. Normalises the query to lowercase tokens.
2. Every token must match somewhere in the name, description, tags, category, author, or repository. There is no OR fallback — a multi-word query narrows.
3. Applies filters: `category`, `grade`, `security` badge, and `license`.
4. Scores matches: exact name 120, name prefix 60, name contains 40, tag 20, category 15, description 8, plus quality/5 and 25 for curated.
5. Sorts by relevance, quality, updated date, or name. With no query the default is quality.
6. Returns at most 25 entries for a query and 20 for an empty query unless `--limit` is set.

Blocked entries still appear in search so that their status is visible. `install` is where the block is enforced.

The site uses the same ordering, implemented in `site/app.js`, so search results are consistent between CLI and web.

## Verification

```bash
npm run verify
# registry verified: 354 skills, 5 packs
# key        a159f773dbf9d466
# digest     sha256:32f794…
# signed     2026-10-21T16:03:54.591Z
```

`verifyRegistry` checks, in order:

1. the index exists and parses,
2. the signature record exists,
3. `sha256(index bytes)` equals `record.digest`,
4. `ed25519.verify(index bytes, record.signature, publicKey)`,
5. `record.keyId` equals the id derived from the public key.

Any failure throws `IntegrityError` and exits 4. The CLI never reads skill metadata from an index that failed this chain.

## Build determinism

`build-registry.mjs`:

- sorts skills by `name`, then `source.repo`,
- sorts sources by repository name,
- sorts tags and categories,
- normalises descriptions to one line,
- writes with two-space indentation and a trailing newline,
- records `generatedAt` (so two builds differ only by timestamps and crawl output).

The signature covers generated timestamps, so the index changes whenever it is rebuilt. That is expected: the signature proves the document came from the maintainer, not that it is byte-identical across builds.

## Fixtures and tests

`test/registry.test.mjs` builds a tiny unsigned index in a temporary directory and signs it with an ephemeral key. Tests cover digest tampering, signature tampering, key-id mismatch, missing signature, search ranking, and pack resolution. No test touches the real signing key or the network.
