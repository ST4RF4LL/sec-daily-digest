import { describe, expect, test } from "bun:test";
import { applyExternalSummaries } from "../../src/pipeline/stages/summary";
import type { ScoredArticle } from "../../src/pipeline/types";
import type { SummaryResultItem } from "../../src/pipeline/types";

describe("summary stage", () => {
  const articles: ScoredArticle[] = [
    {
      index: 0,
      title: "Agent hardening guide",
      link: "https://example.com/a",
      pubDate: new Date("2026-02-27T10:00:00Z"),
      description: "Security controls for autonomous agent deployments",
      sourceName: "feed-a",
      sourceUrl: "https://example.com",
      relevance: 9,
      quality: 8,
      timeliness: 8,
      security: 8,
      ai: 9,
      category: "security",
      keywords: ["agent", "hardening", "sandbox"],
      score: 8.5,
    },
  ];

  test("applies external summaries from calling LLM", () => {
    const externalSummaries: SummaryResultItem[] = [
      {
        index: 0,
        titleZh: "Agent 安全加固指南",
        summaryZh: "面向生产环境的 agent 威胁模型。重点覆盖身份、沙箱、工具权限和审计策略。比较了集中式与最小权限两种方案。给出落地检查清单。",
        reasonZh: "给出了可执行的安全控制清单。",
      },
    ];

    const results = applyExternalSummaries(articles, externalSummaries);

    expect(results.length).toBe(1);
    expect(results[0]?.titleZh).toBe("Agent 安全加固指南");
    expect((results[0]?.summaryZh.split("。").filter(Boolean).length ?? 0)).toBeGreaterThanOrEqual(3);
    expect((results[0]?.reasonZh.length ?? 0)).toBeGreaterThan(0);
  });

  test("falls back to truncated original text when no summaries provided", () => {
    const results = applyExternalSummaries(articles, []);

    expect(results.length).toBe(1);
    expect(results[0]?.titleZh).toBe("Agent hardening guide"); // original title
    expect(results[0]?.summaryZh).toContain("Security controls"); // truncated original
    expect(results[0]?.reasonZh).toBe(""); // empty fallback
  });
});
