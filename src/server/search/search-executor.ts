/**
 * Search execution: bounded concurrency, TTL cache, resilience.
 * A failing query never aborts the whole research round — the agent keeps
 * what it can get and reports honestly what it could not verify.
 */
import type { Logger } from "@/shared/utils/logger";
import { isAppError } from "@/shared/utils/errors";
import { stableKey } from "@/shared/utils/ids";
import type { SearchResult } from "@/shared/types";
import type { SearchProvider } from "./search-provider";
import { dedupeByUrn } from "./source-normalizer";
import type { PlannedQuery } from "./query-planner";
import type { SearchCacheRepository } from "@/server/database/repositories/search-cache";

export interface SearchExecutionCallbacks {
  onQueryStart?: (query: PlannedQuery, index: number, total: number) => void;
  onQueryEnd?: (query: PlannedQuery, resultCount: number, cached: boolean) => void;
  onQueryError?: (query: PlannedQuery, error: unknown) => void;
}

export interface SearchExecutionReport {
  results: SearchResult[];
  searchCalls: number;
  cacheHits: number;
  failures: number;
  executedQueries: string[];
}

export class SearchExecutor {
  constructor(
    private readonly deps: {
      provider: SearchProvider;
      cache: SearchCacheRepository;
      maxResultsPerQuery: number;
      concurrency: number;
      cacheTtlSeconds: number;
      logger?: Logger;
    },
  ) {}

  async execute(
    queries: PlannedQuery[],
    callbacks: SearchExecutionCallbacks = {},
    signal?: AbortSignal,
  ): Promise<SearchExecutionReport> {
    const allResults: SearchResult[] = [];
    let searchCalls = 0;
    let cacheHits = 0;
    let failures = 0;
    const executedQueries: string[] = [];
    let index = 0;

    const worker = async () => {
      while (index < queries.length) {
        if (signal?.aborted) return;
        const currentIndex = index++;
        const planned = queries[currentIndex];
        callbacks.onQueryStart?.(planned, currentIndex + 1, queries.length);
        try {
          const { results, cached } = await this.runSingle(planned, signal);
          if (cached) cacheHits++;
          else searchCalls++;
          executedQueries.push(planned.query);
          allResults.push(...results);
          callbacks.onQueryEnd?.(planned, results.length, cached);
        } catch (error) {
          if (isAppError(error) && error.code === "ABORTED") return;
          failures++;
          callbacks.onQueryError?.(planned, error);
          this.deps.logger?.warn("search.query_failed", {
            queryLength: planned.query.length,
            purpose: planned.purpose,
          });
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.deps.concurrency, queries.length) }, () => worker());
    await Promise.all(workers);

    if (searchCalls === 0 && cacheHits === 0 && failures > 0 && queries.length > 0) {
      // Every query failed and nothing was cached. This is NOT a fatal turn
      // error: the orchestrator answers honestly that current information
      // could not be verified (see orchestrator guidance path).
      this.deps.logger?.warn("search.all_queries_failed", { queryCount: queries.length });
    }

    return {
      results: dedupeByUrn(allResults),
      searchCalls,
      cacheHits,
      failures,
      executedQueries,
    };
  }

  /** Single query through cache -> provider. Also used by the tool registry. */
  async runSingle(
    planned: PlannedQuery,
    signal?: AbortSignal,
  ): Promise<{ results: SearchResult[]; cached: boolean }> {
    const cacheKey = stableKey([
      this.deps.provider.name,
      planned.query,
      this.deps.maxResultsPerQuery,
      planned.topic,
      planned.timeRange,
    ]);

    const cached = this.deps.cache.get(cacheKey);
    if (cached) {
      return { results: cached, cached: true };
    }

    const results = await this.deps.provider.search(
      {
        query: planned.query,
        maxResults: this.deps.maxResultsPerQuery,
        topic: planned.topic,
        ...(planned.timeRange ? { timeRange: planned.timeRange } : {}),
      },
      { signal, maxResults: this.deps.maxResultsPerQuery },
    );

    this.deps.cache.set(cacheKey, results, this.deps.cacheTtlSeconds);
    return { results, cached: false };
  }
}
