/**
 * Server-Sent-Event protocol streamed by POST /api/chat.
 * Every event the frontend renders (research activity, sources, comparisons,
 * tokens) originates from one of these events — there are no fake animations.
 */
import type {
  ClaimComparison,
  SourceRef,
  TurnMetrics,
} from "./index";

export type AgentStage =
  | "understanding"
  | "retrieving_history"
  | "planning"
  | "searching"
  | "comparing"
  | "generating";

export interface AgentPlanEventPayload {
  category: import("./index").PlanCategory;
  needsSearch: boolean;
  entities: string[];
  queries: string[];
}

export type AgentStreamEvent =
  | {
      type: "turn_start";
      turnId: string;
      conversationId: string;
      userMessageId: string;
      createdAt: string;
    }
  | { type: "stage"; stage: AgentStage; detail?: string }
  | { type: "plan"; plan: AgentPlanEventPayload }
  | {
      type: "search_start";
      query: string;
      index: number;
      total: number;
      topic: "general" | "news";
    }
  | { type: "search_end"; query: string; resultCount: number; cached: boolean }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "comparison"; comparisons: ClaimComparison[] }
  | { type: "token"; text: string }
  | {
      type: "turn_end";
      messageId: string;
      conversationId: string;
      title: string | null;
      citations: SourceRef[];
      metrics: TurnMetrics;
    }
  | { type: "memory_saved"; count: number }
  | { type: "error"; code: string; message: string };
