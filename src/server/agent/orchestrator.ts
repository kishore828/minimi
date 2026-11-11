/**
 * AgentOrchestrator — the pipeline that turns a user message into a
 * streamed, evidence-backed answer.
 *
 * Stages (each stage event reflects real work):
 *   understanding        deterministic temporal resolution
 *   retrieving_history   conversation window + memories + historical candidates
 *   planning             LLM classification (guarded by deterministic rules)
 *   searching            bounded multi-query web research (if needed)
 *   comparing            claim extraction vs. current evidence (if applicable)
 *   generating           streamed answer with validated citations
 *   → atomic persistence  (messages, research, evidence, memories, summary)
 *
 * Design principles:
 *  - Bounded: query caps, iteration caps, time budget, token budget.
 *  - Honest: missing history is reported, never fabricated; changes require
 *    cited evidence or are downgraded to INCONCLUSIVE.
 *  - Resilient: aborted streams persist partial output; a failed search
 *    round degrades to "could not verify", not to a crash.
 */
import type { Logger } from "@/shared/utils/logger";
import type { AgentStreamEvent } from "@/shared/types/events";
import type { AppConfig } from "../config";
import type { LlmClient } from "@/server/llm/client";
import { TrackedLlmClient } from "@/server/llm/tracked-client";
import type { DatabaseHandle } from "@/server/database/db";
import { persistTurn, type Repositories } from "@/server/database/repositories";
import type { MemoryManager } from "@/server/memory/memory-manager";
import { ConversationSummarizer } from "@/server/memory/summarizer";
import { MemoryExtractor } from "@/server/memory/memory-extractor";
import { TemporalComparator } from "@/server/research/temporal-comparator";
import { EvidenceLedger } from "@/server/research/evidence-ledger";
import { rankSources, selectBalancedEvidence } from "@/server/research/source-ranker";
import { sanitizeTextCitations } from "@/server/research/claim-verifier";
import { SearchExecutor } from "@/server/search/search-executor";
import { QueryPlanner } from "@/server/search/query-planner";
import { Planner } from "./planner";
import { ResearchExecutor } from "./executor";
import { ResponseGenerator } from "./response-generator";
import { EventQueue } from "./event-queue";
import { buildClaimsContext, buildComparisonContext, buildHistoricalContext, buildMemoryContext, type ResponseContext } from "./prompts";
import { TurnMetricsCollector } from "@/server/evaluation/metrics";
import { resolveTemporalReferences, type TemporalReference } from "@/shared/utils/temporal";
import { extractKeywords, keywordOverlap, truncate } from "@/shared/utils/text";
import { formatLocalDate } from "@/shared/utils/timezone";
import { isAbortError, AppError, toPublicError } from "@/shared/utils/errors";
import { newId } from "@/shared/utils/ids";
import type { HistoricalConversationMatch } from "@/server/memory/conversation-retriever";
import type { ClaimComparison, ConversationMessage, HistoricalClaim, MemoryCategory } from "@/shared/types";

const HISTORY_SIGNAL_RE =
  /\b(we|i)\s+(discussed|talked|spoke|asked|decided|shortlisted|compared|looked\s+at|went\s+over|mentioned)\b|\b(what|when)\s+(did|do)\s+(we|i|you)\b|\byou\s+(told|said|mentioned)\s+me\b|\bi\s+asked\b|\bremember\b|\blast\s+(time|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bsince\s+(we|last|monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday)\b|\bprevious(ly)?\b|\bhistory\b/i;

const COMPARISON_INTENT_RE = /\b(still|changed?|changes|current|currently|now|up\s+to\s+date|anymore|these\s+days|latest)\b/i;

export interface RunTurnInput {
  userId: string;
  conversationId: string | null;
  message: string;
  /** When retrying a failed turn: reuse this user message instead of inserting a duplicate. */
  reuseUserMessageId?: string | null;
  signal?: AbortSignal;
}

export interface OrchestratorDeps {
  llm: LlmClient;
  searchExecutor: SearchExecutor;
  memory: MemoryManager;
  repos: Repositories;
  handle: DatabaseHandle;
  config: AppConfig;
  logger: Logger;
}

export class AgentOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async *runTurn(input: RunTurnInput): AsyncGenerator<AgentStreamEvent> {
    const tracker = new TurnMetricsCollector();
    const logger = this.deps.logger.child({ turnId: newId("turn") });
    const startedAt = Date.now();

    try {
      /* ---- Setup: conversation + user message are persisted first so an
         interrupted turn never loses the user's side of the exchange. ---- */
      if (!this.deps.config.llmConfigured) {
        throw new AppError("MISSING_API_KEY", "OPENAI_API_KEY is not configured. Add it to .env and restart the server.", { expose: true });
      }

      let conversationId = input.conversationId;
      let isNewConversation = false;
      if (conversationId === null) {
        const conversation = await this.deps.repos.conversations.create({
          id: newId("conv"),
          userId: input.userId,
          title: "New conversation",
        });
        conversationId = conversation.id;
        isNewConversation = true;
      } else if (!(await this.deps.repos.messages.conversationExistsForUser(input.userId, conversationId))) {
        throw new AppError("NOT_FOUND", "Conversation not found.", { expose: true, status: 404 });
      }

      // Retry support: reuse the persisted user message when it is still the
      // last message of the conversation (i.e. no assistant reply yet).
      let userMessage;
      if (input.reuseUserMessageId) {
        const recent = await this.deps.repos.messages.listByConversation(conversationId, 500);
        const last = recent[recent.length - 1];
        if (last && last.id === input.reuseUserMessageId && last.role === "user") {
          userMessage = last;
        }
      }
      if (!userMessage) {
        userMessage = await this.deps.repos.messages.create({
          id: newId("msg"),
          conversationId,
          role: "user",
          content: input.message,
        });
      }

      const turnId = newId("turn");
      yield { type: "turn_start", turnId, conversationId, userMessageId: userMessage.id, createdAt: userMessage.createdAt };
      logger.info("turn.user_message_saved", { conversationId, messageLength: input.message.length, isNewConversation });

      /* ---- Understanding: deterministic temporal resolution. ---- */
      yield { type: "stage", stage: "understanding" };
      const now = new Date();
      const currentDateLabel = `${formatLocalDate(now, this.deps.config.timezone)} (${now.toISOString().slice(0, 10)}, ${this.deps.config.timezone})`;
      const temporalRefs = resolveTemporalReferences(input.message, now, this.deps.config.timezone);
      const historicalRefs = temporalRefs.filter((r) => r.role === "historical");
      if (temporalRefs.length > 0) {
        logger.debug("turn.temporal_resolved", { refs: temporalRefs.map((r) => `${r.matchedText}:${r.role}`) });
      }

      /* ---- Retrieving history: current conversation, memories, candidates. ---- */
      yield { type: "stage", stage: "retrieving_history" };
      const allHistory = await this.deps.repos.messages.listByConversation(conversationId, 400);
      const priorHistory = allHistory.filter((m) => m.id !== userMessage.id);
      const recentHistory = priorHistory.slice(-14);

      const keywords = extractKeywords(input.message, 8);
      const memories = await this.deps.memory.relevantMemories({
        userId: input.userId,
        question: input.message,
        entities: [],
      });

      let historicalMatches = await this.deps.memory.findHistoricalConversations({
        userId: input.userId,
        question: input.message,
        entities: keywords,
        temporalRefs,
        excludeConversationId: conversationId,
        limit: 3,
      });
      const historySignal = historicalRefs.length > 0 || HISTORY_SIGNAL_RE.test(input.message);

      /* ---- Planning. ---- */
      yield { type: "stage", stage: "planning" };
      const trackedLlm = new TrackedLlmClient(this.deps.llm, tracker);
      const planner = new Planner(trackedLlm);
      const { plan } = await planner.classify({
        question: input.message,
        recentHistory,
        memories,
        historicalMatches: historySignal ? historicalMatches : [],
        temporalRefs,
        currentDateLabel,
        signal: input.signal,
      });
      logger.info("turn.planned", {
        category: plan.category,
        needsSearch: plan.needsSearch,
        entities: plan.entities.length,
        historySignal,
      });

      yield {
        type: "plan",
        plan: {
          category: plan.category,
          needsSearch: plan.needsSearch,
          entities: plan.entities,
          queries: plan.draftQueries.slice(0, this.deps.config.maxSearchQueries),
        },
      };

      /* Second retrieval pass when the planner wants history we did not
         prefetch (question looked non-historical to the heuristic). */
      if (plan.requiresHistoryRetrieval && !historySignal && historicalMatches.length === 0) {
        historicalMatches = await this.deps.memory.findHistoricalConversations({
          userId: input.userId,
          question: input.message,
          entities: plan.historicalKeywords.length > 0 ? plan.historicalKeywords : keywords,
          temporalRefs,
          excludeConversationId: conversationId,
          limit: 3,
        });
      }

      const comparisonIntent =
        plan.category === "TEMPORAL_COMPARISON" ||
        (plan.category === "MULTI_ENTITY_RESEARCH" && COMPARISON_INTENT_RE.test(input.message)) ||
        (plan.needsSearch &&
          (historicalMatches.length > 0 || priorHistory.length > 0) &&
          COMPARISON_INTENT_RE.test(input.message) &&
          /\b(since|last|previous|earlier|still)\b/i.test(input.message));

      /* Same-conversation history fallback: if the referenced baseline lives
         earlier in THIS conversation (either older than recentHistory or in
         recentHistory during an in-thread comparison), surface it here so we
         neither fabricate "NO record" nor skip claim comparison. */
      if (historicalMatches.length === 0 && priorHistory.length > 0 && (plan.requiresHistoryRetrieval || comparisonIntent || historicalRefs.length > 0)) {
        const sameConvMatch = matchCurrentConversationHistory({
          conversationId,
          priorHistory,
          historicalRefs,
          keywords: plan.historicalKeywords.length > 0 ? plan.historicalKeywords : keywords,
          entities: plan.entities,
          question: input.message,
          allowRecentFallback: comparisonIntent,
        });
        if (sameConvMatch) {
          historicalMatches = [sameConvMatch];
        }
      }

      const historyFound = historicalMatches.length > 0;
      let needsSearch = plan.needsSearch;

      let entities = [...plan.entities];
      let guidance: string | null = null;
      let historicalContext: string | null = null;
      let claims: HistoricalClaim[] = [];
      let comparisonDateHint: string | null = null;
      let wantsComparison = false;

      if (historyFound) {
        historicalContext = buildHistoricalContext(historicalMatches, "HISTORICAL CONVERSATION (retrieved from memory)");
      }

      /* Comparison preparation: extract the historical claims to re-verify. */
      if (comparisonIntent && historyFound) {
        wantsComparison = true;
        const match = historicalMatches[0];
        comparisonDateHint = historicalRefs[0]?.summary ?? match.matchedAt.slice(0, 10);
        const comparator = new TemporalComparator(trackedLlm);
        const extracted = await comparator.extractClaims({
          messages: match.messages,
          referenceDateHint: comparisonDateHint,
          signal: input.signal,
        });
        claims = extracted;
        // Claim subjects are the precise research targets; they take priority
        // over raw question keywords so the query budget is never wasted on
        // filler words like "pricing" or "november".
        const subjects = [...new Set(claims.map((c) => c.subject))];
        entities = mergeEntityNames(subjects, entities);
        logger.info("turn.claims_extracted", { claims: claims.length, subjects: subjects.length });
      }

      /* Honest handling of missing history. */
      const historyRequested =
        plan.requiresHistoryRetrieval ||
        (historicalRefs.length > 0 &&
          (HISTORY_SIGNAL_RE.test(input.message) ||
            plan.category === "HISTORY_LOOKUP" ||
            plan.category === "TEMPORAL_COMPARISON" ||
            plan.category === "AMBIGUOUS_HISTORY"));
      if (historyRequested && !historyFound) {
        const window =
          historicalRefs.length > 0 ? ` (looked for conversations around ${historicalRefs.map((r) => r.summary).join("; ")})` : "";
        guidance =
          `You have NO record of the conversation the user is referring to${window}. ` +
          `Say plainly that you could not find that discussion in your stored memory. Do NOT fabricate or guess its contents. ` +
          `Ask the user to share the specific products, details, or question if they'd like you to research it from scratch right now.`;
        if (plan.category === "TEMPORAL_COMPARISON" || plan.category === "HISTORY_LOOKUP" || plan.category === "AMBIGUOUS_HISTORY") {
          needsSearch = false;
        }
      } else if (plan.category === "HISTORY_LOOKUP" && historyFound && !needsSearch) {
        guidance =
          "The user is asking about an earlier conversation. Answer from the HISTORICAL CONVERSATION context above. " +
          "Mention when that discussion took place. Do not search the web and do not invent details beyond what the context shows.";
      } else if (plan.category === "AMBIGUOUS_HISTORY" && plan.clarificationQuestion) {
        guidance =
          `The reference is ambiguous. Ask the user the clarification question: "${plan.clarificationQuestion}". ` +
          `Do not guess which conversation they mean.`;
      }

      /* ---- Searching (bounded). ---- */
      const ledger = new EvidenceLedger();
      if (needsSearch) {
        if (entities.length === 0) entities = keywords.slice(0, 5);
        entities = entities.slice(0, 8);
        if (!this.deps.config.searchConfigured) {
          throw new AppError("MISSING_API_KEY", "This question needs current web research, but TAVILY_API_KEY is not configured.", {
            expose: true,
          });
        }
        yield { type: "stage", stage: "searching" };

        const researchExecutor = new ResearchExecutor({
          queryPlanner: new QueryPlanner(trackedLlm, { maxQueries: this.deps.config.maxSearchQueries }),
          searchExecutor: this.deps.searchExecutor,
          config: this.deps.config,
          logger,
        });

        const queue = new EventQueue();
        const work = researchExecutor
          .run({
            question: input.message,
            entities,
            historicalContext: historicalContext ?? undefined,
            comparisonDateHint: comparisonDateHint ?? undefined,
            tracker,
            emit: (event) => queue.push(event),
            signal: input.signal,
          })
          .finally(() => queue.close());
        work.catch(() => {}); // handled below; prevents unhandled rejections

        for await (const event of queue.drain()) {
          yield event;
        }
        const report = await work;

        if (report.results.length > 0) {
          const ranked = rankSources(report.results, { question: input.message, entities });
          const cap = Math.max(4, this.deps.config.maxSearchQueries * 2);
          const selected = selectBalancedEvidence(ranked, entities, cap);
          for (const { result } of selected) {
            ledger.add(result, truncate(input.message, 120));
          }
          if (ledger.size > 0) {
            yield { type: "sources", sources: ledger.list() };
          }
        } else if (report.failures > 0) {
          // All searches failed: answer honestly instead of erroring the turn.
          guidance =
            `${guidance ? `${guidance} ` : ""}` +
            "Web search could not be completed (the provider errored or is unreachable). " +
            "Tell the user plainly that you could NOT verify current information, and answer only from the context you have, clearly marking what remains unverified.";
        }
        logger.info("turn.search_completed", {
          results: report.results.length,
          failures: report.failures,
          refinements: report.refinementRounds,
          cacheHits: report.cacheHits,
        });
      }

      /* ---- Comparing historical claims against current evidence. ---- */
      let comparisons: ClaimComparison[] = [];
      if (wantsComparison && claims.length > 0) {
        if (ledger.size > 0) {
          yield { type: "stage", stage: "comparing" };
          const comparator = new TemporalComparator(trackedLlm);
          comparisons = await comparator.compare({
            claims,
            evidencePrompt: ledger.formatForPrompt(),
            evidenceCount: ledger.size,
            comparisonDateHint: comparisonDateHint ?? "the earlier discussion",
            currentDateLabel,
            signal: input.signal,
          });
        } else {
          comparisons = claims.map((claim) => ({
            subject: claim.subject,
            claim: claim.claim,
            historicalValue: claim.value,
            currentValue: null,
            classification: "NO_LONGER_VERIFIABLE" as const,
            evidenceCitations: [],
            explanation: "Current information could not be retrieved, so this claim could not be re-verified.",
          }));
        }
        if (comparisons.length > 0) {
          yield { type: "comparison", comparisons };
        }
      }

      /* ---- Generating the streamed answer. ---- */
      yield { type: "stage", stage: "generating" };
      const responseContext: ResponseContext = {
        question: input.message,
        recentHistory,
        memoryContext: buildMemoryContext(memories),
        historicalContext,
        claimsContext: buildClaimsContext(claims, comparisonDateHint ?? "the earlier discussion"),
        evidenceContext: ledger.size > 0 ? ledger.formatForPrompt() : null,
        comparisonContext: buildComparisonContext(comparisons, ledger.list()),
        guidance,
        currentDateLabel,
      };

      const generator = new ResponseGenerator(trackedLlm);
      let full = "";
      let interrupted = false;
      try {
        for await (const token of generator.stream(responseContext, input.signal)) {
          full += token;
          yield { type: "token", text: token };
        }
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) {
          interrupted = true;
        } else {
          throw error;
        }
      }

      if (interrupted && full.trim().length === 0) {
        // Nothing generated: nothing to persist for the assistant side.
        yield { type: "error", code: "ABORTED", message: "Response cancelled before any output was produced." };
        return;
      }

      const finalText = sanitizeTextCitations(full, ledger.size).trim();
      const assistantMessageId = newId("msg");
      const assistantMessage: ConversationMessage = {
        id: assistantMessageId,
        conversationId,
        role: "assistant",
        content: finalText,
        createdAt: new Date().toISOString(),
        status: interrupted ? "partial" : "complete",
      };

      /* ---- Wrap-up: title, summary, memory extraction run in parallel (budget-guarded). ---- */
      const summarizer = new ConversationSummarizer(trackedLlm);
      const extractor = new MemoryExtractor(trackedLlm);
      const tokenBudgetAvailable = () => tracker.promptTokens + tracker.completionTokens < this.deps.config.maxTotalTokens;

      const totalMessagesAfterTurn = priorHistory.length + 2;
      const shouldSummarize =
        !interrupted && tokenBudgetAvailable() && (totalMessagesAfterTurn <= 2 || totalMessagesAfterTurn % 6 <= 2);

      const titlePromise: Promise<string | null> = isNewConversation
        ? summarizer
            .generateTitle({ userMessage: input.message, assistantMessage: finalText })
            .catch(() => truncate(input.message, 48))
        : Promise.resolve(null);

      const summaryPromise: Promise<string | null> = shouldSummarize
        ? this.deps.repos.research
            .getSummary(conversationId)
            .then((existingSummary) =>
              summarizer.summarize({
                messages: [...priorHistory, userMessage, assistantMessage],
                previousSummary: existingSummary,
              }),
            )
            .catch(() => null)
        : Promise.resolve(null);

      const memoryPromise: Promise<Array<{ id: string; content: string; category: MemoryCategory; importance: number }>> =
        !interrupted && tokenBudgetAvailable()
          ? extractor
              .extract({ userMessage: input.message, assistantMessage: finalText, currentDateLabel })
              .then((extracted) =>
                extracted.map((m) => ({
                  id: newId("mem"),
                  content: m.content,
                  category: m.category,
                  importance: m.importance,
                })),
              )
              .catch(() => [])
          : Promise.resolve([]);

      const [title, summary, extractedMemories] = await Promise.all([titlePromise, summaryPromise, memoryPromise]);

      /* ---- Atomic persistence. ---- */
      const metricsSnapshot = tracker.snapshot();
      const researchRecord =
        ledger.size > 0 || comparisons.length > 0
          ? {
              sessionId: newId("res"),
              query: input.message,
              category: plan.category,
              searchCount: metricsSnapshot.searchCalls,
              llmCallCount: tracker.llmCalls,
              durationMs: Date.now() - startedAt,
              comparisons: comparisons.length > 0 ? comparisons : null,
              evidence: ledger.list(),
            }
          : null;

      persistTurn(this.deps.handle, {
        userId: input.userId,
        conversationId,
        assistantMessage: {
          id: assistantMessageId,
          content: finalText,
          status: interrupted ? "partial" : "complete",
          createdAt: new Date(assistantMessage.createdAt),
        },
        title,
        summary,
        research: researchRecord,
        memories: extractedMemories,
      });

      logger.info("turn.completed", {
        conversationId,
        durationMs: Date.now() - startedAt,
        llmCalls: tracker.llmCalls,
        searchCalls: tracker.snapshot().searchCalls,
        citations: ledger.size,
        memoriesSaved: extractedMemories.length,
      });

      yield {
        type: "turn_end",
        messageId: assistantMessageId,
        conversationId,
        title,
        citations: ledger.list(),
        metrics: tracker.snapshot(),
      };
      if (extractedMemories.length > 0) {
        yield { type: "memory_saved", count: extractedMemories.length };
      }
    } catch (error) {
      const publicError = toPublicError(error);
      logger.error("turn.failed", {
        code: publicError.code,
        message: publicError.message,
        durationMs: Date.now() - startedAt,
      });
      yield { type: "error", code: publicError.code, message: publicError.message };
    }
  }
}

/** Merge extracted claim subjects with planner entities, dropping bare duplicates like "Neon" when "Neon Pro" exists. */
function mergeEntityNames(subjects: string[], plannerEntities: string[]): string[] {
  const result = [...subjects];
  const lowerSubjects = subjects.map((s) => s.toLowerCase());
  for (const entity of plannerEntities) {
    const lower = entity.toLowerCase();
    const coveredBySubject = lowerSubjects.some((s) => s === lower || s.startsWith(`${lower} `));
    if (!coveredBySubject && !result.some((r) => r.toLowerCase() === lower)) {
      result.push(entity);
    }
  }
  return result;
}

/**
 * Fallback lookup inside the active conversation when cross-conversation search
 * finds nothing — handles long threads (>14 messages) and in-thread "has it
 * changed since earlier?" follow-ups while honoring explicit date windows.
 */
function matchCurrentConversationHistory(input: {
  conversationId: string;
  priorHistory: ConversationMessage[];
  historicalRefs: TemporalReference[];
  keywords: string[];
  entities: string[];
  question: string;
  allowRecentFallback: boolean;
}): HistoricalConversationMatch | null {
  const { priorHistory, historicalRefs } = input;
  if (priorHistory.length === 0) return null;

  let matchedIndex = -1;
  if (historicalRefs.length > 0) {
    for (const ref of historicalRefs) {
      const startMs = new Date(ref.startUtc).getTime();
      const endMs = new Date(ref.endUtc).getTime();
      matchedIndex = priorHistory.findIndex((m) => {
        const ts = new Date(m.createdAt).getTime();
        return ts >= startMs && ts < endMs;
      });
      if (matchedIndex >= 0) break;
    }
    // User asked about a specific past date/window that does not appear in this conversation either.
    if (matchedIndex < 0) return null;
  } else {
    const terms = [...input.entities, ...input.keywords].map((t) => t.toLowerCase()).filter((t) => t.length > 2);
    matchedIndex = priorHistory.findIndex((m) => {
      const lower = m.content.toLowerCase();
      return terms.some((t) => lower.includes(t)) || keywordOverlap(input.question, m.content) >= 0.15;
    });
    if (matchedIndex < 0) {
      if (!input.allowRecentFallback) return null;
      matchedIndex = Math.max(0, priorHistory.length - 6);
    }
  }

  const start = Math.max(0, matchedIndex - 1);
  const end = Math.min(priorHistory.length, start + 12);
  const window = priorHistory.slice(start, end).map((m) => ({
    role: m.role,
    content: truncate(m.content, 1200),
    createdAt: m.createdAt,
  }));
  if (window.length === 0) return null;

  return {
    conversationId: input.conversationId,
    title: "Current conversation (earlier)",
    score: 1,
    matchedAt: window[0].createdAt,
    summary: null,
    messages: window,
    matchReasons: ["current conversation history"],
  };
}
