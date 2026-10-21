# SkillRig

**Codex 与 80 种编码 Agent 的签名技能市场 + 零依赖安装器。**

**在线注册表：** [lixiao199115.github.io/skillrig](https://lixiao199115.github.io/skillrig/) — 检索 354 条记录、查看检验台账、复制安装命令。

[![CI](https://github.com/LIXIAO199115/skillrig/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/LIXIAO199115/skillrig/actions/workflows/ci.yml)
[![CodeQL](https://github.com/LIXIAO199115/skillrig/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/LIXIAO199115/skillrig/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-14150f?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-14150f?style=flat-square)](package.json)
[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-f04e23?style=flat-square)](package.json)
[![Skills](https://img.shields.io/badge/skills-354-1f5c45?style=flat-square)](registry/index.json)
[![Agents](https://img.shields.io/badge/agents-80-1f5c45?style=flat-square)](docs/agents.md)
[![Registry](https://img.shields.io/badge/registry-ed25519%20signed-f04e23?style=flat-square)](registry/index.json.sig)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/LIXIAO199115/skillrig/badge)](https://securityscorecards.dev/viewer/?uri=github.com/LIXIAO199115/skillrig)

SkillRig 是 `SKILL.md` 智能体技能（Agent Skills）的包管理器、安全扫描器和精选注册表。Codex、Claude Code、Cursor、Gemini CLI、Qwen Code、OpenCode、Qoder 等 [80 种 Agent](docs/agents.md) 读取同一套技能格式，SkillRig 负责把它们安全地装到正确位置。

大多数技能集合让你直接 `git clone` 然后信任里面的文件。SkillRig 给每次安装留下可核对的凭证：签名索引、逐文件 SHA-256、安装前安全扫描、锁文件与漂移检测、本地审计命令。

```bash
node bin/skillrig.mjs install codex-cli-workflows --agent codex
```

> 内置注册表 354 个技能 · 18 个在本仓库维护 · 336 个索引自 8 个上游仓库 · 15 个被安全门禁拦截 · 零运行时依赖。

---

## 解决什么问题

技能就是交给 Agent 执行的指令。一个技能可以让 Agent 读取 `~/.ssh`、把远程脚本管道进 bash、悄悄改写 git 历史，或把指令藏在 HTML 注释里。普通市场只展示名字和简介，然后把文件直接交给 Agent。

SkillRig 把技能当软件包处理：

| 风险 | SkillRig 的做法 |
| --- | --- |
| 索引被篡改 | Ed25519 签名覆盖完整索引，公钥随 CLI 一起分发 |
| 技能文件被篡改 | 每个技能一个 SHA-256 目录树哈希，安装前与每次 `audit` 校验 |
| 恶意指令 | 静态扫描 + 严重级别门禁；被标记的技能默认无法安装 |
| 静默漂移 | 项目级/全局锁文件记录每个文件哈希；`doctor`、`list` 报告改动 |
| 上下文膨胀 | `budget` 计算常驻与激活 token 成本 |
| 多 Agent 不一致 | 一个来源同时安装到 80 种 Agent 目录 |

被抑制的告警必须写明理由，且 `scan --show-suppressed` 仍会显示，不会被悄悄丢弃。

---

## 快速开始

**要求：** Node.js 20.11 或更新版本。无需安装依赖。

```bash
git clone https://github.com/LIXIAO199115/skillrig.git
cd skillrig

# 浏览注册表
node bin/skillrig.mjs search codex
node bin/skillrig.mjs info codex-cli-workflows

# 安装到 Codex（项目级）
node bin/skillrig.mjs install codex-cli-workflows --agent codex --scope project

# 安装整套技能包
node bin/skillrig.mjs install pack/secure-agent --agent agents

# 校验磁盘上的文件
node bin/skillrig.mjs verify --installed
node bin/skillrig.mjs audit
```

想直接使用 `skillrig` / `skr` 命令：

```bash
npm link
skillrig --help
```

### 作为 Codex 插件市场安装

已在 `codex-cli 0.154.0` 实测：

```bash
codex plugin marketplace add LIXIAO199115/skillrig
codex plugin add skillrig@skillrig
```

18 个精选技能会出现在 Codex 中。更新后运行 `codex plugin marketplace upgrade` 刷新。

---

## 核心能力

### 1. 签名注册表

`registry/index.json` 使用 Ed25519 签名，签名记录包含 key id、SHA-256 摘要和时间戳。CLI 读取任何技能前都会校验摘要与签名。

```bash
skillrig verify
# registry verified: 354 skills, 5 packs
# key        a159f773dbf9d466
# digest     sha256:32f794...
# signed     2026-10-21T16:03:54.591Z
```

每个条目包含信任级别（`official` / `community`）、许可证状态（`permissive` / `copyleft` / `review` / `unlicensed`）、质量分、安全徽章和 `blocked` 标记。

### 2. 会读指令的安全扫描器

扫描覆盖技能里的每个文本文件，而不只是 `SKILL.md`：

- 远程脚本执行、`curl | bash`、编码载荷、PowerShell `iex`
- 读取凭证（`.ssh`、`.aws`、`.npmrc`、`.env`）、文件内密钥、外传指令
- 破坏性文件系统与 git 操作、`sudo`、`chmod 777`
- 提示词注入、不可见 Unicode、藏指令的 HTML 注释
- 过宽的 `allowed-tools` 声明
- 可执行文件与敏感文件名

门禁可配置（`critical` / `high` / `medium` / `low` / `none`）。`scan` 支持人类可读表格和 SARIF 2.1.0，方便接 CI。

```bash
skillrig scan owner/repo@skill --fail-on high --sarif > skillrig.sarif
```

### 3. 一条命令，八十种 Agent

```bash
skillrig targets                    # 查看全部 Agent 与路径
skillrig install sql-migration-review --agent codex,claude-code,cursor
skillrig install pack/backend-pack --agent agents     # 通用 .agents/skills
```

`--scope project` 写入仓库（跟随代码提交），`--scope global` 写入本机。完整路径见 [docs/agents.md](docs/agents.md)。

### 4. 技能包（Packs）

| 技能包 | 用途 |
| --- | --- |
| `pack/codex-starter` | Codex CLI、仓库上手、技能编写、插件、上下文预算 |
| `pack/secure-agent` | 技能安全审计、依赖审计、MCP 服务器构建 |
| `pack/ship-it` | 测试、PR 审查、文档、发布工程 |
| `pack/debug-pack` | 终端调试、回归测试、git 恢复、性能分析 |
| `pack/backend-pack` | API 契约、SQL 迁移、性能、事故复盘 |

```bash
skillrig info codex-starter
skillrig install pack/codex-starter --agent codex
```

### 5. 漂移检测与上下文预算

每次安装都会写锁文件（项目级 `.skillrig-lock.json`，全局 `~/.skillrig/lock.json`），记录每个文件的 SHA-256。

```bash
skillrig list                    # ok / modified / missing
skillrig doctor                  # 未使用安装、版本不一致、AGENTS.md 过期
skillrig budget --warn-at 1500   # 常驻 + 激活 token
skillrig sync                    # 在 AGENTS.md 写入受管技能区块
```

### 6. MCP 服务器

让 Agent 通过 Model Context Protocol 搜索、查看、扫描、安装、审计技能：

```bash
skillrig mcp
```

共 10 个工具，包括 `skillrig_search`、`skillrig_scan`、`skillrig_install`、`skillrig_audit`、`skillrig_budget`、`skillrig_doctor`。兼容 Codex 和任何使用 stdio JSON-RPC 的 MCP 客户端。

### 7. 带来源信息的发布

```bash
skillrig init my-skill --description "Use when ..."
skillrig scan my-skill
skillrig pack my-skill --out my-skill.skm --key ~/.skillrig/keys/skillrig.private.pem
skillrig publish my-skill --key ~/.skillrig/keys/skillrig.private.pem
```

`publish` 输出带完整性、质量和安全元数据的注册表条目，可直接提交 PR。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 当前注册表

| 指标 | 数值 |
| --- | --- |
| 技能总数 | 354 |
| 本仓库精选维护 | 18 |
| 上游索引 | 336 |
| 上游仓库 | 8 |
| 被安全门禁拦截 | 15 |
| 技能包 | 5 |
| 平均质量分 | 79 / 100 |
| 安全徽章为 clean | 317 |
| 支持 Agent | 80 |

上游来源：`openai/skills`、`anthropics/skills`、`obra/superpowers`、`addyosmani/agent-skills`、`vercel-labs/skills`、`kepano/obsidian-skills`、`wshobson/agents`、`coreyhaines31/marketingskills`。每个条目固定 commit SHA 并链接回原目录。

三个超大仓库只作为外部目录列出、不纳入索引：`github/awesome-copilot`（约 128 MB）、`K-Dense-AI/scientific-agent-skills`（约 471 MB）、`JimLiu/baoyu-skills`（约 34 MB）。

18 个精选技能全部通过质量门禁 100/100（A+）；安全扫描均为 A+（`terminal-debugger` 有一条已说明的 info 级 `sudo` 提示）。

---

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `skillrig search [query]` | 按名称、描述、标签、分类、来源搜索 |
| `skillrig info <name\|pack>` | 完整元数据、来源、许可证、完整性、安全 |
| `skillrig install <source...>` | 注册表、GitHub、本地路径、`.skm` 包或 pack |
| `skillrig remove <name...>` | 只删除受管安装 |
| `skillrig list` | 已安装技能与漂移状态 |
| `skillrig update <name...\|--all>` | 从原始来源重装 |
| `skillrig doctor [--fix]` | 锁文件、依赖、版本、未管理目录、AGENTS.md |
| `skillrig scan <source>` | 安全扫描、门禁与 SARIF |
| `skillrig audit` | 重新扫描所有已安装技能 |
| `skillrig verify` | 校验注册表签名或文件完整性 |
| `skillrig budget` | 已安装技能的上下文成本 |
| `skillrig init <name>` | 生成完整 `SKILL.md` 模板 |
| `skillrig pack <dir...>` | 构建 `.skm` 包 |
| `skillrig publish <dir>` | 生成签名包与注册表条目 |
| `skillrig migrate --from <dir>` | 从其他 Agent 导入技能 |
| `skillrig targets` | 80 种 Agent 的项目/全局路径 |
| `skillrig sync` | 更新 `AGENTS.md` 受管区块 |
| `skillrig config` | 注册表 URL、默认值、安全策略 |
| `skillrig mcp` | MCP stdio 服务器 |
| `skillrig completion <shell>` | bash、zsh、fish、PowerShell |

完整参数：[docs/commands.md](docs/commands.md)。

---

## 安全模型

**威胁模型。** 假设注册表可能经不可信网络分发、上游仓库可能被入侵、技能可能包含恶意指令。不假设扫描器能发现一切。

**防线。**

1. Ed25519 签名覆盖索引原始字节，解析前校验。
2. 每个技能一个目录树哈希（路径、权限、内容），锁文件固定。
3. 安装前静态扫描 + 严重级别门禁（`--fail-on`、`--allow-risky`）。
4. 安装与扫描过程不执行技能自带脚本。
5. 只写入 Agent 技能目录；删除时拒绝目录外路径。
6. 上游条目固定在 commit，不跟随移动分支。
7. 被抑制的告警会计数、记录并可通过 `--show-suppressed` 查看。

**不做的事。** 扫描器不是沙箱。精心构造的文本仍可能影响 Agent。把第三方技能当作代码来审查，优先使用精选条目，执行 `--allow-risky` 前先 `scan`。

完整说明：[SECURITY.md](SECURITY.md) 与 [docs/security-model.md](docs/security-model.md)。

---

## 贡献

1. `skillrig init my-skill --description "Use when ..."`
2. 详细资料放 `references/`，脚本放 `scripts/`。
3. `skillrig scan my-skill`，修复或带理由抑制每条告警。
4. `npm run validate`（质量 ≥70，安全门禁 high）。
5. 用技能提交模板开 PR。

规范：[docs/skill-spec.md](docs/skill-spec.md)。参与方式：[CONTRIBUTING.md](CONTRIBUTING.md)。行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

安全漏洞请使用 GitHub 私密漏洞报告，不要开公开 issue。

---

## 开发

```bash
npm test                # 48 个测试，不联网
npm run validate        # 全部技能：质量 + 安全
npm run build           # 注册表 + 插件 + 站点
npm run build:registry  # 精选 + 上游 -> registry/index.json
npm run sign            # 签名（需要 ~/.skillrig/keys/skillrig.private.pem）
npm run verify          # 校验签名
npm run build:plugin    # 同步 plugins/skillrig 与 Codex 市场
npm run build:site      # 生成 site/data.js
```

项目**零运行时依赖**，只使用 Node 内置模块：`node:crypto`、`node:zlib`、`node:test`。

架构：[docs/architecture.md](docs/architecture.md)。注册表格式：[docs/registry.md](docs/registry.md)。Codex 集成：[docs/codex.md](docs/codex.md)。

---

## 许可证

MIT。上游技能保留各自许可证；注册表为每个技能记录许可证并链接回原目录。

维护者：[Li Xiaocheng](https://github.com/LIXIAO199115)。
