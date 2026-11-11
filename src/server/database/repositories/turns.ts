import { eq } from "drizzle-orm";
import { conversationSummaries, conversations, evidence, memories, messages, researchSessions } from "../schema";
import type { DatabaseHandle } from "../db";
import type { ClaimComparison, MemoryCategory, SourceRef } from "@/shared/types";

export interface TurnPersistenceInput {
  userId: string;
  conversationId: string;
  assistantMessage: {
    id: string;
    content: string;
    status: "complete" | "partial";
    createdAt: Date;
  };
  /** New title for the conversation (first turn usually). */
  title: string | null;
  /** Refreshed rolling summary, if one was produced this turn. */
  summary: string | null;
  research:
    | {
        sessionId: string;
        query: string;
        category: string;
        searchCount: number;
        llmCallCount: number;
        durationMs: number;
        comparisons: ClaimComparison[] | null;
        evidence: SourceRef[];
      }
    | null;
  memories: Array<{
    id: string;
    content: string;
    category: MemoryCategory;
    importance: number;
  }>;
}

/**
 * Persists a completed (or interrupted) turn and everything it produced in a
 * SINGLE SQLite transaction. All writes are synchronous better-sqlite3 calls,
 * so the transaction cannot leak across await boundaries — an interrupted
 * stream either persists fully or not at all.
 */
export function persistTurn(handle: DatabaseHandle, input: TurnPersistenceInput): void {
  handle.sqlite.transaction(() => {
    const { db, sqlite } = handle;

    db.insert(messages)
      .values({
        id: input.assistantMessage.id,
        conversationId: input.conversationId,
        role: "assistant",
        content: input.assistantMessage.content,
        status: input.assistantMessage.status,
        createdAt: input.assistantMessage.createdAt.getTime(),
      })
      .run();
    sqlite
      .prepare("INSERT INTO messages_fts (message_id, content) VALUES (?, ?)")
      .run(input.assistantMessage.id, input.assistantMessage.content);

    if (input.research) {
      db.insert(researchSessions)
        .values({
          id: input.research.sessionId,
          conversationId: input.conversationId,
          messageId: input.assistantMessage.id,
          query: input.research.query,
          category: input.research.category,
          searchCount: input.research.searchCount,
          llmCallCount: input.research.llmCallCount,
          durationMs: input.research.durationMs,
          comparisonsJson: input.research.comparisons ? JSON.stringify(input.research.comparisons) : null,
          createdAt: Date.now(),
        })
        .run();

      for (const source of input.research.evidence) {
        db.insert(evidence)
          .values({
            id: `ev_${source.citationIndex}_${input.research.sessionId}`,
            researchSessionId: input.research.sessionId,
            citationIndex: source.citationIndex,
            claim: source.claim,
            sourceUrl: source.url,
            sourceTitle: source.title,
            sourceDomain: source.domain,
            sourcePublishedAt: source.publishedDate ? new Date(source.publishedDate).getTime() : null,
            retrievedAt: new Date(source.retrievedAt).getTime(),
            excerpt: source.excerpt,
          })
          .run();
      }
    }

    if (input.title) {
      db.update(conversations)
        .set({ title: input.title })
        .where(eq(conversations.id, input.conversationId))
        .run();
    }

    if (input.summary) {
      const existing = db
        .select()
        .from(conversationSummaries)
        .where(eq(conversationSummaries.conversationId, input.conversationId))
        .get();
      if (existing) {
        db.update(conversationSummaries)
          .set({ summary: input.summary, updatedAt: Date.now() })
          .where(eq(conversationSummaries.id, existing.id))
          .run();
      } else {
        db.insert(conversationSummaries)
          .values({
            id: `sum_${input.conversationId}`,
            conversationId: input.conversationId,
            summary: input.summary,
            updatedAt: Date.now(),
          })
          .run();
      }
    }

    for (const memory of input.memories) {
      const id = memory.id;
      db.insert(memories)
        .values({
          id,
          userId: input.userId,
          conversationId: input.conversationId,
          content: memory.content,
          category: memory.category,
          importance: memory.importance,
          sourceMessageId: input.assistantMessage.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      sqlite.prepare("INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)").run(id, memory.content);
    }

    db.update(conversations)
      .set({ updatedAt: Date.now() })
      .where(eq(conversations.id, input.conversationId))
      .run();
  })();
}
