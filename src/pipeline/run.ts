import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyArchivePenalty, dedupeByUrl, filterByHours } from "../articles/normalize";
import { enrichArticles } from "../articles/enrich";
import { readRecentArchive, writeArchiveEntry, cleanOldArchive } from "../archive/store";
import { loadConfig } from "../config/load";
import { getStateRoot } from "../config/paths";
import { loadSourcesConfig, getTwitterSources } from "../config/sources";
import { sendEmailViaGog } from "../delivery/email";
import { loadHealthStore, saveHealthStore, recordSourceResult, getUnhealthySources } from "../health/store";
import { mergeVulnerabilityItems } from "../merge/vuln";
import { parseOpmlFeeds } from "../opml/parse";
import { syncOpml } from "../opml/sync";
import { renderDigest } from "../report/markdown";
import { fetchAllFeeds, type FeedSource } from "../rss/fetch";
import type { Article } from "../rss/parse";
import { fetchTwitterKols } from "../twitter/fetch";
import type { TwitterSourceResult } from "../twitter/backends/types";
import { fallbackHighlights } from "./stages/highlights";
import { applyExternalScores } from "./stages/scoring";
import { applyExternalSummaries } from "./stages/summary";
import type { FinalArticle, ScoredArticle, ScoringResultItem, SummaryResultItem } from "./types";
import { parseScoringResults } from "../ai/parse";
import { parseSummaryResults } from "../ai/parse";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getStagingDir(env: NodeJS.ProcessEnv): string {
  return path.join(getStateRoot(env), "staging");
}

function splitByFocus<T extends { security: number; ai: number; score: number }>(items: T[]): { ai: T[]; security: T[] } {
  const ai: T[] = [];
  const security: T[] = [];

  for (const item of items) {
    if (item.security >= item.ai) {
      security.push(item);
    } else {
      ai.push(item);
    }
  }

  ai.sort((a, b) => b.score - a.score);
  security.sort((a, b) => b.score - a.score);
  return { ai, security };
}

function normalizeWeights(weights: { security: number; ai: number }): { security: number; ai: number } {
  const security = Math.max(0, weights.security);
  const ai = Math.max(0, weights.ai);
  const total = security + ai;
  if (total <= 0) {
    return { security: 0.5, ai: 0.5 };
  }
  return {
    security: security / total,
    ai: ai / total,
  };
}

function pickBalanced<T extends { security: number; ai: number; score: number }>(
  items: T[],
  topN: number,
  weights: { security: number; ai: number },
): { ai: T[]; security: T[]; selected: T[] } {
  const { ai, security } = splitByFocus(items);
  const normalized = normalizeWeights(weights);

  const secQuota = Math.max(0, Math.min(topN, Math.floor(topN * normalized.security)));
  const aiQuota = Math.max(0, Math.min(topN, Math.floor(topN * normalized.ai)));

  const pickedAi = ai.slice(0, aiQuota);
  const pickedSec = security.slice(0, secQuota);
  const selected: T[] = [...pickedAi, ...pickedSec];

  if (selected.length < topN) {
    const extras = items
      .filter((item) => !selected.includes(item))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN - selected.length);
    selected.push(...extras);
  }

  const rebucket = splitByFocus(selected);
  return {
    ai: rebucket.ai,
    security: rebucket.security,
    selected,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Fetch
// ---------------------------------------------------------------------------

export interface FetchOptions {
  opmlProfile?: "tiny" | "full";
  hours?: number;
  enrich?: boolean;
  twitterEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetcher?: typeof fetch;
  seedArticles?: Article[];
  seedTwitterResults?: TwitterSourceResult[];
}

export interface FetchResult {
  articles: Array<Article & { index: number; fullText?: string }>;
  kols: Array<{
    displayName: string;
    handle: string;
    text: string;
    link: string;
    tweetId: string;
    metrics: { like_count: number; retweet_count: number; reply_count: number; quote_count: number; impression_count: number };
  }>;
  meta: {
    date: string;
    feedsCount: number;
    totalArticles: number;
    recentArticles: number;
    usedCache: boolean;
    twitterKols: number;
    feedResults: Array<{ id: string; name: string; ok: boolean }>;
    twitterResults: Array<{ sourceId: string; handle: string; status: string }>;
  };
}

async function loadArticles(options: {
  env: NodeJS.ProcessEnv;
  profile: "tiny" | "full";
  fetcher: typeof fetch;
  seedArticles?: Article[];
}): Promise<{ articles: Article[]; feedsCount: number; usedCache: boolean; feedResults: Array<{ id: string; name: string; ok: boolean }> }> {
  if (options.seedArticles && options.seedArticles.length > 0) {
    return {
      articles: options.seedArticles,
      feedsCount: 0,
      usedCache: false,
      feedResults: [],
    };
  }

  const syncResult = await syncOpml({
    profile: options.profile,
    env: options.env,
    fetcher: options.fetcher,
  });
  const opmlXml = await readFile(syncResult.opmlPath, "utf8");
  const feeds: FeedSource[] = parseOpmlFeeds(opmlXml);
  const { articles, results: feedResults } = await fetchAllFeeds(feeds, { fetcher: options.fetcher });

  return {
    articles,
    feedsCount: feeds.length,
    usedCache: syncResult.usedCache,
    feedResults,
  };
}

export async function runFetch(options: FetchOptions = {}): Promise<FetchResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const twitterEnabled = options.twitterEnabled !== false;

  const config = await loadConfig(
    {
      opml_profile: options.opmlProfile,
      time_range_hours: options.hours,
    },
    env,
  );

  const sourcesConfig = await loadSourcesConfig(env);
  const twitterSources = getTwitterSources(sourcesConfig);

  // Parallel RSS fetch + Twitter fetch
  const [articlesResult, twitterResult] = await Promise.all([
    loadArticles({
      env,
      profile: config.opml_profile === "full" ? "full" : "tiny",
      fetcher: options.fetcher ?? fetch,
      seedArticles: options.seedArticles,
    }),
    twitterEnabled && !options.seedTwitterResults
      ? fetchTwitterKols(twitterSources, {
          hours: config.time_range_hours,
          env,
          fetcher: options.fetcher,
        })
      : Promise.resolve({
          articles: options.seedTwitterResults?.flatMap((r) => r.tweets) ?? [],
          results: options.seedTwitterResults ?? [],
        }),
  ]);

  // Merge all articles
  const allArticles: Article[] = [...articlesResult.articles, ...twitterResult.articles];

  // Dedup + time filter
  const deduped = dedupeByUrl(allArticles).map((item) => ({
    ...item,
    link: item.link,
  }));
  const recent = filterByHours(deduped, config.time_range_hours, now);

  // Enrich articles if requested
  const enriched = options.enrich
    ? await enrichArticles(recent, { fetcher: options.fetcher ?? fetch })
    : recent;

  // KOL entries
  const kolEntries = twitterResult.articles.map((a) => ({
    displayName: a.displayName,
    handle: a.handle,
    text: a.text ?? a.title,
    link: a.link,
    tweetId: a.tweetId,
    metrics: a.metrics,
  }));

  const dateStr = toDateString(now);

  const result: FetchResult = {
    articles: enriched.map((a, i) => ({
      ...a,
      index: i,
      pubDate: a.pubDate,
      fullText: (a as { fullText?: string }).fullText,
    })),
    kols: kolEntries,
    meta: {
      date: dateStr,
      feedsCount: articlesResult.feedsCount,
      totalArticles: allArticles.length,
      recentArticles: recent.length,
      usedCache: articlesResult.usedCache,
      twitterKols: twitterResult.articles.length,
      feedResults: articlesResult.feedResults,
      twitterResults: twitterResult.results.map((r) => ({
        sourceId: r.sourceId,
        handle: r.handle,
        status: r.status,
      })),
    },
  };

  // Write staging
  const stagingDir = getStagingDir(env);
  await mkdir(stagingDir, { recursive: true });

  // Serialize with pubDate as ISO string for JSON
  const serialized = {
    ...result,
    articles: result.articles.map((a) => ({
      ...a,
      pubDate: a.pubDate instanceof Date ? a.pubDate.toISOString() : a.pubDate,
    })),
  };
  await writeFile(path.join(stagingDir, "fetched.json"), JSON.stringify(serialized, null, 2), "utf8");

  console.log(`[sec-digest:fetch] articles=${result.articles.length} kols=${kolEntries.length} date=${dateStr}`);
  return result;
}

// ---------------------------------------------------------------------------
// Stage 2: Select (apply scores + pick top-N)
// ---------------------------------------------------------------------------

export interface SelectOptions {
  topN?: number;
  env?: NodeJS.ProcessEnv;
}

export interface SelectResult {
  articles: ScoredArticle[];
  kols: FetchResult["kols"];
  vulnerabilities: Array<{
    title: string;
    summary: string;
    cves: string[];
    references: Array<{ source: string; link: string }>;
  }>;
  healthWarnings: string[];
  meta: {
    date: string;
    feedsCount: number;
    totalArticles: number;
    recentArticles: number;
    usedCache: boolean;
    twitterKols: number;
    selectedCount: number;
  };
}

export async function runSelect(options: SelectOptions = {}): Promise<SelectResult> {
  const env = options.env ?? process.env;
  const stagingDir = getStagingDir(env);

  const config = await loadConfig({ top_n: options.topN }, env);

  // Read fetched.json
  const fetchedRaw = JSON.parse(await readFile(path.join(stagingDir, "fetched.json"), "utf8"));
  const articles: Article[] = fetchedRaw.articles.map((a: Record<string, unknown>) => ({
    ...a,
    pubDate: new Date(a.pubDate as string),
  }));

  // Read scores.json (written by calling LLM)
  let externalScores: ScoringResultItem[] = [];
  try {
    const scoresRaw = await readFile(path.join(stagingDir, "scores.json"), "utf8");
    externalScores = parseScoringResults(scoresRaw);
  } catch {
    console.log("[sec-digest:select] no scores.json found, using rule-based fallback for all articles");
  }

  // Apply scores
  const scored = applyExternalScores({
    articles,
    externalScores,
    weights: config.weights,
  });

  // Archive penalty
  const seenUrls = await readRecentArchive(env, 7);
  const penalized = applyArchivePenalty(scored, seenUrls);

  penalized.sort((a, b) => b.score - a.score);
  const balanced = pickBalanced<ScoredArticle>(penalized, config.top_n, config.weights);

  // Vulnerability merge
  const vulnerabilities = mergeVulnerabilityItems(
    balanced.security
      .filter((item) => item.security >= 6 || /CVE-\d{4}-\d{4,7}/i.test(`${item.title} ${item.description}`))
      .map((item) => ({
        title: item.title,
        summary: item.description,
        link: item.link,
        source: item.sourceName,
      })),
  );

  // Health tracking
  const healthStore = await loadHealthStore(env);
  for (const feedResult of fetchedRaw.meta.feedResults) {
    recordSourceResult(healthStore, feedResult.id, feedResult.name, feedResult.ok);
  }
  for (const twitterRes of fetchedRaw.meta.twitterResults) {
    recordSourceResult(healthStore, twitterRes.sourceId, twitterRes.handle, twitterRes.status === "ok");
  }
  await saveHealthStore(healthStore, env);
  const unhealthyNames = getUnhealthySources(healthStore);

  const result: SelectResult = {
    articles: balanced.selected,
    kols: fetchedRaw.kols,
    vulnerabilities,
    healthWarnings: unhealthyNames,
    meta: {
      date: fetchedRaw.meta.date,
      feedsCount: fetchedRaw.meta.feedsCount,
      totalArticles: fetchedRaw.meta.totalArticles,
      recentArticles: fetchedRaw.meta.recentArticles,
      usedCache: fetchedRaw.meta.usedCache,
      twitterKols: fetchedRaw.meta.twitterKols,
      selectedCount: balanced.selected.length,
    },
  };

  // Write selected.json
  const serialized = {
    ...result,
    articles: result.articles.map((a) => ({
      ...a,
      pubDate: a.pubDate instanceof Date ? a.pubDate.toISOString() : a.pubDate,
    })),
  };
  await writeFile(path.join(stagingDir, "selected.json"), JSON.stringify(serialized, null, 2), "utf8");

  console.log(`[sec-digest:select] selected=${balanced.selected.length} vulns=${vulnerabilities.length}`);
  return result;
}

// ---------------------------------------------------------------------------
// Stage 3: Render (apply summaries + generate markdown)
// ---------------------------------------------------------------------------

export interface RenderOptions {
  outputPath?: string;
  highlights?: string;
  emailTo?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RenderResult {
  outputPath: string;
  counters: {
    feeds: number;
    articles: number;
    recent: number;
    selected: number;
    vulnerabilities: number;
    twitter_kols: number;
  };
  usedCache: boolean;
}

export async function runRender(options: RenderOptions = {}): Promise<RenderResult> {
  const env = options.env ?? process.env;
  const stagingDir = getStagingDir(env);

  // Read selected.json
  const selectedRaw = JSON.parse(await readFile(path.join(stagingDir, "selected.json"), "utf8"));
  const scoredArticles: ScoredArticle[] = selectedRaw.articles.map((a: Record<string, unknown>) => ({
    ...a,
    pubDate: new Date(a.pubDate as string),
  }));

  // Read summaries.json (written by calling LLM)
  let externalSummaries: SummaryResultItem[] = [];
  try {
    const summariesRaw = await readFile(path.join(stagingDir, "summaries.json"), "utf8");
    externalSummaries = parseSummaryResults(summariesRaw);
  } catch {
    console.log("[sec-digest:render] no summaries.json found, using fallback summaries");
  }

  // Apply summaries
  const finalized = applyExternalSummaries(scoredArticles, externalSummaries);
  const byFocus = splitByFocus<FinalArticle>(finalized);

  // Highlights
  const highlights = options.highlights?.trim() || fallbackHighlights(finalized, "zh");

  const dateStr = selectedRaw.meta.date;
  const report = renderDigest({
    date: dateStr,
    highlights,
    ai: byFocus.ai.map((item) => ({
      titleZh: item.titleZh,
      title: item.title,
      link: item.link,
      summaryZh: item.summaryZh,
      reasonZh: item.reasonZh,
      category: item.category,
      keywords: item.keywords,
      score: item.score,
      sourceName: item.sourceName,
    })),
    security: byFocus.security.map((item) => ({
      titleZh: item.titleZh,
      title: item.title,
      link: item.link,
      summaryZh: item.summaryZh,
      reasonZh: item.reasonZh,
      category: item.category,
      keywords: item.keywords,
      score: item.score,
      sourceName: item.sourceName,
    })),
    vulnerabilities: selectedRaw.vulnerabilities,
    kols: selectedRaw.kols,
    healthWarnings: selectedRaw.healthWarnings,
  });

  const outputPath = options.outputPath ?? `./output/sec-digest-${dateStr.replace(/-/g, "")}.md`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, "utf8");

  // Write archive + clean old
  await writeArchiveEntry(
    finalized.map((a) => ({ title: a.title, link: a.link, date: dateStr })),
    dateStr,
    env,
  );
  await cleanOldArchive(env, 90);

  // Email delivery
  const emailTo = options.emailTo;
  if (emailTo) {
    const body = await readFile(outputPath, "utf8");
    const emailResult = await sendEmailViaGog({
      to: emailTo,
      subject: `sec-daily-digest ${dateStr}`,
      body,
    });
    if (emailResult.ok) {
      console.log(`[sec-digest:render] email=sent to ${emailTo}`);
    } else {
      console.log(`[sec-digest:render] email=failed: ${emailResult.error}`);
    }
  }

  console.log(`[sec-digest:render] output=${outputPath}`);

  return {
    outputPath,
    counters: {
      feeds: selectedRaw.meta.feedsCount,
      articles: selectedRaw.meta.totalArticles,
      recent: selectedRaw.meta.recentArticles,
      selected: selectedRaw.meta.selectedCount,
      vulnerabilities: selectedRaw.vulnerabilities.length,
      twitter_kols: selectedRaw.meta.twitterKols,
    },
    usedCache: selectedRaw.meta.usedCache,
  };
}
