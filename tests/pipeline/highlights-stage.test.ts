import { describe, expect, test } from "bun:test";
import { fallbackHighlights } from "../../src/pipeline/stages/highlights";
import type { FinalArticle } from "../../src/pipeline/types";

describe("highlights stage", () => {
  const articles: FinalArticle[] = [
    {
      index: 0,
      title: "Critical CVE in model gateway",
      titleZh: "模型网关高危漏洞",
      link: "https://example.com/a",
      pubDate: new Date("2026-02-27T10:00:00Z"),
      description: "CVE-2026-00001 allows remote code execution",
      sourceName: "feed-a",
      sourceUrl: "https://example.com",
      relevance: 9,
      quality: 8,
      timeliness: 9,
      security: 10,
      ai: 6,
      category: "security",
      keywords: ["CVE", "RCE", "patch"],
      score: 8.9,
      summaryZh: "披露了可远程执行漏洞并附带缓解建议。",
      reasonZh: "直接影响生产网关安全边界。",
    },
  ];

  test("generates fallback highlights in Chinese", () => {
    const highlights = fallbackHighlights(articles, "zh");
    expect(highlights).toContain("趋势");
    expect(highlights).toContain("安全");
  });

  test("generates fallback highlights in English", () => {
    const highlights = fallbackHighlights(articles, "en");
    expect(highlights).toContain("trend");
  });

  test("returns empty string for empty articles", () => {
    const highlights = fallbackHighlights([], "zh");
    expect(highlights).toBe("");
  });
});
