/**
 * Historical conversation retrieval.
 *
 * Hybrid strategy, all local SQLite (cheap enough to run before planning):
 *  1. Date-window candidates from resolved temporal references.
 *  2. Full-text search candidates over message content.
 *  3. Summary-similarity candidates over stored conversation summaries.
 * Scores merge the three sources; top matches return a focused message
 * window around the hits so the planner/generator see real history.
 */
import type { Repositories } from "@/server/database/repositories";
import type { ConversationMessage } from "@/shared/types";
import type { TemporalReference } from "@/shared/utils/temporal";
import { keywordOverlap, tokenize, truncate } from "@/shared/utils/text";

const NON_TOPICAL_RETRIEVAL_WORDS = new Set([
  "today", "yesterday", "tomorrow", "week", "month", "year", "last", "earlier", "recent",
  "previous", "previously", "since", "ago", "ask", "asked", "answer", "answered", "correct",
  "accurate", "true", "valid", "still", "changed", "change", "remember", "tell", "told",
  "talk", "talked", "discuss", "discussed", "chat", "conversation", "question",
]);

function filterTopicalEntities(entities: string[], temporalRefs: TemporalReference[]): string[] {
  const temporalTokens = new Set(temporalRefs.flatMap((r) => tokenize(r.matchedText)));
  return entities.filter((entity) => {
    const tokens = tokenize(entity);
    if (tokens.length === 0) return false;
    return tokens.some((t) => t.length > 1 && !NON_TOPICAL_RETRIEVAL_WORDS.has(t) && !temporalTokens.has(t));
  });
}

export interface HistoricalConversationMatch {
  conversationId: string;
  title: string;
  score: number;
  matchedAt: string;
  summary: string | null;
  /** Focused window of messages around the matches (already ordered). */
  messages: Array<{ role: ConversationMessage["role"]; content: string; createdAt: string }>;
  matchReasons: string[];
}

interface Candidate {
  conversationId: string;
  title: string;
  summary: string | null;
  reasons: string[];
  matchedMessageIds: Set<string>;
  matchedSnippets: string[];
  hasFtsHit: boolean;
  inTemporalRange: boolean;
  updatedAt: number;
}

const MAX_CONTEXT_MESSAGES = 12;
const MAX_TOTAL_CHARS = 7000;

export class ConversationRetriever {
  constructor(
    private readonly deps: {
      repos: Repositories;
    },
  ) {}

  async find(input: {
    userId: string;
    question: string;
    entities: string[];
    temporalRefs: TemporalReference[];
    excludeConversationId?: string;
    limit?: number;
  }): Promise<HistoricalConversationMatch[]> {
    const candidates = new Map<string, Candidate>();

    const upsert = (
      conversationId: string,
      title: string,
      reason: string,
      extras: {
        summary?: string | null;
        messageId?: string;
        snippet?: string;
        hasFtsHit?: boolean;
        inTemporalRange?: boolean;
        updatedAt?: number;
      } = {},
    ) => {
      const existing = candidates.get(conversationId);
      if (existing) {
        existing.reasons.push(reason);
        if (extras.summary) existing.summary = extras.summary ?? existing.summary;
        if (extras.messageId) existing.matchedMessageIds.add(extras.messageId);
        if (extras.snippet) existing.matchedSnippets.push(extras.snippet);
        if (extras.hasFtsHit) existing.hasFtsHit = true;
        if (extras.inTemporalRange) existing.inTemporalRange = true;
        if (extras.updatedAt) existing.updatedAt = extras.updatedAt;
      } else {
        candidates.set(conversationId, {
          conversationId,
          title,
          summary: extras.summary ?? null,
          reasons: [reason],
          matchedMessageIds: extras.messageId ? new Set([extras.messageId]) : new Set(),
          matchedSnippets: extras.snippet ? [extras.snippet] : [],
          hasFtsHit: extras.hasFtsHit ?? false,
          inTemporalRange: extras.inTemporalRange ?? false,
          updatedAt: extras.updatedAt ?? 0,
        });
      }
    };

    /* 1. Temporal date-window candidates (skip present-tense anchors like "correct today?"). */
    for (const ref of input.temporalRefs) {
      if (ref.role === "present_anchor") continue;
      const startMs = new Date(ref.startUtc).getTime();
      const endMs = new Date(ref.endUtc).getTime();
      const inRange = await this.deps.repos.messages.findInRange(input.userId, startMs, endMs, 200);
      const byConversation = new Map<string, typeof inRange>();
      for (const item of inRange) {
        const list = byConversation.get(item.conversationId) ?? [];
        list.push(item);
        byConversation.set(item.conversationId, list);
      }
      for (const [conversationId, items] of byConversation) {
        if (conversationId === input.excludeConversationId) continue;
        upsert(conversationId, items[0].conversationTitle, `messages between ${ref.summary}`, {
          messageId: items[0].message.id,
          snippet: items.slice(0, 4).map((i) => i.message.content).join(" "),
          inTemporalRange: true,
        });
      }
    }

    /* 2. Full-text candidates. The question AND each topical entity are searched
          separately: real questions rarely repeat the exact phrasing of the
          original conversation, so ANDing all question tokens is too strict. */
    const topicalEntities = filterTopicalEntities(input.entities, input.temporalRefs);
    const ftsInputs = new Set<string>();
    if (input.question.trim().length > 0) ftsInputs.add(input.question);
    for (const entity of topicalEntities.slice(0, 4)) {
      if (entity.trim().length > 1) ftsInputs.add(entity);
    }
    for (const ftsInput of ftsInputs) {
      const fts = await this.deps.repos.messages.search(input.userId, ftsInput, 30);
      for (const item of fts) {
        if (item.conversationId === input.excludeConversationId) continue;
        upsert(item.conversationId, item.conversationTitle, `full-text match (${ftsInput === input.question ? "question" : "entity"})`, {
          messageId: item.message.id,
          snippet: item.message.content,
          hasFtsHit: true,
        });
      }
    }

    /* 3. Summary-similarity candidates. */
    const summaries = await this.deps.repos.research.latestSummaries(input.userId, 40);
    const entitiesLower = topicalEntities.map((e) => e.toLowerCase());
    const temporalTokenSet = new Set(input.temporalRefs.flatMap((r) => tokenize(r.matchedText)));
    const topicalQuestion = tokenize(input.question)
      .filter((t) => !NON_TOPICAL_RETRIEVAL_WORDS.has(t) && !temporalTokenSet.has(t))
      .join(" ");
    for (const entry of summaries) {
      if (entry.conversationId === input.excludeConversationId) continue;
      const overlap = topicalQuestion ? keywordOverlap(topicalQuestion, entry.summary) : 0;
      const entityHit = entitiesLower.some((e) => entry.summary.toLowerCase().includes(e));
      if (overlap >= 0.12 || entityHit) {
        const conversation = await this.deps.repos.conversations.get(input.userId, entry.conversationId);
        if (!conversation) continue;
        upsert(entry.conversationId, conversation.title, entityHit ? "entity in summary" : "summary similarity", {
          summary: entry.summary,
          updatedAt: new Date(entry.updatedAt).getTime(),
        });
      }
    }

    if (candidates.size === 0) return [];

    /* Score & rank. */
    const scored = [...candidates.values()].map((candidate) => {
      const searchText = [candidate.title, candidate.summary ?? "", ...candidate.matchedSnippets]
        .filter(Boolean)
        .join(" ");
      let score = topicalQuestion ? keywordOverlap(topicalQuestion, searchText) * 1.0 : 0;
      if (candidate.inTemporalRange) score += 0.5; // temporal window match is a strong signal
      if (candidate.hasFtsHit) score += 0.35; // FTS match survives even when summary is missing
      if (entitiesLower.some((e) => `${candidate.title} ${candidate.summary ?? ""} ${candidate.matchedSnippets.join(" ")}`.toLowerCase().includes(e))) {
        score += 0.25;
      }
      return { candidate, score };
    });

    scored.sort((a, b) => b.score - a.score || b.candidate.updatedAt - a.candidate.updatedAt);

    /* Build message windows for the top matches. */
    const limit = input.limit ?? 3;
    const matches: HistoricalConversationMatch[] = [];
    for (const { candidate, score } of scored) {
      if (matches.length >= limit || score <= 0) break;
      const history = await this.deps.repos.messages.listByConversation(candidate.conversationId, 300);
      if (history.length === 0) continue;

      let focusStart = 0;
      let focusEnd = Math.min(history.length, MAX_CONTEXT_MESSAGES);
      if (candidate.matchedMessageIds.size > 0) {
        const firstMatch = history.findIndex((m) => candidate.matchedMessageIds.has(m.id));
        if (firstMatch >= 0) {
          focusStart = Math.max(0, firstMatch - 2);
          focusEnd = Math.min(history.length, firstMatch + MAX_CONTEXT_MESSAGES - 2);
        }
      }

      const window: HistoricalConversationMatch["messages"] = [];
      let totalChars = 0;
      for (let i = focusStart; i < focusEnd; i++) {
        const message = history[i];
        const content = truncate(message.content, 1200);
        if (totalChars + content.length > MAX_TOTAL_CHARS) {
          window.push({ role: message.role, content: "[…earlier messages omitted…]", createdAt: message.createdAt });
          break;
        }
        totalChars += content.length;
        window.push({ role: message.role, content, createdAt: message.createdAt });
      }
      if (window.length === 0) continue;

      matches.push({
        conversationId: candidate.conversationId,
        title: candidate.title,
        score: Number(score.toFixed(3)),
        matchedAt: window[0].createdAt,
        summary: candidate.summary,
        messages: window,
        matchReasons: [...new Set(candidate.reasons)],
      });
    }
    return matches;
  }
}
