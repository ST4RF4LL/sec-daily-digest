# customize
Forked from z3r0yu's sec-daily-digest. Removed the extra LLM interaction logic during `sec-digest.ts` execution — AI work is now delegated back to the calling LLM/Agent that invokes this skill. No need to configure BASE_URL or API_KEY in the runtime environment.

# sec-daily-digest

English is the primary README. Chinese version: [README.zh-CN.md](README.zh-CN.md).

`sec-daily-digest` is an **AI Agent Skill** that fetches recent articles from CyberSecurityRSS OPML feeds **and Twitter/X security / AI KOL accounts**, deduplicates against historical archives, merges vulnerability events, monitors source health, and generates a bilingual daily markdown digest for cybersecurity researchers. AI scoring, summarization, and trend analysis are handled by **the calling LLM itself** — no external API keys required.

## 💬 One-Liner

Tell your AI assistant:

> **"Generate today's cybersecurity digest, focus on vulnerabilities and APT activity"**

The assistant fetches, scores, deduplicates, and renders a full Markdown report — hands-free.

More examples:

> 🗣️ "Analyze today's security news, output to ./output/digest.md"

> 🗣️ "Generate this week's security roundup, skip Twitter, focus on CVEs"

> 🗣️ "Full-text enrichment, email digest to me@example.com"

## 📊 What You Get

An AI-scored, deduplicated cybersecurity digest from **dual data sources** (security RSS + Twitter/X researchers):

| Layer | Scale | Content |
|-------|-------|-------|
| 📡 RSS (tiny) | ~50 feeds | CyberSecurityRSS curated — vulns, threat intel, malware… |
| 📡 RSS (full) | 400+ feeds | Full CyberSecurityRSS OPML (`--opml full`) |
| 🐦 Twitter/X | 15 researchers | Tavis Ormandy, Brian Krebs, Kevin Beaumont, Marcus Hutchins… |

### Pipeline

```
① Script: RSS fetch + Twitter KOL fetch (parallel) → dedup + time filter + archive penalty
         ↓ staging/fetched.json
② Calling LLM: scores + classifies articles → staging/scores.json
         ↓
③ Script: apply scores, pick balanced top-N, merge vulns → staging/selected.json
         ↓
④ Calling LLM: summarizes + translates articles, generates trend highlights
         ↓
⑤ Script: render Markdown digest → email delivery (optional)
```

**Quality scoring**: priority source (+3), archive penalty (−5), keyword weights, recency.

## Highlights

- TypeScript + Bun runtime, no new npm dependencies
- **LLM-in-the-loop**: AI scoring, summarization and trend analysis are done by the calling LLM — no external API keys needed
- **Multi-stage pipeline**: `fetch` → `select` → `render` subcommands with JSON staging files
- **Dual source monitoring**: CyberSecurityRSS OPML + Twitter/X security KOLs (parallel fetch)
- **Historical dedup**: articles seen in the past 7 days receive a −5 score penalty; archive auto-cleans after 90 days
- **Source health monitoring**: tracks per-source fetch failures; surfaces unhealthy sources in digest footer
- **Full-text enrichment** (`--enrich`): fetches article body before scoring for better classification
- **Email delivery** (`--email`): sends digest via `gog`
- Mandatory OPML update check before each run
  - Default profile: `tiny.opml`
  - Optional profile: `CyberSecurityRSS.opml` (`--opml full`)
  - On remote check failure: continue with cached OPML
- Balanced ranking: Security 50% + AI 50%
- Score display: `🔥N` (integer, 1–10 range)
- Vulnerability merge: CVE-first + semantic clustering fallback
- Graceful degradation: without LLM scores/summaries, falls back to rule-based scoring and text truncation
- Output sections:
  - `## 📝 今日趋势` — macro trend highlights
  - `## 🔐 Security KOL Updates` — Twitter/X KOL tweets (when credentials present)
  - `## AI发展` — AI/LLM articles
  - `## 安全动态` — security articles
  - `## 漏洞专报` — merged vulnerability events
  - `## ⚠️ Source Health Warnings` — unhealthy sources (when detected)

## Config and State

Persistent directory: `~/.sec-daily-digest/` (override with `SEC_DAILY_DIGEST_HOME`)

| File / Directory | Description |
|-----------------|-------------|
| `config.yaml` | Main config (hours, top_n, weights…) |
| `sources.yaml` | Twitter/X KOL list + custom RSS sources |
| `health.json` | Per-source fetch health history |
| `archive/YYYY-MM-DD.json` | Daily article archive for historical dedup |
| `staging/` | Intermediate JSON files between pipeline stages |
| `twitter-id-cache.json` | Twitter user ID cache (official API only, 7-day TTL) |
| `opml/tiny.opml` | Cached tiny OPML |
| `opml/CyberSecurityRSS.opml` | Cached full OPML |

## Quick Start (as Skill)

The recommended way to use sec-daily-digest is as an AI Agent Skill. Install the skill (see [Install This Skill](#install-this-skill)) and tell your AI assistant:

```text
/sec-digest
```

The AI assistant will orchestrate all stages automatically.

## Quick Start (CLI)

You can also run individual stages manually:

```bash
cd /path/to/sec-daily-digest
bun install

# Stage 1: Fetch articles
bun scripts/sec-digest.ts fetch --hours 48 --opml tiny

# Stage 2: (manually write scores.json or skip for rule-based fallback)

# Stage 3: Select top articles
bun scripts/sec-digest.ts select --top-n 20

# Stage 4: (manually write summaries.json or skip for text truncation fallback)

# Stage 5: Render digest
bun scripts/sec-digest.ts render --output ./output/digest.md

# With Twitter KOLs
TWITTERAPI_IO_KEY=your-key bun scripts/sec-digest.ts fetch --hours 48

# Weekly mode
bun scripts/sec-digest.ts fetch --mode weekly

# With full-text enrichment
bun scripts/sec-digest.ts fetch --enrich --hours 48
```

## CLI Subcommands

### `fetch` — Data Collection

```bash
bun scripts/sec-digest.ts fetch [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--opml <profile>` | `tiny\|full` | `tiny` |
| `--hours <n>` | Time window in hours | `48` |
| `--mode <daily\|weekly>` | Shortcut: daily=48h, weekly=168h | — |
| `--enrich` | Fetch full text before scoring | false |
| `--no-twitter` | Disable Twitter/X KOL fetching | false |

Output: `~/.sec-daily-digest/staging/fetched.json`

### `select` — Score Application & Selection

```bash
bun scripts/sec-digest.ts select [options]
```

Reads `staging/fetched.json` + `staging/scores.json` (if present).

| Flag | Description | Default |
|------|-------------|---------|
| `--top-n <n>` | Max articles to select | `20` |

Output: `~/.sec-daily-digest/staging/selected.json`

### `render` — Markdown Generation

```bash
bun scripts/sec-digest.ts render [options]
```

Reads `staging/selected.json` + `staging/summaries.json` (if present).

| Flag | Description | Default |
|------|-------------|---------|
| `--output <path>` | Output markdown file path | `./output/sec-digest-YYYYMMDD.md` |
| `--highlights <text>` | Trend summary text | (auto-generated fallback) |
| `--highlights-file <path>` | Read highlights from file | — |
| `--email <addr>` | Send digest via `gog` | — |

## Environment Variables

### Twitter/X

| Variable | Description |
|----------|-------------|
| `TWITTERAPI_IO_KEY` | [twitterapi.io](https://twitterapi.io) key — preferred, 5 QPS |
| `X_BEARER_TOKEN` | Official Twitter API v2 bearer token |
| `TWITTER_API_BACKEND` | `twitterapiio\|official\|auto` (default: `auto`) |

Backend selection logic:
- `TWITTERAPI_IO_KEY` set → use twitterapi.io
- Only `X_BEARER_TOKEN` set → use official API
- Neither set → Twitter silently disabled (no crash)

### Other

| Variable | Description |
|----------|-------------|
| `SEC_DAILY_DIGEST_HOME` | Override state directory (default: `~/.sec-daily-digest`) |

## Configuring RSS Sources

RSS feeds come from CyberSecurityRSS OPML files (synced automatically). To add custom RSS sources on top of OPML, edit `~/.sec-daily-digest/sources.yaml`:

```yaml
sources:
  - id: my-blog
    type: rss
    name: "My Security Blog"
    url: "https://myblog.example.com/feed.xml"
    enabled: true
    priority: false
    topics:
      - security
    note: "Personal blog, check weekly"
```

### RSS Source Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier across all sources. If it matches a default source ID, the entire default entry is replaced by this one. |
| `type` | `"rss"` | yes | Must be `"rss"` for RSS/Atom feed sources. |
| `name` | string | yes | Human-readable display name — shown in source attribution lines and health warning reports. |
| `url` | string | yes | Full URL of the RSS or Atom feed to fetch. |
| `enabled` | boolean | yes | Set to `false` to disable this source without deleting the entry. For default sources, a minimal `{id, enabled: false}` entry is sufficient. |
| `priority` | boolean | yes | If `true`, articles from this source receive a **+3 quality score bonus**, helping them surface above lower-priority sources with similar content. Use for high-signal feeds you always want represented. |
| `topics` | string[] | yes | Topic tags for metadata and categorization. Example values: `security`, `ai`, `exploit`, `malware`. Currently used for labeling; scoring is keyword-based. |
| `note` | string | no | Free-text description for your own reference. Not used in scoring or output. |

## Configuring Twitter/X KOL Accounts

On first run, `~/.sec-daily-digest/sources.yaml` is auto-created with 15 default security researchers (Tavis Ormandy, Brian Krebs, Kevin Beaumont, Marcus Hutchins, etc.).

### Disable a default account

Provide only `id` + `enabled: false` — no other fields needed:

```yaml
sources:
  - id: thegrugq
    enabled: false
```

### Add a new account

```yaml
sources:
  - id: myresearcher
    type: twitter
    name: "My Researcher"
    handle: myresearcher
    enabled: true
    priority: false
    topics:
      - security
    note: "Tracks APT campaigns"
```

### Replace a default account's config

Provide a full entry with the same `id` to override all fields:

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

### Twitter Source Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier across all sources. Must not collide with RSS source IDs. If it matches a default Twitter source ID, the entire default entry is replaced. |
| `type` | `"twitter"` | yes | Must be `"twitter"` for Twitter/X account sources. |
| `name` | string | yes | Display name shown in the `🔐 Security KOL Updates` section of the digest. Can differ from the Twitter display name. |
| `handle` | string | yes | Twitter/X username **without** the `@` prefix. Example: `briankrebs` (not `@briankrebs`). |
| `enabled` | boolean | yes | Set to `false` to stop fetching this account. A minimal `{id, enabled: false}` entry disables a default source without needing all fields. |
| `priority` | boolean | yes | If `true`, tweets from this account receive a **+3 quality score bonus** in the article ranking pipeline. Useful for accounts whose tweets you always want in the AI发展 / 安全动态 sections. |
| `topics` | string[] | yes | Topic tags for metadata. Does not affect fetching — all tweets from an enabled account are fetched regardless. |
| `note` | string | no | Free-text description for your own reference. Not used in scoring or output. |

> **Merge behavior:** On each run, the default 15-account list is merged with your `sources.yaml`. Entries with matching `id` replace defaults; new `id`s are appended. This means new default accounts added in future releases will appear automatically — unless you explicitly disable them.

## Email Delivery

Requires [`gogcli`](https://github.com/steipete/gogcli) — a Gmail CLI that uses the official Gmail API:

```bash
# Install (macOS)
brew install steipete/tap/gogcli

# Authenticate (one-time)
gog auth login

# Send digest via email (in the render stage)
bun scripts/sec-digest.ts render --email me@example.com --output ./output/digest.md
```

Under the hood, the `--email` flag calls:
```bash
gog gmail send --to <addr> --subject "sec-daily-digest YYYY-MM-DD" --body-file -
```

## Install This Skill

Set source path:

```bash
SKILL_SRC="~/z3dev/Skills/sec-daily-digest"
```

### OpenClaw

```bash
clawhub install sec-daily-digest
```

### Claude Code

Install as a personal skill:

```bash
mkdir -p ~/.claude/skills
ln -sfn "$SKILL_SRC" ~/.claude/skills/sec-daily-digest
```

Or project-local:

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

User-level:

```bash
mkdir -p ~/.config/opencode/skills
ln -sfn "$SKILL_SRC" ~/.config/opencode/skills/sec-daily-digest
```

Project-level:

```bash
mkdir -p ./.opencode/skills
ln -sfn "$SKILL_SRC" ./.opencode/skills/sec-daily-digest
```

## Run as a Skill

```text
/sec-digest
```

## Tests

```bash
bun test
```
