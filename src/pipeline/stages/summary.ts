import { parseSummaryResults } from "../../ai/parse";
import type { FinalArticle, ScoredArticle, SummaryResultItem } from "../types";

function toFallbackSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 220) {
    return trimmed;
  }
  return `${trimmed.slice(0, 220)}...`;
}

/**
 * Apply externally-provided AI summaries (from the calling LLM) to scored articles.
 * Articles without a matching summary entry fall back to truncated original text.
 */
export function applyExternalSummaries(
  articles: ScoredArticle[],
  externalSummaries: SummaryResultItem[],
): FinalArticle[] {
  const summaryMap = new Map<number, SummaryResultItem>();
  for (const item of externalSummaries) {
    summaryMap.set(item.index, item);
  }

  return articles.map((article, index) => {
    const parsed = summaryMap.get(index);
    const fallbackSummary = toFallbackSummary(article.description || article.title);
    return {
      ...article,
      index,
      titleZh: parsed?.titleZh?.trim() || article.title,
      summaryZh: parsed?.summaryZh?.trim() || fallbackSummary,
      reasonZh: parsed?.reasonZh?.trim() || "",
    };
  });
}

/**
 * Parse raw summaries JSON text (from summaries.json) and apply to articles.
 */
export function parseAndApplySummaries(
  articles: ScoredArticle[],
  summariesJsonText: string,
): FinalArticle[] {
  const externalSummaries = parseSummaryResults(summariesJsonText);
  return applyExternalSummaries(articles, externalSummaries);
}
