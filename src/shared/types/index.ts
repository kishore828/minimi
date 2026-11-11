/**
 * Core domain types shared by the server, the client, and the test suite.
 * Keep this module free of Node-only or browser-only APIs so it can be
 * imported from anywhere.
 */

export type Role = "user" | "assistant" | "system";

export type MessageStatus = "complete" | "partial";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
  status: MessageStatus;
}

/** A persisted memory extracted from a past conversation. */
export type MemoryCategory =
  | "fact"
  | "decision"
  | "preference"
  | "entity"
  | "research_conclusion"
  | "other";

export interface Memory {
  id: string;
  userId: string;
  conversationId: string | null;
  content: string;
  category: MemoryCategory;
  importance: number;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------------- */
/* Search                                                                    */
/* ------------------------------------------------------------------------- */

export type SearchTopic = "general" | "news";
export type SearchTimeRange = "day" | "week" | "month" | "year";

export interface SearchInput {
  query: string;
  maxResults?: number;
  topic?: SearchTopic;
  timeRange?: SearchTimeRange;
}

/** Provider-agnostic search result, normalized by source-normalizer.ts. */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
  /** ISO date string when the provider can tell us; null when unknown. */
  publishedDate: string | null;
  /** ISO timestamp of when we retrieved this result. */
  retrievedAt: string;
  domain: string;
  /** Provider relevance score, normalized to 0..1. */
  score: number;
}

/* ------------------------------------------------------------------------- */
/* Evidence & citations                                                      */
/* ------------------------------------------------------------------------- */

/**
 * A traceable piece of evidence backing a factual statement.
 * `citationIndex` is the number the assistant uses in `[n]` markers.
 */
export interface SourceRef {
  citationIndex: number;
  claim: string;
  title: string;
  url: string;
  domain: string;
  publishedDate: string | null;
  retrievedAt: string;
  excerpt: string;
}

/* ------------------------------------------------------------------------- */
/* Temporal comparison                                                       */
/* ------------------------------------------------------------------------- */

export type ChangeClassification =
  | "UNCHANGED"
  | "PRICE_INCREASED"
  | "PRICE_DECREASED"
  | "FEATURE_ADDED"
  | "FEATURE_REMOVED"
  | "POLICY_CHANGED"
  | "AVAILABILITY_CHANGED"
  | "NEW_INFORMATION"
  | "NO_LONGER_VERIFIABLE"
  | "INCONCLUSIVE";

export interface ClaimComparison {
  subject: string;
  claim: string;
  historicalValue: string | null;
  currentValue: string | null;
  classification: ChangeClassification;
  /** Citation indexes (1-based) of the evidence supporting this classification. */
  evidenceCitations: number[];
  explanation: string;
}

/** A claim extracted from a historical conversation for later re-verification. */
export type ClaimType = "PRICE" | "FEATURE" | "POLICY" | "AVAILABILITY" | "FACT" | "OTHER";

export interface HistoricalClaim {
  subject: string;
  topic: string;
  claim: string;
  type: ClaimType;
  value: string | null;
  asOf: string | null;
  messageIndex: number;
}

/* ------------------------------------------------------------------------- */
/* Planning                                                                  */
/* ------------------------------------------------------------------------- */

export type PlanCategory =
  /** Chitchat or stable knowledge that needs neither memory lookups nor search. */
  | "CONVERSATIONAL"
  /** Asking about a previous conversation (pure memory retrieval). */
  | "HISTORY_LOOKUP"
  /** Needs current external information. */
  | "CURRENT_INFO"
  /** Comparing something discussed before against the current state of the world. */
  | "TEMPORAL_COMPARISON"
  /** Follow-up referring to an entity/topic established earlier in this conversation. */
  | "FOLLOW_UP"
  /** Researching several distinct entities in parallel. */
  | "MULTI_ENTITY_RESEARCH"
  /** Refers to history that may not exist or is ambiguous; needs honest handling. */
  | "AMBIGUOUS_HISTORY";

export interface ResearchPlan {
  category: PlanCategory;
  needsSearch: boolean;
  requiresHistoryRetrieval: boolean;
  entities: string[];
  historicalKeywords: string[];
  draftQueries: string[];
  clarificationQuestion: string | null;
  reasoning: string;
}

/* ------------------------------------------------------------------------- */
/* Metrics                                                                   */
/* ------------------------------------------------------------------------- */

export interface TurnMetrics {
  durationMs: number;
  llmCalls: number;
  searchCalls: number;
  queriesPlanned: number;
  resultsFetched: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
}
