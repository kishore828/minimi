/**
 * Zod schemas for API request/response validation and for structured LLM
 * outputs. Schemas used by the LLM pipelines are also declared here so the
 * test suite can import them without reaching into server internals.
 */
import { z } from "zod";
import type { ClaimType, ChangeClassification, MemoryCategory } from "../types";

/* ------------------------------------------------------------------------- */
/* HTTP API request bodies                                                   */
/* ------------------------------------------------------------------------- */

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1).max(64).nullish(),
  message: z.string().trim().min(1, "Message cannot be empty").max(8000),
  /** Retry of a failed turn: the id of the user message to reuse (no duplicate insert). */
  retryOf: z.string().min(1).max(64).nullish(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const conversationCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});
export type ConversationCreateRequest = z.infer<typeof conversationCreateSchema>;

export const conversationPatchSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
export type ConversationPatchRequest = z.infer<typeof conversationPatchSchema>;

export const searchApiSchema = z.object({
  query: z.string().trim().min(2, "Query too short").max(400),
  maxResults: z.number().int().min(1).max(10).optional(),
});
export type SearchApiRequest = z.infer<typeof searchApiSchema>;

export const healthTestSchema = z.object({
  target: z.enum(["llm", "search"]),
});
export type HealthTestRequest = z.infer<typeof healthTestSchema>;

/* ------------------------------------------------------------------------- */
/* Structured LLM outputs                                                    */
/* ------------------------------------------------------------------------- */

export const PLAN_CATEGORIES = [
  "CONVERSATIONAL",
  "HISTORY_LOOKUP",
  "CURRENT_INFO",
  "TEMPORAL_COMPARISON",
  "FOLLOW_UP",
  "MULTI_ENTITY_RESEARCH",
  "AMBIGUOUS_HISTORY",
] as const;

export const plannerOutputSchema = z.object({
  category: z.enum(PLAN_CATEGORIES),
  needsSearch: z.boolean(),
  requiresHistoryRetrieval: z.boolean(),
  entities: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  historicalKeywords: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  draftQueries: z.array(z.string().trim().min(2).max(400)).max(8).default([]),
  clarificationQuestion: z.string().trim().max(500).nullable().default(null),
  reasoning: z.string().max(1000).default(""),
});
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export const SEARCH_TOPICS = ["general", "news"] as const;
export const SEARCH_TIME_RANGES = ["day", "week", "month", "year"] as const;

export const searchQueryPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().trim().min(2).max(300),
        topic: z.enum(SEARCH_TOPICS).default("general"),
        timeRange: z.enum(SEARCH_TIME_RANGES).nullable().default(null),
        purpose: z.string().trim().min(1).max(120).default("general"),
      }),
    )
    .max(10)
    .default([]),
});
export type SearchQueryPlan = z.infer<typeof searchQueryPlanSchema>;

export const CLAIM_TYPES = ["PRICE", "FEATURE", "POLICY", "AVAILABILITY", "FACT", "OTHER"] as const;

export const claimExtractionSchema = z.object({
  claims: z
    .array(
      z.object({
        subject: z.string().trim().min(1).max(160),
        topic: z.string().trim().min(1).max(160),
        claim: z.string().trim().min(3).max(1200),
        type: z.enum(CLAIM_TYPES),
        value: z.string().trim().max(300).nullable().default(null),
        asOf: z.string().trim().max(60).nullable().default(null),
        messageIndex: z.number().int().min(0).default(0),
      }),
    )
    .max(24)
    .default([]),
});
export type ClaimExtractionOutput = z.infer<typeof claimExtractionSchema>;

export const CHANGE_CLASSIFICATIONS = [
  "UNCHANGED",
  "PRICE_INCREASED",
  "PRICE_DECREASED",
  "FEATURE_ADDED",
  "FEATURE_REMOVED",
  "POLICY_CHANGED",
  "AVAILABILITY_CHANGED",
  "NEW_INFORMATION",
  "NO_LONGER_VERIFIABLE",
  "INCONCLUSIVE",
] as const;

export const comparisonOutputSchema = z.object({
  comparisons: z
    .array(
      z.object({
        subject: z.string().trim().min(1).max(160),
        claim: z.string().trim().min(3).max(1200),
        historicalValue: z.string().trim().max(400).nullable().default(null),
        currentValue: z.string().trim().max(400).nullable().default(null),
        classification: z.enum(CHANGE_CLASSIFICATIONS),
        evidenceCitations: z.array(z.number().int().min(1).max(999)).max(12).default([]),
        explanation: z.string().trim().max(1200).default(""),
      }),
    )
    .max(24)
    .default([]),
});
export type ComparisonOutput = z.infer<typeof comparisonOutputSchema>;

export const MEMORY_CATEGORIES = [
  "fact",
  "decision",
  "preference",
  "entity",
  "research_conclusion",
  "other",
] as const;

export const memoryExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        content: z.string().trim().min(3).max(600),
        category: z.enum(MEMORY_CATEGORIES),
        importance: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(5)
    .default([]),
});
export type MemoryExtractionOutput = z.infer<typeof memoryExtractionSchema>;

/* Re-exported for convenience so callers can derive types from schemas. */
export type { ClaimType, ChangeClassification, MemoryCategory };
