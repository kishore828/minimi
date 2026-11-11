/**
 * Memory ranking: hybrid scoring combining importance, recency, keyword
 * overlap and entity mentions. Deterministic and unit-tested; embeddings can
 * be added later behind the same interface (see DESIGN.md).
 */
import type { Memory } from "@/shared/types";
import { keywordOverlap, tokenize } from "@/shared/utils/text";

const RECENCY_HALF_LIFE_DAYS = 14;
const WEIGHTS = {
  importance: 0.4,
  recency: 0.2,
  overlap: 0.25,
  entity: 0.15,
} as const;

export interface ScoredMemory {
  memory: Memory;
  score: number;
}

function recencyScore(createdAt: string, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - new Date(createdAt).getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function entityScore(memory: Memory, entities: string[]): number {
  if (entities.length === 0) return 0;
  const content = memory.content.toLowerCase();
  const hits = entities.filter((e) => content.includes(e.toLowerCase())).length;
  return Math.min(1, hits / entities.length);
}

export function scoreMemory(memory: Memory, query: string, entities: string[], now: Date): number {
  return (
    WEIGHTS.importance * Math.min(1, Math.max(0, memory.importance)) +
    WEIGHTS.recency * recencyScore(memory.createdAt, now) +
    WEIGHTS.overlap * keywordOverlap(query, memory.content) +
    WEIGHTS.entity * entityScore(memory, entities)
  );
}

/** Rank memories for a query; ties broken by recency. */
export function rankMemories(
  memories: Memory[],
  query: string,
  entities: string[],
  now: Date,
  limit = 8,
): ScoredMemory[] {
  return memories
    .map((memory) => ({ memory, score: scoreMemory(memory, query, entities, now) }))
    .sort((a, b) => b.score - a.score || new Date(b.memory.createdAt).getTime() - new Date(a.memory.createdAt).getTime())
    .slice(0, limit);
}

/** Cheap pre-filter used before FTS: keep memories sharing any token. */
export function sharesAnyToken(memoryContent: string, query: string): boolean {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return false;
  for (const token of tokenize(memoryContent)) {
    if (queryTokens.has(token)) return true;
  }
  return false;
}
