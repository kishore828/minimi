/**
 * Drizzle schema for SQLite.
 *
 * Timestamps are stored as UTC epoch milliseconds (INTEGER) and converted at
 * the repository boundary — no hidden mode magic, and trivial to port to
 * Postgres later by swapping the dialect (columns stay BIGINT/timestamptz).
 */
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("conversations_user_updated_idx").on(t.userId, t.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** "complete" or "partial" (interrupted stream). */
    status: text("status").notNull().default("complete"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("messages_created_idx").on(t.createdAt),
  ],
);

export const conversationSummaries = sqliteTable(
  "conversation_summaries",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    summary: text("summary").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("summaries_conversation_idx").on(t.conversationId)],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id"),
    content: text("content").notNull(),
    /** fact | decision | preference | entity | research_conclusion | other */
    category: text("category").notNull(),
    importance: real("importance").notNull(),
    sourceMessageId: text("source_message_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("memories_user_created_idx").on(t.userId, t.createdAt),
    index("memories_conversation_idx").on(t.conversationId),
  ],
);

export const researchSessions = sqliteTable(
  "research_sessions",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    /** Assistant message this research belongs to. */
    messageId: text("message_id"),
    /** The user question that triggered the research. */
    query: text("query").notNull(),
    category: text("category").notNull(),
    searchCount: integer("search_count").notNull().default(0),
    llmCallCount: integer("llm_call_count").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    comparisonsJson: text("comparisons_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("research_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    researchSessionId: text("research_session_id").notNull(),
    citationIndex: integer("citation_index").notNull(),
    claim: text("claim").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourceDomain: text("source_domain").notNull(),
    sourcePublishedAt: integer("source_published_at"),
    retrievedAt: integer("retrieved_at").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (t) => [index("evidence_session_idx").on(t.researchSessionId, t.citationIndex)],
);

export const searchCache = sqliteTable("search_cache", {
  cacheKey: text("cache_key").primaryKey(),
  resultsJson: text("results_json").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ConversationSummaryRow = typeof conversationSummaries.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type ResearchSessionRow = typeof researchSessions.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;
export type SearchCacheRow = typeof searchCache.$inferSelect;
