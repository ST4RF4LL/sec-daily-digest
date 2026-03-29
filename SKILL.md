---
name: sec-daily-digest
version: "0.3.0"
description: "Use when asked to generate a cybersecurity daily digest from CyberSecurityRSS OPML feeds and Twitter/X KOL accounts. The skill splits into fetch → AI scoring → select → AI summary → render stages, where YOU (the calling LLM) handle the AI stages directly."
env:
  # Twitter/X sources (optional; at least one enables KOL section)
  TWITTERAPI_IO_KEY: twitterapi.io API key (preferred)
  X_BEARER_TOKEN: Official Twitter API v2 bearer token
  TWITTER_API_BACKEND: "twitterapiio|official|auto" (default: auto)
  # State directory
  SEC_DAILY_DIGEST_HOME: Custom state root (default: ~/.sec-daily-digest)
---

# Sec Daily Digest

Generate a daily cybersecurity digest for researchers from CyberSecurityRSS OPML feeds and Twitter/X security KOL accounts.
Trigger command: `/sec-digest`.

## When to Use

- The user asks for a daily or latest cybersecurity digest.
- The user needs balanced AI + security coverage from RSS feeds.
- The user wants Twitter/X KOL security updates alongside RSS content.
- The task needs merged vulnerability events (CVE-first + non-CVE clustering).

## When Not to Use

- The user wants ad-hoc one-off article summaries (use direct summarization instead).

## Architecture

This skill uses a **multi-stage pipeline** where data-intensive work (fetch, filter, render) is done by scripts, and **intelligence work (scoring, summarization, trend analysis) is done by YOU** — the calling LLM.

```
YOU orchestrate:
  ① Script: fetch → staging/fetched.json
  ② YOU: score articles → staging/scores.json
  ③ Script: select top-N → staging/selected.json
  ④ YOU: summarize + highlights → staging/summaries.json
  ⑤ Script: render → final Markdown
```

## Execution Steps

### Stage 1: Data Fetch

Run the fetch command. This syncs OPML, fetches RSS feeds and Twitter KOLs, deduplicates, and time-filters.

```bash
cd <skill-root>
bun scripts/sec-digest.ts fetch --hours 48 --opml tiny
```

Options:
- `--hours <n>` — time window (default: 48)
- `--opml <tiny|full>` — OPML profile (default: tiny)
- `--mode <daily|weekly>` — shortcut: daily=48h, weekly=168h
- `--enrich` — fetch full text before scoring (improves your classification)
- `--no-twitter` — disable Twitter KOL fetching

Output: `~/.sec-daily-digest/staging/fetched.json`

### Stage 2: AI Scoring (YOU do this)

Read `~/.sec-daily-digest/staging/fetched.json`. For each article in the `articles` array, produce a multi-dimensional score.

**Input format** (each article in fetched.json):
```json
{
  "index": 0,
  "title": "Critical CVE in AI gateway",
  "link": "https://example.com/a",
  "description": "CVE-2026-11111 affects model serving layer",
  "sourceName": "source-a",
  "fullText": "..."
}
```

**Your task**: For each article, evaluate and score:

| Dimension | Range | Description |
|-----------|-------|-------------|
| `relevance` | 1-10 | 总体阅读价值 |
| `quality` | 1-10 | 信息质量与技术深度 |
| `timeliness` | 1-10 | 时效性 |
| `security` | 1-10 | 安全相关性 |
| `ai` | 1-10 | AI/LLM 相关性 |
| `category` | enum | `ai-ml` / `security` / `engineering` / `tools` / `opinion` / `other` |
| `keywords` | string[] | 2-4 English keywords, technology-focused |

**Write** the results to `~/.sec-daily-digest/staging/scores.json`:

```json
{
  "results": [
    {
      "index": 0,
      "relevance": 8,
      "quality": 7,
      "timeliness": 9,
      "security": 8,
      "ai": 3,
      "category": "security",
      "keywords": ["CVE", "RCE", "patch"]
    }
  ]
}
```

> **Important**: The `index` field must match the article's `index` in fetched.json. Score ALL articles.

### Stage 3: Article Selection

Run the select command. This applies your scores, computes composite rankings, picks balanced top-N, merges vulnerability events, and tracks source health.

```bash
bun scripts/sec-digest.ts select --top-n 20
```

Options:
- `--top-n <n>` — max articles to select (default: 20)

Output: `~/.sec-daily-digest/staging/selected.json`

### Stage 4: AI Summary + Trends (YOU do this)

Read `~/.sec-daily-digest/staging/selected.json`. For each article in the `articles` array, produce a Chinese summary.

**Your task** — for each selected article, generate:

| Field | Description |
|-------|-------------|
| `title_zh` | 中文标题（若原标题已是中文，可保持） |
| `summary_zh` | 4-6句结构化摘要（主题、关键信息、结论），保留关键术语和数字 |
| `reason_zh` | 1句推荐理由，说明为什么值得读 |

**Write** the results to `~/.sec-daily-digest/staging/summaries.json`:

```json
{
  "results": [
    {
      "index": 0,
      "title_zh": "AI 网关中发现严重 CVE 漏洞",
      "summary_zh": "CVE-2026-11111 影响模型服务层...",
      "reason_zh": "该漏洞影响主流 AI 推理平台，需立即关注"
    }
  ]
}
```

**Also generate trend highlights**: Based on the selected articles, write 3-5 sentences of macro trend analysis in Chinese. Think of it as an intelligence brief lead paragraph — concise, direct, synthesizing 2-3 major trends without listing individual articles.

### Stage 5: Render

Run the render command. This applies your summaries, renders the final Markdown digest, writes the archive, and optionally sends email.

```bash
bun scripts/sec-digest.ts render \
  --highlights "今日安全趋势：..." \
  --output ./output/digest.md
```

Options:
- `--output <path>` — output file path (default: `./output/sec-digest-YYYYMMDD.md`)
- `--highlights <text>` — your trend summary text
- `--highlights-file <path>` — read highlights from file
- `--email <addr>` — send digest via `gog` to this address

Output: Final Markdown digest file.

## Quick Reference

- Entrypoint: `scripts/sec-digest.ts`
- Pipeline: `src/pipeline/run.ts` (exports `runFetch`, `runSelect`, `runRender`)
- Config root: `~/.sec-daily-digest/`
- Staging dir: `~/.sec-daily-digest/staging/`
- Config file: `~/.sec-daily-digest/config.yaml`
- Sources file: `~/.sec-daily-digest/sources.yaml`
- Health file: `~/.sec-daily-digest/health.json`
- Archive dir: `~/.sec-daily-digest/archive/`

## Output Sections

The rendered digest contains these sections:
- `## 📝 今日趋势` — your trend highlights
- `## 🔐 Security KOL Updates` — Twitter/X KOL tweets (when present)
- `## AI发展` — AI/LLM articles
- `## 安全动态` — security articles
- `## 漏洞专报` — merged vulnerability events
- `## ⚠️ Source Health Warnings` — unhealthy sources (when detected)

## Twitter/X Configuration

Twitter KOL accounts are configured in `~/.sec-daily-digest/sources.yaml` (auto-created on first run with 15 default security researchers). See `README.md` for details on adding/disabling accounts.

## Common Mistakes

1. Forgetting to run stages in order (fetch → score → select → summarize → render).
2. Writing scores.json with wrong `index` values that don't match fetched.json.
3. Not setting `TWITTERAPI_IO_KEY` or `X_BEARER_TOKEN` and expecting Twitter KOLs.

## Success Signals

1. `fetched.json` contains articles with index numbers.
2. `scores.json` has valid results matching article indices.
3. `selected.json` contains balanced top-N articles.
4. `summaries.json` has Chinese titles and summaries for all selected articles.
5. Output markdown contains the five required sections.
6. `~/.sec-daily-digest/archive/YYYY-MM-DD.json` is written after render.

## More Detail

For full installation and extended usage notes, see `README.md` and `README.zh-CN.md`.
