/**
 * Query planning: turning a user question + context into effective search
 * queries. LLM-driven with a deterministic fallback so a model hiccup can
 * never block research entirely.
 */
import type { LlmClient } from "@/server/llm/client";
import { searchQueryPlanSchema } from "@/shared/schemas";
import { AppError } from "@/shared/utils/errors";
import { extractKeywords } from "@/shared/utils/text";
import type { SearchTimeRange } from "@/shared/types";

export interface PlannedQuery {
  query: string;
  topic: "general" | "news";
  timeRange: SearchTimeRange | null;
  /** What this query is for, e.g. the entity name — used for coverage checks. */
  purpose: string;
}

export interface QueryPlanContext {
  question: string;
  entities: string[];
  historicalContext?: string;
  comparisonDateHint?: string;
  alreadyExecuted?: string[];
}

function buildQueryPlannerSystem(currentYear: number): string {
  return `You plan web search queries for a research assistant.

Rules:
- Produce focused, self-contained queries an engine can answer without conversation context.
- One query per distinct entity or aspect. Never bundle several products into one query.
- Prefer queries likely to surface PRIMARY sources: official pricing pages, docs, changelogs, release notes, official blogs.
- When checking whether something changed since a past date, add terms like "pricing", "price change", "changelog", "announcement", "release notes" as appropriate — plus the current year (${currentYear}) when freshness matters.
- Use topic "news" ONLY for recent events and announcements; use "general" for pricing pages/docs.
- Max queries: hard limit given below. Order by importance to the question.
- If the question needs no web search, return an empty queries array.

Respond as JSON: {"queries": [{"query": string, "topic": "general"|"news", "timeRange": "day"|"week"|"month"|"year"|null, "purpose": string}]}`;
}

export class QueryPlanner {
  constructor(
    private readonly llm: LlmClient,
    private readonly limits: { maxQueries: number },
  ) {}

  async plan(ctx: QueryPlanContext, signal?: AbortSignal): Promise<{ queries: PlannedQuery[]; usedFallback: boolean }> {
    const currentYear = new Date().getFullYear();
    const contextLines: string[] = [`Current date: ${new Date().toISOString().slice(0, 10)}`, `User question: ${ctx.question}`];
    if (ctx.entities.length > 0) contextLines.push(`Entities to cover: ${ctx.entities.join(", ")}`);
    if (ctx.historicalContext) contextLines.push(`Historical context from an earlier conversation:\n${ctx.historicalContext}`);
    if (ctx.comparisonDateHint) contextLines.push(`Comparison intent: ${ctx.comparisonDateHint}`);
    if (ctx.alreadyExecuted && ctx.alreadyExecuted.length > 0) {
      contextLines.push(`Queries already executed (do not repeat): ${ctx.alreadyExecuted.join(" | ")}`);
    }
    contextLines.push(`Hard limit: at most ${this.limits.maxQueries} queries.`);

    try {
      const { data } = await this.llm.completeJson(
        {
          purpose: "query_planner",
          system: buildQueryPlannerSystem(currentYear),
          messages: [{ role: "user", content: contextLines.join("\n\n") }],
          temperature: 0.2,
          maxTokens: 700,
          signal,
        },
        searchQueryPlanSchema,
        "searchQueryPlan",
      );

      const queries = data.queries
        .filter((q) => q.query.trim().length > 1)
        .slice(0, this.limits.maxQueries)
        .map((q) => ({
          query: q.query.trim(),
          topic: q.topic,
          timeRange: q.timeRange,
          purpose: q.purpose.trim() || "general",
        }));
      return { queries, usedFallback: false };
    } catch (error) {
      if (error instanceof AppError && error.code === "ABORTED") throw error;
      return { queries: QueryPlanner.fallbackPlan(ctx, this.limits.maxQueries), usedFallback: true };
    }
  }

  /** Deterministic fallback: one entity-focused query per entity. */
  static fallbackPlan(ctx: QueryPlanContext, maxQueries: number): PlannedQuery[] {
    const currentYear = new Date().getFullYear();
    const queries: PlannedQuery[] = [];
    const entities = ctx.entities.slice(0, maxQueries);
    const intentKeywords = extractKeywords(ctx.question, 3).join(" ");

    if (entities.length === 0) {
      queries.push({
        query: `${ctx.question.trim().slice(0, 200)} ${currentYear}`.trim(),
        topic: "general",
        timeRange: null,
        purpose: "question",
      });
      return queries;
    }
    for (const entity of entities) {
      queries.push({
        query: `${entity} ${intentKeywords} ${currentYear}`.trim(),
        topic: "general",
        timeRange: null,
        purpose: entity,
      });
      if (queries.length >= maxQueries) break;
    }
    return queries;
  }
}
