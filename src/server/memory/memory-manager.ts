/**
 * MemoryManager — the single entry point the orchestrator uses for everything
 * memory-related: relevant long-term memories and historical conversation
 * lookup. Keeps hybrid retrieval (recency + FTS + importance + entities)
 * behind one coherent API.
 */
import type { Repositories } from "@/server/database/repositories";
import type { Memory, MemoryCategory } from "@/shared/types";
import type { TemporalReference } from "@/shared/utils/temporal";
import { rankMemories, type ScoredMemory } from "./memory-ranking";
import { ConversationRetriever, type HistoricalConversationMatch } from "./conversation-retriever";

export interface RelevantMemory {
  content: string;
  category: MemoryCategory;
  importance: number;
  createdAt: string;
  conversationId: string | null;
  score: number;
}

export class MemoryManager {
  private readonly retriever: ConversationRetriever;

  constructor(
    private readonly deps: {
      repos: Repositories;
    },
  ) {
    this.retriever = new ConversationRetriever({ repos: deps.repos });
  }

  /** Top relevant memories for a question (FTS hits + recent, ranked). */
  async relevantMemories(input: {
    userId: string;
    question: string;
    entities: string[];
    limit?: number;
  }): Promise<RelevantMemory[]> {
    const limit = input.limit ?? 8;
    const [recent, ftsHits] = await Promise.all([
      this.deps.repos.memories.listRecent(input.userId, 40),
      this.deps.repos.memories.search(input.userId, input.question, 20),
    ]);

    const merged = new Map<string, Memory>();
    for (const memory of [...recent, ...ftsHits]) merged.set(memory.id, memory);

    const ranked: ScoredMemory[] = rankMemories(
      [...merged.values()],
      input.question,
      input.entities,
      new Date(),
      limit,
    );

    return ranked
      .filter((r) => r.score >= 0.15)
      .map((r) => ({
        content: r.memory.content,
        category: r.memory.category,
        importance: r.memory.importance,
        createdAt: r.memory.createdAt,
        conversationId: r.memory.conversationId,
        score: Number(r.score.toFixed(3)),
      }));
  }

  async findHistoricalConversations(input: {
    userId: string;
    question: string;
    entities: string[];
    temporalRefs: TemporalReference[];
    excludeConversationId?: string;
    limit?: number;
  }): Promise<HistoricalConversationMatch[]> {
    return this.retriever.find(input);
  }

  async memoriesForConversation(conversationId: string): Promise<Memory[]> {
    return this.deps.repos.memories.listByConversation(conversationId);
  }
}
