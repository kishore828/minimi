/**
 * Turn metrics: measured (not estimated) counters surfaced in every
 * turn_end event, persisted on the research session, and aggregated by the
 * evaluation suite.
 */
import type { LlmUsage } from "@/server/llm/client";
import type { TurnMetrics } from "@/shared/types";

export interface TurnTracker {
  recordLlmCall(purpose: string, usage: LlmUsage | null): void;
  recordSearchCall(query: string, resultCount: number, cached: boolean): void;
  recordQueriesPlanned(count: number): void;
  recordResultsFetched(count: number): void;
  readonly llmCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly elapsedMs: number;
  snapshot(): TurnMetrics;
}

export class TurnMetricsCollector implements TurnTracker {
  private readonly startedAt = Date.now();
  private llmCallsCount = 0;
  private searchCallsCount = 0;
  private queriesPlannedCount = 0;
  private resultsFetchedCount = 0;
  private cacheHitsCount = 0;
  private promptTokensTotal = 0;
  private completionTokensTotal = 0;
  readonly purposes: Array<{ purpose: string; atMs: number }> = [];

  recordLlmCall(purpose: string, usage: LlmUsage | null): void {
    this.llmCallsCount++;
    this.purposes.push({ purpose, atMs: Date.now() - this.startedAt });
    if (usage) {
      this.promptTokensTotal += usage.promptTokens;
      this.completionTokensTotal += usage.completionTokens;
    }
  }

  recordSearchCall(_query: string, resultCount: number, cached: boolean): void {
    if (cached) {
      this.cacheHitsCount++;
    } else {
      this.searchCallsCount++;
    }
    this.resultsFetchedCount += resultCount;
  }

  recordQueriesPlanned(count: number): void {
    this.queriesPlannedCount += count;
  }

  recordResultsFetched(count: number): void {
    this.resultsFetchedCount += count;
  }

  get llmCalls(): number {
    return this.llmCallsCount;
  }

  get promptTokens(): number {
    return this.promptTokensTotal;
  }

  get completionTokens(): number {
    return this.completionTokensTotal;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  snapshot(): TurnMetrics {
    return {
      durationMs: this.elapsedMs,
      llmCalls: this.llmCallsCount,
      searchCalls: this.searchCallsCount,
      queriesPlanned: this.queriesPlannedCount,
      resultsFetched: this.resultsFetchedCount,
      cacheHits: this.cacheHitsCount,
      promptTokens: this.promptTokensTotal,
      completionTokens: this.completionTokensTotal,
    };
  }
}
