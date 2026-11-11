/**
 * Environment-driven application configuration.
 *
 * Every tunable limit of the agent is expressed here so orchestration stays
 * bounded and predictable. The app boots without API keys (health endpoint,
 * UI and conversations all work); chat requests fail fast with a clear
 * error until keys are provided.
 */
import { z } from "zod";
import { AppError } from "@/shared/utils/errors";
import { isValidTimeZone } from "@/shared/utils/timezone";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().trim().default(""),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().trim().url().default("https://api.openai.com/v1"),

  TAVILY_API_KEY: z.string().trim().default(""),
  SEARCH_PROVIDER: z.enum(["tavily"]).default("tavily"),

  DATABASE_URL: z.string().trim().default("data/memento.db"),
  APP_TIMEZONE: z.string().trim().default("Asia/Kolkata"),

  // Bounded orchestration limits.
  MAX_SEARCH_QUERIES: z.coerce.number().int().min(1).max(12).default(6),
  MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().min(1).max(5).default(3),
  MAX_RESEARCH_TIME_MS: z.coerce.number().int().min(5000).max(180000).default(45000),
  MAX_TOTAL_TOKENS: z.coerce.number().int().min(2000).max(500000).default(60000),

  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  SEARCH_CACHE_TTL: z.coerce.number().int().min(0).max(86400).default(900),
  SEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface AppConfig {
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  tavilyApiKey: string;
  searchProvider: "tavily";
  databaseUrl: string;
  timezone: string;
  maxSearchQueries: number;
  maxSearchResults: number;
  maxAgentIterations: number;
  maxResearchTimeMs: number;
  maxTotalTokens: number;
  searchTimeoutMs: number;
  searchCacheTtlSeconds: number;
  searchConcurrency: number;
  rateLimitPerMinute: number;
  logLevel: "debug" | "info" | "warn" | "error";
  llmConfigured: boolean;
  searchConfigured: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AppError("CONFIG_ERROR", `Invalid environment configuration: ${issues}`, { expose: true });
  }
  const e = parsed.data;
  if (!isValidTimeZone(e.APP_TIMEZONE)) {
    throw new AppError("CONFIG_ERROR", `APP_TIMEZONE "${e.APP_TIMEZONE}" is not a valid IANA timezone.`, {
      expose: true,
    });
  }
  return Object.freeze({
    openaiApiKey: e.OPENAI_API_KEY,
    openaiModel: e.OPENAI_MODEL,
    openaiBaseUrl: e.OPENAI_BASE_URL,
    tavilyApiKey: e.TAVILY_API_KEY,
    searchProvider: e.SEARCH_PROVIDER,
    databaseUrl: e.DATABASE_URL,
    timezone: e.APP_TIMEZONE,
    maxSearchQueries: e.MAX_SEARCH_QUERIES,
    maxSearchResults: e.MAX_SEARCH_RESULTS,
    maxAgentIterations: e.MAX_AGENT_ITERATIONS,
    maxResearchTimeMs: e.MAX_RESEARCH_TIME_MS,
    maxTotalTokens: e.MAX_TOTAL_TOKENS,
    searchTimeoutMs: e.SEARCH_TIMEOUT_MS,
    searchCacheTtlSeconds: e.SEARCH_CACHE_TTL,
    searchConcurrency: e.SEARCH_CONCURRENCY,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    logLevel: e.LOG_LEVEL,
    llmConfigured: e.OPENAI_API_KEY.length > 0,
    searchConfigured: e.TAVILY_API_KEY.length > 0,
  });
}

let cached: AppConfig | null = null;

/** Process-wide config singleton (re-read on first access after env changes). */
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper: drop the memoized config so env overrides take effect. */
export function resetConfigCache(): void {
  cached = null;
}
