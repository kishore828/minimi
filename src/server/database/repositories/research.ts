import { asc, desc, eq } from "drizzle-orm";
import { conversationSummaries, evidence, researchSessions } from "../schema";
import type { DatabaseHandle } from "../db";
import type { ClaimComparison, SourceRef } from "@/shared/types";

export interface NewResearchSession {
  id: string;
  conversationId: string;
  messageId: string | null;
  query: string;
  category: string;
  searchCount: number;
  llmCallCount: number;
  durationMs: number;
  comparisons: ClaimComparison[] | null;
  createdAt: Date;
}

export interface NewEvidence {
  id: string;
  researchSessionId: string;
  citationIndex: number;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  sourcePublishedAt: number | null;
  retrievedAt: number;
  excerpt: string;
}

export interface ResearchRecord {
  sessionId: string;
  conversationId: string;
  messageId: string | null;
  query: string;
  category: string;
  searchCount: number;
  llmCallCount: number;
  durationMs: number;
  comparisons: ClaimComparison[] | null;
  createdAt: string;
  evidence: SourceRef[];
}

export class ResearchRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  /** Session + evidence rows are always written together (see turns.ts). */
  async getByMessage(messageId: string): Promise<ResearchRecord | null> {
    const session = this.handle.db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.messageId, messageId))
      .get();
    if (!session) return null;
    return this.hydrate(session);
  }

  async listByConversation(conversationId: string): Promise<ResearchRecord[]> {
    const sessions = this.handle.db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.conversationId, conversationId))
      .orderBy(asc(researchSessions.createdAt))
      .all();
    const records: ResearchRecord[] = [];
    for (const session of sessions) {
      const record = await this.hydrate(session);
      if (record) records.push(record);
    }
    return records;
  }

  async getSummary(conversationId: string): Promise<string | null> {
    const row = this.handle.db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.conversationId, conversationId))
      .get();
    return row?.summary ?? null;
  }

  async latestSummaries(userId: string, limit = 30): Promise<Array<{ conversationId: string; summary: string; updatedAt: string }>> {
    const rows = this.handle.sqlite
      .prepare(
        `SELECT s.conversation_id, s.summary, s.updated_at
         FROM conversation_summaries s
         JOIN conversations c ON c.id = s.conversation_id
         WHERE c.user_id = ?
         ORDER BY s.updated_at DESC
         LIMIT ?`,
      )
      .all(userId, limit) as Array<{ conversation_id: string; summary: string; updated_at: number }>;
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      summary: r.summary,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  private async hydrate(session: typeof researchSessions.$inferSelect): Promise<ResearchRecord | null> {
    const evidenceRows = this.handle.db
      .select()
      .from(evidence)
      .where(eq(evidence.researchSessionId, session.id))
      .orderBy(asc(evidence.citationIndex))
      .all() as Array<typeof evidence.$inferSelect>;
    let comparisons: ClaimComparison[] | null = null;
    if (session.comparisonsJson) {
      try {
        comparisons = JSON.parse(session.comparisonsJson) as ClaimComparison[];
      } catch {
        comparisons = null;
      }
    }
    return {
      sessionId: session.id,
      conversationId: session.conversationId,
      messageId: session.messageId,
      query: session.query,
      category: session.category,
      searchCount: session.searchCount,
      llmCallCount: session.llmCallCount,
      durationMs: session.durationMs,
      comparisons,
      createdAt: new Date(session.createdAt).toISOString(),
      evidence: evidenceRows.map((e: typeof evidence.$inferSelect) => ({
        citationIndex: e.citationIndex,
        claim: e.claim,
        title: e.sourceTitle,
        url: e.sourceUrl,
        domain: e.sourceDomain,
        publishedDate: e.sourcePublishedAt !== null ? new Date(e.sourcePublishedAt).toISOString() : null,
        retrievedAt: new Date(e.retrievedAt).toISOString(),
        excerpt: e.excerpt,
      })),
    };
  }
}

export { desc };
