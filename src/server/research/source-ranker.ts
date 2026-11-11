/**
 * Source ranking for search results.
 *
 * Heuristic, deterministic, explainable: provider relevance + official-source
 * signals + freshness + topical overlap, with a same-domain diversity
 * penalty so one loud domain cannot crowd out the citation list.
 */
import type { SearchResult } from "@/shared/types";
import { keywordOverlap, tokenize } from "@/shared/utils/text";

export interface RankedSource {
  result: SearchResult;
  score: number;
  reasons: string[];
}

const OFFICIAL_PATH_HINTS = [
  "pricing",
  "pricing/",
  "plans",
  "docs",
  "changelog",
  "release-notes",
  "releases",
  "blog",
  "newsroom",
  "announcement",
];

const FRESHNESS_WINDOW_DAYS = 45;

export function rankSources(
  results: SearchResult[],
  context: { question: string; entities: string[]; now?: Date },
): RankedSource[] {
  const now = context.now ?? new Date();
  const entityTokens = context.entities.flatMap((e) => tokenize(e));
  const domainCounts = new Map<string, number>();

  const ranked = results.map((result) => {
    const reasons: string[] = [];
    let score = 0.35 * result.score;

    /* Official-source signals. */
    const domainNoTld = result.domain.split(".")[0] ?? "";
    const matchesEntity =
      entityTokens.some((t) => t.length > 2 && result.domain.includes(t)) ||
      context.entities.some((e) => e.toLowerCase().replace(/\s+/g, "") === domainNoTld);
    const pathLower = result.url.toLowerCase();
    const officialPath = OFFICIAL_PATH_HINTS.some((hint) => pathLower.includes(hint));
    if (matchesEntity) {
      score += 0.25;
      reasons.push("official domain for entity");
    }
    if (officialPath) {
      score += 0.12;
      reasons.push("official docs/pricing/changelog page");
    }

    /* Freshness (only when a publication date is actually known). */
    if (result.publishedDate) {
      const ageDays = (now.getTime() - new Date(result.publishedDate).getTime()) / 86_400_000;
      if (ageDays >= 0 && ageDays <= FRESHNESS_WINDOW_DAYS) {
        const freshness = 1 - ageDays / FRESHNESS_WINDOW_DAYS;
        score += 0.15 * freshness;
        reasons.push("recent publication");
      } else if (ageDays < 0) {
        score += 0.05; // dated in the future relative to us — treat as fresh but suspicious
      }
    }

    /* Topical overlap with the question. */
    const overlap = keywordOverlap(context.question, `${result.title} ${result.content}`);
    if (overlap > 0) {
      score += 0.13 * overlap;
    }

    return { result, score, reasons };
  });

  ranked.sort((a, b) => b.score - a.score);

  /* Diversity: dampen repeats of the same domain after its first appearance. */
  const output: RankedSource[] = [];
  for (const item of ranked) {
    const count = domainCounts.get(item.result.domain) ?? 0;
    domainCounts.set(item.result.domain, count + 1);
    if (count >= 1) {
      item.score *= 0.85;
      item.reasons.push("repeat domain (diversity penalty)");
    }
    output.push(item);
  }
  output.sort((a, b) => b.score - a.score);
  return output;
}

/**
 * Select up to `cap` top-ranked sources while ensuring every researched entity
 * keeps representation in the evidence ledger instead of one entity consuming
 * all slots.
 */
export function selectBalancedEvidence(ranked: RankedSource[], entities: string[], cap: number): RankedSource[] {
  if (ranked.length <= cap || entities.length <= 1) {
    return ranked.slice(0, cap);
  }

  const chosen: RankedSource[] = [];
  const chosenSet = new Set<RankedSource>();
  const matchesEntity = (item: RankedSource, entity: string): boolean => {
    const lower = entity.toLowerCase();
    const compact = lower.replace(/\s+/g, "");
    const hay = `${item.result.title} ${item.result.content}`.toLowerCase();
    if (item.result.domain.includes(compact) || hay.includes(lower)) return true;
    const tokens = tokenize(entity).filter((t) => t.length > 2);
    return tokens.length > 0 && tokens.every((t) => hay.includes(t) || item.result.domain.includes(t));
  };

  // Pass 1: top source per entity, round-robin (up to 2 passes if budget allows).
  const passes = cap >= entities.length * 2 ? 2 : 1;
  for (let pass = 0; pass < passes && chosen.length < cap; pass++) {
    for (const entity of entities) {
      if (chosen.length >= cap) break;
      const match = ranked.find((item) => !chosenSet.has(item) && matchesEntity(item, entity));
      if (match) {
        chosenSet.add(match);
        chosen.push(match);
      }
    }
  }

  // Pass 2: fill remaining capacity in global rank order.
  for (const item of ranked) {
    if (chosen.length >= cap) break;
    if (!chosenSet.has(item)) {
      chosenSet.add(item);
      chosen.push(item);
    }
  }

  return chosen;
}
