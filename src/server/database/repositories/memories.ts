import { and, desc, eq } from "drizzle-orm";
import { memories } from "../schema";
import type { DatabaseHandle } from "../db";
import { toFtsQuery } from "@/shared/utils/text";
import type { Memory, MemoryCategory } from "@/shared/types";

export interface NewMemory {
  id: string;
  userId: string;
  conversationId: string | null;
  content: string;
  category: MemoryCategory;
  importance: number;
  sourceMessageId: string | null;
  createdAt?: Date;
}

export class MemoriesRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  async create(input: NewMemory): Promise<Memory> {
    const now = (input.createdAt ?? new Date()).getTime();
    this.handle.db
      .insert(memories)
      .values({
        id: input.id,
        userId: input.userId,
        conversationId: input.conversationId,
        content: input.content,
        category: input.category,
        importance: input.importance,
        sourceMessageId: input.sourceMessageId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.handle.sqlite.prepare("INSERT INTO memories_fts (memory_id, content) VALUES (?, ?)").run(input.id, input.content);
    return {
      id: input.id,
      userId: input.userId,
      conversationId: input.conversationId,
      content: input.content,
      category: input.category,
      importance: input.importance,
      sourceMessageId: input.sourceMessageId,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
  }

  async listRecent(userId: string, limit = 50): Promise<Memory[]> {
    const rows = this.handle.db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.createdAt))
      .limit(limit)
      .all() as Array<typeof memories.$inferSelect>;
    return rows.map((r: typeof memories.$inferSelect) => this.toMemory(r));
  }

  async search(userId: string, query: string, limit = 20): Promise<Memory[]> {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    const rows = this.handle.sqlite
      .prepare(
        `SELECT m.* FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE m.user_id = ? AND memories_fts MATCH ?
         ORDER BY m.importance DESC, m.created_at DESC
         LIMIT ?`,
      )
      .all(userId, fts, limit) as Array<typeof memories.$inferSelect>;
    return rows.map((r) => this.toMemory(r));
  }

  async listByConversation(conversationId: string): Promise<Memory[]> {
    const rows = this.handle.db
      .select()
      .from(memories)
      .where(eq(memories.conversationId, conversationId))
      .orderBy(desc(memories.createdAt))
      .all() as Array<typeof memories.$inferSelect>;
    return rows.map((r: typeof memories.$inferSelect) => this.toMemory(r));
  }

  async existsForUser(userId: string, id: string): Promise<boolean> {
    const row = this.handle.db
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .get();
    return row !== undefined;
  }

  private toMemory(r: typeof memories.$inferSelect): Memory {
    return {
      id: r.id,
      userId: r.userId,
      conversationId: r.conversationId,
      content: r.content,
      category: r.category as MemoryCategory,
      importance: r.importance,
      sourceMessageId: r.sourceMessageId,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  }
}
