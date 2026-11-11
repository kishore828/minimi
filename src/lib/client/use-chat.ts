"use client";

/**
 * useChat — client state machine for the Memento conversation stream.
 *
 * Consumes the SSE event protocol from POST /api/chat and maintains:
 *  - messages (user + assistant, with citations/comparisons/research traces)
 *  - live research activity (real events only — no synthetic animations)
 *  - abort/retry lifecycle
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentPlanEventPayload, AgentStage, AgentStreamEvent } from "@/shared/types/events";
import type { ClaimComparison, SourceRef } from "@/shared/types";
import { api, type ConversationMessageWithResearch } from "./api";

export interface ResearchTrace {
  stages: Array<{ stage: AgentStage; status: "active" | "done"; detail?: string }>;
  plan: AgentPlanEventPayload | null;
  searches: Array<{ query: string; status: "running" | "done" | "failed"; resultCount?: number; cached?: boolean }>;
  sources: SourceRef[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "complete" | "partial" | "streaming" | "pending" | "error";
  citations: SourceRef[];
  comparisons: ClaimComparison[] | null;
  research: ResearchTrace | null;
  metrics?: { durationMs: number; searchCalls: number; llmCalls: number };
  interrupted?: boolean;
  errorMessage?: string;
  errorCode?: string;
}

export interface ChatState {
  conversationId: string | null;
  title: string;
  messages: ChatMessage[];
  streaming: boolean;
  transportError: string | null;
}

type StateUpdater = (state: ChatState) => ChatState;

const STAGE_ORDER: AgentStage[] = ["understanding", "retrieving_history", "planning", "searching", "comparing", "generating"];

function emptyTrace(): ResearchTrace {
  return { stages: [], plan: null, searches: [], sources: [] };
}

/** Apply a stream event to the streaming assistant message. */
function applyEvent(state: ChatState, event: AgentStreamEvent, tempAssistantId: string): ChatState {
  const updateAssistant = (fn: (m: ChatMessage) => ChatMessage): StateUpdater => {
    return (s: ChatState): ChatState => ({
      ...s,
      messages: s.messages.map((m) => (m.id === tempAssistantId ? fn(m) : m)),
    });
  };

  switch (event.type) {
    case "stage": {
      return updateAssistant((m) => {
        const stages = [...(m.research?.stages ?? [])];
        const existingIndex = stages.findIndex((s) => s.stage === event.stage);
        if (existingIndex >= 0) {
          stages[existingIndex] = { ...stages[existingIndex], status: "done", detail: event.detail };
        } else {
          stages.push({ stage: event.stage, status: "active", detail: event.detail });
        }
        // mark earlier stages done (they finished by definition)
        for (let i = 0; i < stages.length - 1; i++) stages[i] = { ...stages[i], status: "done" };
        return { ...m, research: { ...(m.research ?? emptyTrace()), stages } };
      })(state);
    }
    case "plan":
      return updateAssistant((m) => ({
        ...m,
        research: { ...(m.research ?? emptyTrace()), plan: event.plan },
      }))(state);
    case "search_start":
      return updateAssistant((m) => {
        const research = m.research ?? emptyTrace();
        return {
          ...m,
          research: { ...research, searches: [...research.searches, { query: event.query, status: "running" }] },
        };
      })(state);
    case "search_end":
      return updateAssistant((m) => {
        const research = m.research ?? emptyTrace();
        const searches = research.searches.map((s) =>
          s.query === event.query && s.status === "running"
            ? { ...s, status: event.resultCount > 0 || event.cached ? ("done" as const) : ("failed" as const), resultCount: event.resultCount, cached: event.cached }
            : s,
        );
        return { ...m, research: { ...research, searches } };
      })(state);
    case "sources":
      return updateAssistant((m) => ({
        ...m,
        citations: event.sources,
        research: { ...(m.research ?? emptyTrace()), sources: event.sources },
      }))(state);
    case "comparison":
      return updateAssistant((m) => ({ ...m, comparisons: event.comparisons }))(state);
    case "token":
      return updateAssistant((m) => ({
        ...m,
        content: m.content + event.text,
        status: "streaming",
      }))(state);
    case "turn_end": {
      const messages = state.messages.map((m) =>
        m.id === tempAssistantId
          ? {
              ...m,
              id: event.messageId,
              status: "complete" as const,
              citations: event.citations.length > 0 ? event.citations : m.citations,
              metrics: {
                durationMs: event.metrics.durationMs,
                searchCalls: event.metrics.searchCalls,
                llmCalls: event.metrics.llmCalls,
              },
            }
          : m,
      );
      return { ...state, messages, title: event.title ?? state.title, conversationId: event.conversationId };
    }
    case "memory_saved":
      return updateAssistant((m) => {
        const research = m.research ?? emptyTrace();
        return {
          ...m,
          research: {
            ...research,
            stages: research.stages.map((s) =>
              s.stage === "generating" ? { ...s, detail: `${s.detail ?? ""} · ${event.count} memories saved`.trim() } : s,
            ),
          },
        };
      })(state);
    case "error":
      return updateAssistant((m) => ({
        ...m,
        status: "error",
        errorMessage: event.message,
        errorCode: event.code,
      }))(state);
    default:
      return state;
  }
}

export interface UseChatResult {
  state: ChatState;
  send: (text: string, options?: { retryOfMessageId?: string }) => Promise<void>;
  abort: () => void;
  retry: () => void;
  canRetry: boolean;
  loadConversation: (id: string) => Promise<void>;
  newChat: () => void;
}

export function useChat(options: {
  onConversationChanged?: () => void;
  onTitleGenerated?: (title: string) => void;
}): UseChatResult {
  const [state, setState] = useState<ChatState>({
    conversationId: null,
    title: "New conversation",
    messages: [],
    streaming: false,
    transportError: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<{ text: string; id: string | null }>({ text: "", id: null });
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const send = useCallback(
    async (text: string, sendOptions?: { retryOfMessageId?: string }) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      lastUserMessageRef.current = { text: trimmed, id: sendOptions?.retryOfMessageId ?? null };

      const tempUserId = `tmp-user-${Date.now()}`;
      const tempAssistantId = `tmp-assistant-${Date.now()}`;
      const nowIso = new Date().toISOString();

      setState((prev) => {
        // Retry replaces the failed exchange.
        const base =
          sendOptions?.retryOfMessageId && prev.messages.length > 0
            ? prev.messages.slice(0, prev.messages.length - 2)
            : prev.messages;
        return {
          ...prev,
          streaming: true,
          transportError: null,
          messages: [
            ...base,
            {
              id: tempUserId,
              role: "user",
              content: trimmed,
              createdAt: nowIso,
              status: "complete",
              citations: [],
              comparisons: null,
              research: null,
            },
            {
              id: tempAssistantId,
              role: "assistant",
              content: "",
              createdAt: nowIso,
              status: "pending",
              citations: [],
              comparisons: null,
              research: null,
            },
          ],
        };
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: state.conversationId,
            message: trimmed,
            ...(sendOptions?.retryOfMessageId ? { retryOf: sendOptions.retryOfMessageId } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(detail?.error?.message ?? `Chat request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let gotTurnStart = false;
        let gotErrorEvent = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let event: AgentStreamEvent;
            try {
              event = JSON.parse(line.slice(6)) as AgentStreamEvent;
            } catch {
              continue;
            }
            if (event.type === "turn_start") {
              gotTurnStart = true;
              lastUserMessageRef.current = { text: trimmed, id: event.userMessageId };
              setState((prev) => ({
                ...prev,
                conversationId: event.conversationId,
                messages: prev.messages.map((m) =>
                  m.id === tempUserId ? { ...m, id: event.userMessageId } : m,
                ),
              }));
            } else {
              if (event.type === "error") gotErrorEvent = true;
              setState((prev) => applyEvent(prev, event, tempAssistantId));
            }
          }
        }

        if (!gotTurnStart && !gotErrorEvent) {
          throw new Error("The assistant could not start this turn.");
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setState((prev) => ({
            ...prev,
            streaming: false,
            messages: prev.messages.map((m) =>
              m.id === tempAssistantId && (m.status === "pending" || m.status === "streaming")
                ? {
                    ...m,
                    status: m.content.length > 0 ? "partial" : "error",
                    interrupted: true,
                    errorMessage: m.content.length > 0 ? undefined : "Response cancelled.",
                  }
                : m,
            ),
          }));
        } else {
          const message = error instanceof Error ? error.message : "Something went wrong.";
          setState((prev) => ({
            ...prev,
            streaming: false,
            transportError: message,
            messages: prev.messages.map((m) =>
              m.id === tempAssistantId && m.status !== "complete"
                ? { ...m, status: "error", errorMessage: message }
                : m,
            ),
          }));
        }
      } finally {
        abortRef.current = null;
        setState((prev) => ({ ...prev, streaming: false }));
        optionsRef.current.onConversationChanged?.();
      }
    },
    [state.conversationId],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    const { text, id } = lastUserMessageRef.current;
    if (text.length === 0) return;
    void send(text, id ? { retryOfMessageId: id } : undefined);
  }, [send]);

  const canRetry =
    !state.streaming &&
    state.messages.some((m) => m.role === "assistant" && m.status === "error") &&
    lastUserMessageRef.current.text.length > 0;

  const loadConversation = useCallback(async (id: string) => {
    abortRef.current?.abort();
    lastUserMessageRef.current = { text: "", id: null };
    const detail = await api.getConversation(id);
    const messages: ChatMessage[] = detail.messages.map((m: ConversationMessageWithResearch) => ({
      id: m.id,
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      createdAt: m.createdAt,
      status: m.status,
      citations: m.citations ?? [],
      comparisons: m.comparisons ?? null,
      research:
        m.role === "assistant" && (m.citations?.length || m.comparisons)
          ? { stages: [], plan: null, searches: [], sources: m.citations ?? [] }
          : null,
      interrupted: m.status === "partial",
    }));
    setState({
      conversationId: id,
      title: detail.conversation.title,
      messages,
      streaming: false,
      transportError: null,
    });
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    lastUserMessageRef.current = { text: "", id: null };
    setState({
      conversationId: null,
      title: "New conversation",
      messages: [],
      streaming: false,
      transportError: null,
    });
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { state, send, abort, retry, canRetry, loadConversation, newChat };
}
