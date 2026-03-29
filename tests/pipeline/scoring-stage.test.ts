import { describe, expect, test } from "bun:test";
import { applyExternalScores } from "../../src/pipeline/stages/scoring";
import type { Article } from "../../src/rss/parse";
import type { ScoringResultItem } from "../../src/pipeline/types";

describe("scoring stage", () => {
  const articles: Article[] = [
    {
      title: "Critical CVE in model gateway",
      link: "https://example.com/a",
      pubDate: new Date("2026-02-27T10:00:00Z"),
      description: "CVE-2026-00001 allows remote code execution",
      sourceName: "feed-a",
      sourceUrl: "https://example.com",
    },
    {
      title: "New LLM agent benchmark",
      link: "https://example.com/b",
      pubDate: new Date("2026-02-27T09:00:00Z"),
      description: "Benchmark evaluates autonomous coding agents",
      sourceName: "feed-b",
      sourceUrl: "https://example.com",
    },
  ];

  test("applies external scores from calling LLM", () => {
    const externalScores: ScoringResultItem[] = [
      {
        index: 0,
        relevance: 9,
        quality: 8,
        timeliness: 9,
        security: 10,
        ai: 6,
        category: "security",
        keywords: ["CVE", "RCE", "patch"],
      },
      {
        index: 1,
        relevance: 8,
        quality: 7,
        timeliness: 8,
        security: 6,
        ai: 9,
        category: "ai-ml",
        keywords: ["LLM", "agent", "benchmark"],
      },
    ];

    const results = applyExternalScores({
      articles,
      externalScores,
      weights: { security: 0.5, ai: 0.5 },
    });

    expect(results.length).toBe(articles.length);
    expect(results[0]?.category).toBe("security");
    expect(results[0]?.keywords).toContain("CVE");
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(results[1]?.category).toBe("ai-ml");
  });

  test("falls back to rule-based scoring when no external scores provided", () => {
    const results = applyExternalScores({
      articles,
      externalScores: [],
      weights: { security: 0.5, ai: 0.5 },
    });

    expect(results.length).toBe(articles.length);
    expect(results[0]?.category).toBeDefined();
    expect(results[0]?.keywords.length).toBeGreaterThan(0);
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  test("partial scores: unscored articles get fallback", () => {
    const externalScores: ScoringResultItem[] = [
      {
        index: 0,
        relevance: 9,
        quality: 8,
        timeliness: 9,
        security: 10,
        ai: 6,
        category: "security",
        keywords: ["CVE"],
      },
    ];

    const results = applyExternalScores({
      articles,
      externalScores,
      weights: { security: 0.5, ai: 0.5 },
    });

    expect(results.length).toBe(2);
    // First article has external score
    expect(results[0]?.category).toBe("security");
    // Second article has fallback score
    expect(results[1]?.score).toBeGreaterThan(0);
    expect(results[1]?.category).toBeDefined();
  });
});
