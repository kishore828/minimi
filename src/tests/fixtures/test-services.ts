/**
 * Service graph for integration tests: isolated SQLite database (in-memory
 * by default), fake LLM + fake search provider injected through the same
 * constructors production uses.
 */
import { openDatabase, type DatabaseHandle } from "@/server/database/db";
import { createRepositories, type Repositories } from "@/server/database/repositories";
import { MemoryManager } from "@/server/memory/memory-manager";
import { SearchExecutor } from "@/server/search/search-executor";
import { AgentOrchestrator } from "@/server/agent/orchestrator";
import type { AppConfig } from "@/server/config";
import { DEFAULT_USER_ID } from "@/server/services";
import { createLogger, type Logger } from "@/shared/utils/logger";
import type { AgentStreamEvent } from "@/shared/types/events";
import type { FakeLlm } from "./fake-llm";
import type { FakeSearchProvider } from "./fake-search";
import { newId } from "@/shared/utils/ids";

export const TEST_USER_ID = DEFAULT_USER_ID;

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return Object.freeze({
    openaiApiKey: "test-key",
    openaiModel: "fake-model",
    openaiBaseUrl: "https://example.invalid/v1",
    tavilyApiKey: "test-key",
    searchProvider: "tavily",
    databaseUrl: ":memory:",
    timezone: "Asia/Kolkata",
    maxSearchQueries: 6,
    maxSearchResults: 5,
    maxAgentIterations: 2,
    maxResearchTimeMs: 30000,
    maxTotalTokens: 60000,
    searchTimeoutMs: 2000,
    searchCacheTtlSeconds: 900,
    searchConcurrency: 3,
    rateLimitPerMinute: 1000,
    logLevel: "error",
    llmConfigured: true,
    searchConfigured: true,
    ...overrides,
  });
}

export interface TestServices {
  orchestrator: AgentOrchestrator;
  repos: Repositories;
  handle: DatabaseHandle;
  config: AppConfig;
  logger: Logger;
  llm: FakeLlm;
  search: FakeSearchProvider;
}

export function createTestServices(options: {
  llm: FakeLlm;
  search: FakeSearchProvider;
  dbPath?: string;
  config?: Partial<AppConfig>;
}): TestServices {
  const handle = openDatabase(options.dbPath ?? ":memory:");
  const repos = createRepositories(handle);
  const config = testConfig(options.config);
  const logger = createLogger({ test: true }, { level: "error" });

  const searchExecutor = new SearchExecutor({
    provider: options.search,
    cache: repos.searchCache,
    maxResultsPerQuery: config.maxSearchResults,
    concurrency: config.searchConcurrency,
    cacheTtlSeconds: config.searchCacheTtlSeconds,
    logger,
  });

  const orchestrator = new AgentOrchestrator({
    llm: options.llm,
    searchExecutor,
    memory: new MemoryManager({ repos }),
    repos,
    handle,
    config,
    logger,
  });

  return { orchestrator, repos, handle, config, logger, llm: options.llm, search: options.search };
}

/** Drain a full turn from the orchestrator, collecting every event. */
export async function runTurn(
  services: TestServices,
  input: { message: string; conversationId?: string | null },
): Promise<{
  events: AgentStreamEvent[];
  text: string;
  conversationId: string | null;
  turnEnd: Extract<AgentStreamEvent, { type: "turn_end" }> | null;
  error: Extract<AgentStreamEvent, { type: "error" }> | null;
}> {
  const events: AgentStreamEvent[] = [];
  let conversationId = input.conversationId ?? null;
  for await (const event of services.orchestrator.runTurn({
    userId: TEST_USER_ID,
    conversationId,
    message: input.message,
  })) {
    events.push(event);
    if (event.type === "turn_start") conversationId = event.conversationId;
  }
  return {
    events,
    text: events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join(""),
    conversationId,
    turnEnd: (events.find((e) => e.type === "turn_end") as Extract<AgentStreamEvent, { type: "turn_end" }>) ?? null,
    error: (events.find((e) => e.type === "error") as Extract<AgentStreamEvent, { type: "error" }>) ?? null,
  };
}

export async function seedConversation(
  repos: Repositories,
  input: {
    title: string;
    at: Date;
    messages: Array<{ role: "user" | "assistant"; content: string; at?: Date }>;
    conversationId?: string;
  },
): Promise<string> {
  await repos.users.ensureUser(TEST_USER_ID);
  const conversation = await repos.conversations.create({
    id: input.conversationId ?? newId("conv"),
    userId: TEST_USER_ID,
    title: input.title,
    createdAt: input.at,
  });
  let cursor = input.at.getTime();
  for (const message of input.messages) {
    cursor += 1000; // keep ordering stable
    await repos.messages.create({
      id: newId("msg"),
      conversationId: conversation.id,
      role: message.role,
      content: message.content,
      createdAt: message.at ?? new Date(cursor),
    });
  }
  return conversation.id;
}
