/**
 * Production service wiring (composition root).
 *
 * Everything is constructed once and injected — API routes stay thin and
 * tests build their own graphs from the same components.
 */
import { loadConfig, type AppConfig } from "./config";
import { createLogger, type Logger } from "@/shared/utils/logger";
import { getDatabase, type DatabaseHandle } from "./database/db";
import { createRepositories, type Repositories } from "./database/repositories";
import { MemoryManager } from "./memory/memory-manager";
import { OpenAiLlmClient, UnconfiguredLlmClient, type LlmClient } from "./llm/client";
import { TavilySearchProvider } from "./search/tavily-provider";
import { SearchExecutor } from "./search/search-executor";
import { AgentOrchestrator } from "./agent/orchestrator";
import { createDefaultToolRegistry, type ToolRegistry } from "./agent/tool-registry";

export const DEFAULT_USER_ID = "local-user";
export const APP_VERSION = "1.0.0";

export interface Services {
  config: AppConfig;
  logger: Logger;
  handle: DatabaseHandle;
  repos: Repositories;
  llm: LlmClient;
  toolRegistry: ToolRegistry;
  orchestrator: AgentOrchestrator;
}

export function createServices(options?: {
  config?: AppConfig;
  handle?: DatabaseHandle;
  llm?: LlmClient;
}): Services {
  const config = options?.config ?? loadConfig();
  const logger = createLogger({ service: "memento", version: APP_VERSION }, { level: config.logLevel });
  const handle = options?.handle ?? getDatabase();
  const repos = createRepositories(handle);

  // The app must boot without API keys (health, conversations and the UI all
  // work); chat requests fail fast with a clear error instead.
  const llm: LlmClient =
    options?.llm ??
    (config.llmConfigured
      ? new OpenAiLlmClient({
          apiKey: config.openaiApiKey,
          model: config.openaiModel,
          baseUrl: config.openaiBaseUrl,
        })
      : new UnconfiguredLlmClient());

  const searchExecutor = new SearchExecutor({
    provider: new TavilySearchProvider({ apiKey: config.tavilyApiKey, timeoutMs: config.searchTimeoutMs }),
    cache: repos.searchCache,
    maxResultsPerQuery: config.maxSearchResults,
    concurrency: config.searchConcurrency,
    cacheTtlSeconds: config.searchCacheTtlSeconds,
    logger: logger.child({ component: "search" }),
  });

  const toolRegistry = createDefaultToolRegistry({
    searchExecutor,
    maxResults: config.maxSearchResults,
  });

  const memory = new MemoryManager({ repos });

  const orchestrator = new AgentOrchestrator({
    llm,
    searchExecutor,
    memory,
    repos,
    handle,
    config,
    logger: logger.child({ component: "orchestrator" }),
  });

  return { config, logger, handle, repos, llm, toolRegistry, orchestrator };
}

let services: Services | null = null;

export function getServices(): Services {
  if (!services) {
    services = createServices();
  }
  return services;
}

/** Test helper. */
export function resetServices(): void {
  services = null;
}
