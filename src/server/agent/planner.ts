/**
 * Planner: classifies each request into an explicit category with search /
 * history-retrieval decisions. Structured output + deterministic fallback
 * for model failures.
 */
import type { LlmClient, LlmUsage } from "@/server/llm/client";
import { plannerOutputSchema } from "@/shared/schemas";
import type { ResearchPlan } from "@/shared/types";
import type { TemporalReference } from "@/shared/utils/temporal";
import type { ConversationMessage } from "@/shared/types";
import type { RelevantMemory } from "@/server/memory/memory-manager";
import type { HistoricalConversationMatch } from "@/server/memory/conversation-retriever";
import { AppError } from "@/shared/utils/errors";
import { buildPlannerContext, PLANNER_SYSTEM } from "./prompts";

export interface ClassifyInput {
  question: string;
  recentHistory: ConversationMessage[];
  memories: RelevantMemory[];
  historicalMatches: HistoricalConversationMatch[];
  temporalRefs: TemporalReference[];
  currentDateLabel?: string;
  signal?: AbortSignal;
}

export class Planner {
  constructor(private readonly llm: LlmClient) {}

  async classify(input: ClassifyInput): Promise<{ plan: ResearchPlan; usage: LlmUsage | null }> {
    try {
      const { data, usage } = await this.llm.completeJson(
        {
          purpose: "planner",
          system: PLANNER_SYSTEM,
          messages: [{ role: "user", content: buildPlannerContext(input) }],
          temperature: 0.1,
          maxTokens: 450,
          signal: input.signal,
        },
        plannerOutputSchema,
        "plannerOutput",
      );

      let needsSearch = data.needsSearch;
      // Deterministic guardrail: pure conversation never searches. (The
      // missing-history guardrail intentionally lives in the orchestrator,
      // which may run a second retrieval pass after this classification.)
      if (data.category === "CONVERSATIONAL") {
        needsSearch = false;
      }

      return {
        plan: {
          category: data.category,
          needsSearch,
          requiresHistoryRetrieval: data.requiresHistoryRetrieval,
          entities: data.entities,
          historicalKeywords: data.historicalKeywords,
          draftQueries: data.draftQueries,
          clarificationQuestion: data.clarificationQuestion,
          reasoning: data.reasoning,
        },
        usage,
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "ABORTED") throw error;
      // Deterministic fallback so a planner hiccup never breaks a turn.
      return { plan: Planner.heuristicPlan(input), usage: null };
    }
  }

  /**
   * Heuristic fallback classification (also used when the model is
   * unreachable): temporal language wins, then history signals, else
   * conversational. Conservative — never triggers a search.
   */
  static heuristicPlan(input: ClassifyInput): ResearchPlan {
    const q = input.question.toLowerCase();
    const hasTemporal = input.temporalRefs.length > 0;
    const comparisonPhrases = /\b(still|changed?|current|up to date|anymore|these days)\b/.test(q);
    const historyPhrases =
      /\b(we (discussed|talked|decided|shortlisted|compared|looked)|i (asked|told)|you (told|said)|remember|previously|last time)\b/.test(q);

    if (hasTemporal && comparisonPhrases) {
      return {
        category: "TEMPORAL_COMPARISON",
        needsSearch: input.historicalMatches.length > 0,
        requiresHistoryRetrieval: true,
        entities: [],
        historicalKeywords: [],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "heuristic fallback",
      };
    }
    if (hasTemporal || historyPhrases) {
      return {
        category: "HISTORY_LOOKUP",
        needsSearch: false,
        requiresHistoryRetrieval: true,
        entities: [],
        historicalKeywords: [],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "heuristic fallback",
      };
    }
    return {
      category: "CONVERSATIONAL",
      needsSearch: false,
      requiresHistoryRetrieval: false,
      entities: [],
      historicalKeywords: [],
      draftQueries: [],
      clarificationQuestion: null,
      reasoning: "heuristic fallback",
    };
  }
}
