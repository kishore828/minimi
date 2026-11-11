import { and, asc, eq, gte, lte } from "drizzle-orm";
import { conversations, messages } from "../schema";
import type { DatabaseHandle } from "../db";
import { toFtsQuery } from "@/shared/utils/text";
import type { ConversationMessage, Role } from "@/shared/types";

export interface MessageWithContext {
  message: ConversationMessage;
  conversationId: string;
  conversationTitle: string;
}

export class MessagesRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async create(input: {
    id: string;
    conversationId: string;
    role: Role;
    content: string;
    status?: "complete" | "partial";
    createdAt?: Date;
  }): Promise<ConversationMessage> {
    const createdAt = (input.createdAt ?? new Date()).getTime();
    const status = input.status ?? "complete";
    this.handle.db
      .insert(messages)
      .values({
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        status,
        createdAt,
      })
      .run();
    this.handle.sqlite
      .prepare("INSERT INTO messages_fts (message_id, content) VALUES (?, ?)")
      .run(input.id, input.content);
    return {
      id: input.id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAt: new Date(createdAt).toISOString(),
      status,
    };
  }

  /** Full history of a conversation, oldest first. */
  async listByConversation(conversationId: string, limit = 500): Promise<ConversationMessage[]> {
    const rows = this.handle.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(limit)
      .all() as Array<typeof messages.$inferSelect>;
    return rows.map((r: typeof messages.$inferSelect) => this.toMessage(r));
  }

  /** Messages across all conversations within a UTC ms range (date-based recall). */
  async findInRange(userId: string, startMs: number, endMs: number, limit = 200): Promise<MessageWithContext[]> {
    const rows = this.handle.sqlite
      .prepare(
        `SELECT m.id, m.conversation_id, m.role, m.content, m.status, m.created_at, c.title
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND m.created_at >= ? AND m.created_at < ?
         ORDER BY m.created_at ASC
         LIMIT ?`,
      )
      .all(userId, startMs, endMs, limit) as Array<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      status: string;
      created_at: number;
      title: string;
    }>;
    return rows.map((r) => ({
      message: {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role as Role,
        content: r.content,
        createdAt: new Date(r.created_at).toISOString(),
        status: r.status as "complete" | "partial",
      },
      conversationId: r.conversation_id,
      conversationTitle: r.title,
    }));
  }

  /** Full-text search across the user's messages. */
  async search(userId: string, query: string, limit = 30): Promise<MessageWithContext[]> {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const rows = this.handle.sqlite
      .prepare(
        `SELECT m.id, m.conversation_id, m.role, m.content, m.status, m.created_at, c.title
         FROM messages_fts f
         JOIN messages m ON m.id = f.message_id
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND messages_fts MATCH ?
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(userId, fts, limit) as Array<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      status: string;
      created_at: number;
      title: string;
    }>;
    return rows.map((r) => ({
      message: {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role as Role,
        content: r.content,
        createdAt: new Date(r.created_at).toISOString(),
        status: r.status as "complete" | "partial",
      },
      conversationId: r.conversation_id,
      conversationTitle: r.title,
    }));
  }

  async countByConversation(conversationId: string): Promise<number> {
    const rows = this.handle.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();
    return rows.length;
  }

  async countInRange(userId: string, startMs: number, endMs: number): Promise<number> {
    const rows = this.handle.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND m.created_at >= ? AND m.created_at < ?`,
      )
      .get(userId, startMs, endMs) as { n: number };
    return rows.n;
  }

  async findByConversationAndRange(conversationId: string, startMs: number, endMs: number): Promise<ConversationMessage[]> {
    const rows = this.handle.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          gte(messages.createdAt, startMs),
          lte(messages.createdAt, endMs),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .all() as Array<typeof messages.$inferSelect>;
    return rows.map((r: typeof messages.$inferSelect) => this.toMessage(r));
  }

  async conversationExistsForUser(userId: string, conversationId: string): Promise<boolean> {
    const row = this.handle.sqlite
      .prepare("SELECT 1 AS ok FROM conversations WHERE id = ? AND user_id = ?")
      .get(conversationId, userId);
    return row !== undefined;
  }

  private toMessage(r: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    status: string;
    createdAt: number;
  }): ConversationMessage {
    return {
      id: r.id,
      conversationId: r.conversationId,
      role: r.role as Role,
      content: r.content,
      createdAt: new Date(r.createdAt).toISOString(),
      status: r.status as "complete" | "partial",
    };
  }
}
