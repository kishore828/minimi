import { and, desc, eq, like } from "drizzle-orm";
import { conversations } from "../schema";
import type { DatabaseHandle } from "../db";
import { toFtsQuery } from "@/shared/utils/text";
import type { Conversation } from "@/shared/types";

function toConversation(row: {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    messageCount: row.messageCount ?? 0,
  };
}

export class ConversationsRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async create(input: { id: string; userId: string; title: string; createdAt?: Date }): Promise<Conversation> {
    const now = (input.createdAt ?? new Date()).getTime();
    this.handle.db
      .insert(conversations)
      .values({ id: input.id, userId: input.userId, title: input.title, createdAt: now, updatedAt: now })
      .run();
    return { id: input.id, title: input.title, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), messageCount: 0 };
  }

  async get(userId: string, id: string): Promise<Conversation | null> {
    const row = this.handle.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .get();
    if (!row) return null;
    const count = this.countMessages(row.id);
    return toConversation({ ...row, messageCount: count });
  }

  /** Newest first. `query` filters by title or message full-text match. */
  async list(
    userId: string,
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<Conversation[]> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    if (options.query && options.query.trim().length > 0) {
      const fts = toFtsQuery(options.query);
      const pattern = `%${options.query.trim().toLowerCase()}%`;
      if (fts) {
        const rows = this.handle.sqlite
          .prepare(
            `SELECT c.id, c.title, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
             FROM conversations c
             WHERE c.user_id = ?
               AND (
                 LOWER(c.title) LIKE ?
                 OR c.id IN (
                   SELECT m.conversation_id FROM messages m
                   WHERE m.id IN (SELECT message_id FROM messages_fts WHERE messages_fts MATCH ?)
                 )
               )
             ORDER BY c.updated_at DESC
             LIMIT ? OFFSET ?`,
          )
          .all(userId, pattern, fts, limit, offset) as Array<{
          id: string;
          title: string;
          created_at: number;
          updated_at: number;
          message_count: number;
        }>;
        return rows.map((r) =>
          toConversation({
            id: r.id,
            title: r.title,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            messageCount: r.message_count,
          }),
        );
      }
      const rows = this.handle.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.userId, userId), like(conversations.title, pattern)))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset)
        .all() as Array<typeof conversations.$inferSelect>;
      return rows.map((r: typeof conversations.$inferSelect) =>
        toConversation({ ...r, messageCount: this.countMessages(r.id) }),
      );
    }

    const rows = this.handle.sqlite
      .prepare(
        `SELECT c.id, c.title, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         WHERE c.user_id = ?
         ORDER BY c.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as Array<{
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      message_count: number;
    }>;
    return rows.map((r) =>
      toConversation({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: r.message_count,
      }),
    );
  }

  async rename(userId: string, id: string, title: string): Promise<boolean> {
    const result = this.handle.db
      .update(conversations)
      .set({ title })
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .run();
    return result.changes > 0;
  }

  async touch(id: string, at: Date = new Date()): Promise<void> {
    this.handle.db.update(conversations).set({ updatedAt: at.getTime() }).where(eq(conversations.id, id)).run();
  }

  /** Deletes a conversation and every dependent row in one transaction. */
  async delete(userId: string, id: string): Promise<boolean> {
    const existing = this.handle.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      .get();
    if (!existing) return false;

    this.handle.sqlite.transaction(() => {
      const sqlite = this.handle.sqlite;
      sqlite.prepare("DELETE FROM messages_fts WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)").run(id);
      sqlite.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
      sqlite.prepare("DELETE FROM memories_fts WHERE memory_id IN (SELECT id FROM memories WHERE conversation_id = ?)").run(id);
      sqlite.prepare("DELETE FROM memories WHERE conversation_id = ?").run(id);
      sqlite.prepare("DELETE FROM conversation_summaries WHERE conversation_id = ?").run(id);
      sqlite.prepare(
        "DELETE FROM evidence WHERE research_session_id IN (SELECT id FROM research_sessions WHERE conversation_id = ?)",
      ).run(id);
      sqlite.prepare("DELETE FROM research_sessions WHERE conversation_id = ?").run(id);
      sqlite.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    })();
    return true;
  }

  async deleteAll(userId: string): Promise<number> {
    const ids = (this.handle.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .all()) as Array<{ id: string }>;
    for (const row of ids) await this.delete(userId, row.id);
    return ids.length;
  }

  private countMessages(conversationId: string): number {
    const row = this.handle.sqlite
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?")
      .get(conversationId) as { n: number };
    return row.n;
  }
}
