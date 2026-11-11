/** Typed client for the Memento REST API (SSE handled separately in use-chat). */
import type { ClaimComparison, Conversation, ConversationMessage, SourceRef } from "@/shared/types";

export interface HealthReport {
  status: string;
  version: string;
  uptimeSeconds: number;
  database: string;
  llm: { configured: boolean; model: string };
  search: { configured: boolean; provider: string };
  timezone: string;
  limits: {
    maxSearchQueries: number;
    maxSearchResults: number;
    maxAgentIterations: number;
    maxResearchTimeMs: number;
    searchCacheTtlSeconds: number;
    rateLimitPerMinute: number;
  };
  tools: Array<{ name: string; description: string }>;
}

export interface ConversationMessageWithResearch extends ConversationMessage {
  citations: SourceRef[];
  comparisons: ClaimComparison[] | null;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ConversationMessageWithResearch[];
  summary: string | null;
  memories: Array<{ content: string; category: string; createdAt: string }>;
}

export interface SearchTestResult {
  provider: string;
  cached: boolean;
  results: Array<{ title: string; url: string; domain: string; publishedDate: string | null; score: number }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string } })
    | null;
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  health: () => request<HealthReport>("/api/health"),
  testConnection: (target: "llm" | "search") =>
    request<{ target: string; ok: boolean; detail?: string }>("/api/health", {
      method: "POST",
      body: JSON.stringify({ target }),
    }),
  listConversations: (query?: string) =>
    request<{ conversations: Conversation[] }>(`/api/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  createConversation: () => request<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: "{}" }),
  getConversation: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    request<{ ok: boolean; title: string }>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) => request<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  deleteAllConversations: () => request<{ deleted: number }>("/api/conversations", { method: "DELETE" }),
  search: (query: string) =>
    request<SearchTestResult>("/api/search", { method: "POST", body: JSON.stringify({ query }) }),
};
