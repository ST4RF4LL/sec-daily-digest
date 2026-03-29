import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFetch, runSelect, runRender } from "../../src/pipeline/run";
import type { TwitterSourceResult } from "../../src/twitter/backends/types";
import type { TweetArticle } from "../../src/twitter/types";

const TEST_NOW = new Date("2026-02-27T12:00:00Z");

const seedArticles = [
  {
    title: "Critical CVE in AI gateway",
    link: "https://example.com/a",
    pubDate: new Date("2026-02-27T10:00:00Z"),
    description: "CVE-2026-11111 affects model serving layer",
    sourceName: "source-a",
    sourceUrl: "https://example.com",
  },
  {
    title: "New agent evaluation benchmark",
    link: "https://example.com/b",
    pubDate: new Date("2026-02-27T09:00:00Z"),
    description: "LLM agent evaluation and reproducibility notes",
    sourceName: "source-b",
    sourceUrl: "https://example.com",
  },
];

function makeSeedTwitterResult(tweets: TweetArticle[]): TwitterSourceResult {
  return {
    sourceId: "taviso",
    handle: "taviso",
    status: "ok",
    count: tweets.length,
    tweets,
  };
}

function makeTweetArticle(id: string): TweetArticle {
  return {
    tweetId: id,
    handle: "taviso",
    displayName: "Tavis Ormandy",
    title: `Security tweet ${id}`,
    link: `https://twitter.com/taviso/status/${id}`,
    pubDate: new Date("2026-02-27T08:00:00Z"),
    description: `Security tweet ${id}`,
    sourceName: "Tavis Ormandy",
    sourceUrl: "https://twitter.com/taviso",
    metrics: { like_count: 100, retweet_count: 50, reply_count: 10, quote_count: 5, impression_count: 5000 },
  };
}

describe("multi-stage pipeline", () => {
  test("fetch → select → render produces valid digest", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sec-pipeline-"));
    const outputPath = path.join(tempRoot, "digest.md");
    const env = { SEC_DAILY_DIGEST_HOME: tempRoot } as NodeJS.ProcessEnv;

    // Stage 1: Fetch
    const fetchResult = await runFetch({
      now: TEST_NOW,
      env,
      seedArticles,
    });

    expect(fetchResult.articles.length).toBe(2);
    expect(fetchResult.meta.totalArticles).toBe(2);

    // Verify staging file exists
    const fetchedJson = await readFile(path.join(tempRoot, "staging", "fetched.json"), "utf8");
    expect(JSON.parse(fetchedJson).articles.length).toBe(2);

    // Stage 2: No external scores (will use rule fallback)
    // Stage 3: Select
    const selectResult = await runSelect({ env });

    expect(selectResult.articles.length).toBeGreaterThan(0);

    // Verify staging file exists
    const selectedJson = await readFile(path.join(tempRoot, "staging", "selected.json"), "utf8");
    expect(JSON.parse(selectedJson).articles.length).toBeGreaterThan(0);

    // Stage 4: No external summaries (will use fallback)
    // Stage 5: Render
    const renderResult = await runRender({
      outputPath,
      highlights: "今日趋势测试：安全动态与AI发展。",
      env,
    });

    expect(renderResult.outputPath).toBe(outputPath);
    expect(renderResult.counters.selected).toBeGreaterThan(0);

    const report = await readFile(outputPath, "utf8");
    expect(report).toContain("## AI发展");
    expect(report).toContain("## 安全动态");
    expect(report).toContain("## 📝 今日趋势");
    expect(report).toContain("## 漏洞专报");

    await rm(tempRoot, { recursive: true, force: true });
  });

  test("fetch with twitter KOLs includes KOL entries", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sec-pipeline-"));
    const env = { SEC_DAILY_DIGEST_HOME: tempRoot } as NodeJS.ProcessEnv;

    const tweetArticles = [makeTweetArticle("tweet1"), makeTweetArticle("tweet2")];
    const seedTwitterResults = [makeSeedTwitterResult(tweetArticles)];

    const fetchResult = await runFetch({
      now: TEST_NOW,
      env,
      seedArticles,
      seedTwitterResults,
    });

    expect(fetchResult.meta.twitterKols).toBe(2);
    expect(fetchResult.kols.length).toBe(2);

    // Select + Render to verify KOL section in output
    await runSelect({ env });
    const outputPath = path.join(tempRoot, "digest.md");
    await runRender({ outputPath, env });

    const report = await readFile(outputPath, "utf8");
    expect(report).toContain("## 🔐 Security KOL Updates");

    await rm(tempRoot, { recursive: true, force: true });
  });

  test("fetch with --no-twitter flag disables twitter", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sec-pipeline-"));
    const env = {
      SEC_DAILY_DIGEST_HOME: tempRoot,
      TWITTERAPI_IO_KEY: "fake-key",
    } as NodeJS.ProcessEnv;

    const fetchResult = await runFetch({
      now: TEST_NOW,
      twitterEnabled: false,
      env,
      seedArticles,
    });

    expect(fetchResult.meta.twitterKols).toBe(0);
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("select with external scores.json applies AI scores", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sec-pipeline-"));
    const env = { SEC_DAILY_DIGEST_HOME: tempRoot } as NodeJS.ProcessEnv;

    // Fetch
    await runFetch({ now: TEST_NOW, env, seedArticles });

    // Write scores.json (simulating calling LLM)
    const scores = {
      results: [
        {
          index: 0,
          relevance: 9,
          quality: 8,
          timeliness: 9,
          security: 10,
          ai: 3,
          category: "security",
          keywords: ["CVE", "RCE"],
        },
        {
          index: 1,
          relevance: 7,
          quality: 7,
          timeliness: 8,
          security: 4,
          ai: 9,
          category: "ai-ml",
          keywords: ["LLM", "agent"],
        },
      ],
    };
    await writeFile(
      path.join(tempRoot, "staging", "scores.json"),
      JSON.stringify(scores, null, 2),
      "utf8",
    );

    const selectResult = await runSelect({ env });
    expect(selectResult.articles.length).toBeGreaterThan(0);

    // Verify scores were applied (first article should have security category)
    const securityArticle = selectResult.articles.find((a) => a.title.includes("CVE"));
    if (securityArticle) {
      expect(securityArticle.category).toBe("security");
    }

    await rm(tempRoot, { recursive: true, force: true });
  });
});
