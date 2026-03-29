# customize
魔改了z3r0yu的sec-daily-digest，去掉了`sec-digest.ts`执行过程中和额外的LLM交互的逻辑，改由返回给调用这个skill的LLM/Agent处理信息，所以使用skill时不用在运行环境里额外配置BASE_URL和API_KEY

# sec-daily-digest

英文主文档请见 [README.md](README.md)。

`sec-daily-digest` 是一个 **AI Agent Skill**，从 CyberSecurityRSS 的 OPML 源**和 Twitter/X 安全/AI 研究员账号**抓取最新内容，结合历史去重、漏洞事件聚合、数据源健康监控，生成面向网络空间安全研究员的中英混合日报。AI 评分、摘要和趋势分析由**调用方 LLM 直接完成** —— 无需额外配置 API Key。

## 💬 一句话上手

跟你的 AI 助手说：

> **"生成今天的网络安全日报，重点关注漏洞和 APT 动态"**

助手会自动抓取订阅源、评分去重、摘要翻译、渲染日报——全程自动完成。

更多示例：

> 🗣️ "分析今日安全动态，输出到 ./output/digest.md"

> 🗣️ "生成本周安全周报，跳过 Twitter，重点关注 CVE"

> 🗣️ "带上全文抓取，发到邮箱 me@example.com"

## 📊 你会得到什么

基于 **双路数据源**（安全 RSS + Twitter/X 研究员）的 AI 精选网络安全日报：

| 层级 | 规模 | 内容 |
|------|------|------|
| 📡 RSS（精简）| ~222 个订阅源 | `tiny.opml` 聚焦实战 — AI、Web安全、红蓝对抗、逆向、Pwn 等（9大分类） |
| 📡 RSS（完整）| 1000+ 个订阅源 | `CyberSecurityRSS.opml` 全局预警 — 覆盖更多维度如密码学、物联网硬件安全等（12大分类） |
| 🐦 Twitter/X | 15 位研究员 | Tavis Ormandy、Brian Krebs、Kevin Beaumont、Marcus Hutchins… |

### 数据管道

```
① 脚本：RSS 抓取 + Twitter KOL 抓取（并行）→ 去重 + 时间过滤 + 存档惩罚
         ↓ staging/fetched.json
② 调用方 LLM：评分 + 分类 → staging/scores.json
         ↓
③ 脚本：应用评分、平衡选取 top-N、漏洞聚合 → staging/selected.json
         ↓
④ 调用方 LLM：摘要 + 翻译 + 趋势分析
         ↓
⑤ 脚本：渲染 Markdown 日报 → 邮件分发（可选）
```

**质量评分**：优先级源 (+3)、历史去重惩罚 (−5)、关键词权重。

## 主要特性

- TypeScript + Bun 运行时，不引入新 npm 依赖
- **LLM-in-the-loop**：AI 评分、摘要和趋势分析由调用方 LLM 直接完成——无需额外 API Key
- **多阶段流水线**：`fetch` → `select` → `render` 三个子命令，通过 JSON 中间文件传递数据
- **双源监控**：CyberSecurityRSS OPML + Twitter/X 安全研究员账号（并行抓取）
- **历史去重**：过去 7 天出现过的文章降权 −5 分；存档文件 90 天后自动清理
- **数据源健康监控**：记录每个数据源的抓取成败；失败率超过 50% 时在日报末尾报警
- **全文抓取**（`--enrich`）：评分前抓取文章正文，提升分类与摘要质量
- **邮件分发**（`--email`）：通过 `gog` 发送日报
- 每次运行前强制检查 OPML 更新
  - 默认：`tiny.opml`
  - 可选：`CyberSecurityRSS.opml`（`--opml full`）
  - 远端检查失败时：继续执行并使用本地缓存 OPML
- 排序权重：安全 50% + AI 50%
- 评分展示：`🔥N`（整数，范围 1–10）
- 漏洞聚合：CVE 优先 + 语义聚类兜底
- 渐进式降级：无 LLM 评分/摘要时，自动回退到规则评分和文本截断
- 输出版块：
  - `## 📝 今日趋势` — 宏观趋势总结
  - `## 🔐 Security KOL Updates` — Twitter/X KOL 推文（有凭证时显示）
  - `## AI发展` — AI/LLM 相关文章
  - `## 安全动态` — 安全相关文章
  - `## 漏洞专报` — 聚合漏洞事件
  - `## ⚠️ Source Health Warnings` — 异常数据源（检测到时显示）

## 配置与状态

持久化目录：`~/.sec-daily-digest/`（可通过 `SEC_DAILY_DIGEST_HOME` 覆盖）

| 文件 / 目录 | 说明 |
|------------|------|
| `config.yaml` | 主配置（hours、top_n、weights…） |
| `sources.yaml` | Twitter/X KOL 列表 + 自定义 RSS 源 |
| `health.json` | 各数据源抓取健康历史 |
| `archive/YYYY-MM-DD.json` | 每日文章存档，用于历史去重 |
| `staging/` | 流水线各阶段的 JSON 中间文件 |
| `twitter-id-cache.json` | Twitter 用户 ID 缓存（仅官方 API，7 天 TTL） |
| `opml/tiny.opml` | 精简 OPML 缓存 |
| `opml/CyberSecurityRSS.opml` | 完整 OPML 缓存 |

## 快速开始（作为 Skill）

推荐使用方式是作为 AI Agent Skill。安装后（见 [Skill 安装方式](#skill-安装方式)），对你的 AI 助手说：

```text
/sec-digest
```

AI 助手会自动编排所有阶段。

## 快速开始（CLI）

也可以手动运行各个阶段：

```bash
cd /path/to/sec-daily-digest
bun install

# 阶段 1：抓取文章
bun scripts/sec-digest.ts fetch --hours 48 --opml tiny

# 阶段 2：（手动写入 scores.json 或跳过以使用规则评分兜底）

# 阶段 3：选取精华文章
bun scripts/sec-digest.ts select --top-n 20

# 阶段 4：（手动写入 summaries.json 或跳过以使用文本截断兜底）

# 阶段 5：渲染日报
bun scripts/sec-digest.ts render --output ./output/digest.md

# 带 Twitter KOL
TWITTERAPI_IO_KEY=your-key bun scripts/sec-digest.ts fetch --hours 48

# 周报模式
bun scripts/sec-digest.ts fetch --mode weekly

# 带全文抓取
bun scripts/sec-digest.ts fetch --enrich --hours 48
```

## CLI 子命令

### `fetch` — 数据采集

```bash
bun scripts/sec-digest.ts fetch [选项]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--opml <profile>` | `tiny\|full` | `tiny` |
| `--hours <n>` | 时间窗口（小时） | `48` |
| `--mode <daily\|weekly>` | 快捷方式：daily=48h，weekly=168h | — |
| `--enrich` | 评分前抓取全文 | false |
| `--no-twitter` | 禁用 Twitter/X KOL 抓取 | false |

输出：`~/.sec-daily-digest/staging/fetched.json`

### `select` — 评分应用 & 文章选取

```bash
bun scripts/sec-digest.ts select [选项]
```

读取 `staging/fetched.json` + `staging/scores.json`（如果存在）。

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--top-n <n>` | 最多选取文章数 | `20` |

输出：`~/.sec-daily-digest/staging/selected.json`

### `render` — Markdown 渲染

```bash
bun scripts/sec-digest.ts render [选项]
```

读取 `staging/selected.json` + `staging/summaries.json`（如果存在）。

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--output <path>` | 输出 markdown 路径 | `./output/sec-digest-YYYYMMDD.md` |
| `--highlights <text>` | 趋势总结文本 | （自动生成兜底） |
| `--highlights-file <path>` | 从文件读取趋势总结 | — |
| `--email <addr>` | 通过 `gog` 发送日报 | — |

## 环境变量

### Twitter/X

| 变量 | 说明 |
|------|------|
| `TWITTERAPI_IO_KEY` | [twitterapi.io](https://twitterapi.io) API Key，推荐，5 QPS |
| `X_BEARER_TOKEN` | 官方 Twitter API v2 Bearer Token |
| `TWITTER_API_BACKEND` | `twitterapiio\|official\|auto`（默认 `auto`） |

后端自动选择逻辑：
- 有 `TWITTERAPI_IO_KEY` → 使用 twitterapi.io
- 仅有 `X_BEARER_TOKEN` → 使用官方 API
- 两者均无 → Twitter 静默跳过（不报错）

### 其他

| 变量 | 说明 |
|------|------|
| `SEC_DAILY_DIGEST_HOME` | 覆盖状态目录（默认 `~/.sec-daily-digest`） |

## 配置 RSS 订阅源

RSS 源来自 CyberSecurityRSS OPML 文件（自动同步）。如需在 OPML 之外添加自定义 RSS 源，编辑 `~/.sec-daily-digest/sources.yaml`：

```yaml
sources:
  - id: my-blog
    type: rss
    name: "我的安全博客"
    url: "https://myblog.example.com/feed.xml"
    enabled: true
    priority: false
    topics:
      - security
    note: "个人博客，按周更新"
```

### RSS 源字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 所有源中的唯一标识符。若与某个默认源 ID 相同，该默认条目将被完整替换为此条目。 |
| `type` | `"rss"` | 是 | RSS/Atom 订阅源固定填 `"rss"`。 |
| `name` | string | 是 | 人类可读的显示名称，出现在日报来源标注行和健康警告报告中。 |
| `url` | string | 是 | RSS 或 Atom Feed 的完整 URL。 |
| `enabled` | boolean | 是 | 设为 `false` 即可禁用该源而无需删除条目。禁用默认源时，只需提供 `{id, enabled: false}` 即可，无需填写其他字段。 |
| `priority` | boolean | 是 | 设为 `true` 后，该源的文章在质量评分阶段获得 **+3 分加成**，有助于在同类内容中脱颖而出。适用于你希望始终出现在日报中的高信噪比订阅源。 |
| `topics` | string[] | 是 | 主题标签，用于元数据标注与分类。示例值：`security`、`ai`、`exploit`、`malware`。当前仅用于标记，评分本身基于关键词匹配。 |
| `note` | string | 否 | 自由文本备注，仅供个人参考，不参与评分或输出。 |

## 配置 Twitter/X 监控账号

首次运行时，`~/.sec-daily-digest/sources.yaml` 会自动创建，预置 15 位安全研究员（Tavis Ormandy、Brian Krebs、Kevin Beaumont、Marcus Hutchins 等）。

### 禁用某个默认账号

只需提供 `id` + `enabled: false`，其他字段可省略：

```yaml
sources:
  - id: thegrugq
    enabled: false
```

### 添加新账号

```yaml
sources:
  - id: myresearcher
    type: twitter
    name: "某安全研究员"
    handle: myresearcher
    enabled: true
    priority: false
    topics:
      - security
    note: "专注 APT 溯源"
```

### 覆盖默认账号的完整配置

提供相同 `id` 的完整条目即可覆盖所有字段：

```yaml
sources:
  - id: taviso
    type: twitter
    name: "Tavis Ormandy"
    handle: taviso
    enabled: true
    priority: true
    topics:
      - security
      - exploit
    note: "Google Project Zero"
```

### Twitter 源字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 所有源中的唯一标识符，不能与 RSS 源 ID 重复。若与某个默认 Twitter 源 ID 相同，该默认条目将被完整替换。 |
| `type` | `"twitter"` | 是 | Twitter/X 账号固定填 `"twitter"`。 |
| `name` | string | 是 | 显示名称，出现在日报的 `🔐 Security KOL Updates` 版块中，可与 Twitter 主页上的显示名称不同。 |
| `handle` | string | 是 | Twitter/X 用户名，**不含 `@` 前缀**。例：`briankrebs`（而非 `@briankrebs`）。 |
| `enabled` | boolean | 是 | 设为 `false` 停止抓取该账号。禁用默认账号时，只需 `{id, enabled: false}` 即可，无需填写其他字段。 |
| `priority` | boolean | 是 | 设为 `true` 后，该账号的推文在文章排序阶段获得 **+3 分加成**，有助于推文进入日报的 AI发展 / 安全动态 版块。适用于你希望始终被采纳的高价值账号。 |
| `topics` | string[] | 是 | 主题标签，用于元数据标注。不影响抓取行为——无论 topics 如何设置，已启用账号的所有推文均会被抓取。 |
| `note` | string | 否 | 自由文本备注，仅供个人参考，不参与评分或输出。 |

> **合并规则：** 每次运行时，程序会将默认的 15 个账号列表与你的 `sources.yaml` 合并。相同 `id` 的条目会替换默认值；新 `id` 追加到列表末尾。这意味着未来版本新增的默认账号会自动出现，除非你显式将其禁用。

## 邮件分发

需要安装 [`gogcli`](https://github.com/steipete/gogcli)——基于官方 Gmail API 的命令行工具：

```bash
# 安装（macOS）
brew install steipete/tap/gogcli

# 一次性授权
gog auth login

# 在 render 阶段发送日报
bun scripts/sec-digest.ts render --email me@example.com --output ./output/digest.md
```

`--email` 标志内部调用：
```bash
gog gmail send --to <addr> --subject "sec-daily-digest YYYY-MM-DD" --body-file -
```

## Skill 安装方式

先设置本地 skill 路径：

```bash
SKILL_SRC="~/z3dev/Skills/sec-daily-digest"
```

### OpenClaw

```bash
clawhub install sec-daily-digest
```

### Claude Code

个人技能安装：

```bash
mkdir -p ~/.claude/skills
ln -sfn "$SKILL_SRC" ~/.claude/skills/sec-daily-digest
```

项目级安装：

```bash
mkdir -p ./.claude/skills
ln -sfn "$SKILL_SRC" ./.claude/skills/sec-daily-digest
```

### Codex

```bash
mkdir -p ~/.agents/skills
ln -sfn "$SKILL_SRC" ~/.agents/skills/sec-daily-digest
```

### OpenCode

用户级：

```bash
mkdir -p ~/.config/opencode/skills
ln -sfn "$SKILL_SRC" ~/.config/opencode/skills/sec-daily-digest
```

项目级：

```bash
mkdir -p ./.opencode/skills
ln -sfn "$SKILL_SRC" ./.opencode/skills/sec-daily-digest
```

## 作为 Skill 触发

```text
/sec-digest
```

## 测试

```bash
bun test
```
