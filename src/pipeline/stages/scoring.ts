import { parseScoringResults } from "../../ai/parse";
import { fallbackScoreFromText, inferTopicSignals } from "../../ai/scoring";
import type { Article } from "../../rss/parse";
import type { CategoryId, ScoredArticle, ScoringResultItem } from "../types";

interface ApplyExternalScoresOptions {
  articles: Article[];
  externalScores: ScoringResultItem[];
  weights: {
    security: number;
    ai: number;
  };
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

export function computeCompositeScore(input: ScoringResultItem, weights: { security: number; ai: number }): number {
  const normalized = normalizeWeights(weights);
  const topic = normalized.security * input.security + normalized.ai * input.ai;
  const qualityBlend = 0.5 * input.relevance + 0.5 * input.quality;
  return Number((0.35 * topic + 0.35 * qualityBlend + 0.3 * input.timeliness).toFixed(2));
}

function inferCategory(title: string, description: string, signals: { security: number; ai: number }): CategoryId {
  const text = `${title} ${description}`.toLowerCase();
  if (signals.security >= 7 || /\bcve-\d{4}-\d{4,7}\b/.test(text)) {
    return "security";
  }
  if (signals.ai >= 7) {
    return "ai-ml";
  }
  if (/(framework|tool|release|open source|github)/.test(text)) {
    return "tools";
  }
  if (/(opinion|analysis|career|essay|thoughts)/.test(text)) {
    return "opinion";
  }
  if (/(architecture|performance|database|compiler|kernel|engineering)/.test(text)) {
    return "engineering";
  }
  return "other";
}

function inferKeywords(title: string, description: string): string[] {
  const text = `${title} ${description}`;
  const cve = text.match(/\bCVE-\d{4}-\d{4,7}\b/i);
  const keywords: string[] = [];
  if (cve) {
    keywords.push(cve[0].toUpperCase());
  }
  if (/llm/i.test(text)) {
    keywords.push("LLM");
  }
  if (/agent/i.test(text)) {
    keywords.push("agent");
  }
  if (/exploit|rce/i.test(text)) {
    keywords.push("exploit");
  }
  if (/patch/i.test(text)) {
    keywords.push("patch");
  }
  if (keywords.length === 0) {
    keywords.push("security");
  }
  return [...new Set(keywords)].slice(0, 4);
}

function fallbackResult(article: Article, index: number, weights: { security: number; ai: number }): ScoredArticle {
  const fallback = fallbackScoreFromText(article);
  const signals = inferTopicSignals(article.title, article.description);
  const scoring: ScoringResultItem = {
    index,
    relevance: fallback.relevance,
    quality: fallback.quality,
    timeliness: fallback.timeliness,
    security: fallback.security,
    ai: fallback.ai,
    category: inferCategory(article.title, article.description, signals),
    keywords: inferKeywords(article.title, article.description),
  };

  return {
    ...article,
    ...scoring,
    score: computeCompositeScore(scoring, weights),
  };
}

/**
 * Apply externally-provided AI scores (from the calling LLM) to articles.
 * Articles without a matching score entry fall back to rule-based scoring.
 */
export function applyExternalScores(options: ApplyExternalScoresOptions): ScoredArticle[] {
  const scoreMap = new Map<number, ScoringResultItem>();
  for (const item of options.externalScores) {
    scoreMap.set(item.index, item);
  }

  return options.articles.map((article, index) => {
    const parsed = scoreMap.get(index);
    if (!parsed) {
      return fallbackResult(article, index, options.weights);
    }
    return {
      ...article,
      ...parsed,
      score: computeCompositeScore(parsed, options.weights),
    };
  });
}

/**
 * Parse raw scores JSON text (from scores.json) and apply to articles.
 */
export function parseAndApplyScores(
  articles: Article[],
  scoresJsonText: string,
  weights: { security: number; ai: number },
): ScoredArticle[] {
  const externalScores = parseScoringResults(scoresJsonText);
  return applyExternalScores({ articles, externalScores, weights });
}
