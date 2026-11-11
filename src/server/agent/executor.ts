/**
 * Research executor: bounded multi-query research rounds.
 *
 * Round 1 covers the planned entities/aspects. If some entities came back
 * with zero evidence and budget remains, ONE refinement round targets the
 * gaps. All caps (total queries, iterations, time) come from config.
 */
import type { Logger } from "@/shared/utils/logger";
import type { AgentStreamEvent } from "@/shared/types/events";
import type { SearchResult } from "@/shared/types";
import type { AppConfig } from "../config";
import type { QueryPlanner, PlannedQuery } from "@/server/search/query-planner";
import type { SearchExecutor } from "@/server/search/search-executor";
import type { TurnTracker } from "@/server/evaluation/metrics";
import { tokenize } from "@/shared/utils/text";

const GENERIC_PLAN_TOKENS = new Set([
  "plan",
  "plans",
  "tier",
  "tiers",
  "pricing",
  "price",
  "pro",
  "enterprise",
  "free",
  "team",
  "business",
  "edition",
  "cloud",
  "hosting",
]);

export interface ResearchReport {
  queries: PlannedQuery[];
  results: SearchResult[];
  searchCalls: number;
  cacheHits: number;
  failures: number;
  usedFallbackQueries: boolean;
  refinementRounds: number;
}

export class ResearchExecutor {
  constructor(
    private readonly deps: {
      queryPlanner: QueryPlanner;
      searchExecutor: SearchExecutor;
      config: AppConfig;
      logger?: Logger;
    },
  ) {}

  async run(input: {
    question: string;
    entities: string[];
    historicalContext?: string;
    comparisonDateHint?: string;
    tracker: TurnTracker;
    emit: (event: AgentStreamEvent) => void;
    signal?: AbortSignal;
  }): Promise<ResearchReport> {
    const executedKeys = new Set<string>();
    const executedPlanned: PlannedQuery[] = [];
    const allResults: SearchResult[] = [];
    let searchCalls = 0;
    let cacheHits = 0;
    let failures = 0;
    let usedFallbackQueries = false;
    let refinementRounds = 0;
    const researchDeadline = Date.now() + this.deps.config.maxResearchTimeMs;
    const maxTotalQueries = this.deps.config.maxSearchQueries;

    for (let round = 0; round < this.deps.config.maxAgentIterations; round++) {
      const remainingBudget = maxTotalQueries - executedKeys.size;
      if (remainingBudget <= 0) break;
      if (round > 0 && Date.now() > researchDeadline) break;

      const gapEntities =
        round === 0
          ? input.entities
          : input.entities.filter((entity) => !this.entityCovered(entity, allResults));
      if (round > 0 && gapEntities.length === 0) break;

      const { queries, usedFallback } = await this.deps.queryPlanner.plan(
        {
          question: input.question,
          entities: round === 0 ? input.entities : gapEntities,
          historicalContext: input.historicalContext,
          comparisonDateHint: input.comparisonDateHint,
          alreadyExecuted: [...executedKeys],
        },
        input.signal,
      );
      if (usedFallback) usedFallbackQueries = true;

      const fresh = queries.filter((q) => !executedKeys.has(q.query)).slice(0, remainingBudget);
      if (fresh.length === 0) break;
      input.tracker.recordQueriesPlanned(fresh.length);

      const report = await this.deps.searchExecutor.execute(
        fresh,
        {
          onQueryStart: (query, index, total) =>
            input.emit({ type: "search_start", query: query.query, index, total, topic: query.topic }),
          onQueryEnd: (query, resultCount, cached) => {
            executedKeys.add(query.query);
            executedPlanned.push(query);
            input.tracker.recordSearchCall(query.query, resultCount, cached);
            input.emit({ type: "search_end", query: query.query, resultCount, cached });
          },
          onQueryError: (query) => {
            executedKeys.add(query.query);
            executedPlanned.push(query);
            failures++;
            input.emit({ type: "search_end", query: query.query, resultCount: 0, cached: false });
          },
        },
        input.signal,
      );

      searchCalls += report.searchCalls;
      cacheHits += report.cacheHits;
      failures += report.failures;
      allResults.push(...report.results);

      if (round === 0) {
        // The executor throws only when EVERYTHING failed; single-query
        // failures are already reflected as failures count.
        if (report.searchCalls === 0 && report.cacheHits === 0 && report.failures > 0) break;
        if (input.entities.length === 0 || this.entitiesCovered(input.entities, allResults)) break;
        refinementRounds++;
      } else {
        break;
      }
    }

    return {
      queries: executedPlanned,
      results: allResults,
      searchCalls,
      cacheHits,
      failures,
      usedFallbackQueries,
      refinementRounds,
    };
  }

  private entityCovered(entity: string, results: SearchResult[]): boolean {
    const needle = entity.toLowerCase();
    const compact = needle.replace(/\s+/g, "");
    if (
      results.some(
        (r) =>
          r.domain.includes(compact) ||
          r.title.toLowerCase().includes(needle) ||
          r.content.toLowerCase().includes(needle),
      )
    ) {
      return true;
    }
    const tokens = tokenize(entity).filter((t) => t.length > 2 && !GENERIC_PLAN_TOKENS.has(t));
    if (tokens.length === 0) return false;
    return results.some((r) => {
      const hay = `${r.domain} ${r.title} ${r.content}`.toLowerCase();
      return tokens.every((t) => hay.includes(t)) || r.domain.includes(tokens[0]);
    });
  }

  private entitiesCovered(entities: string[], results: SearchResult[]): boolean {
    return entities.every((entity) => this.entityCovered(entity, results));
  }
}
