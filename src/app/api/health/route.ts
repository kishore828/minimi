/**
 * /api/health
 *   GET  — liveness + configuration snapshot (no secrets).
 *   POST — connectivity tests: { target: "llm" | "search" } performs a real
 *          ping against the configured providers.
 */
import { healthTestSchema } from "@/shared/schemas";
import { AppError } from "@/shared/utils/errors";
import { APP_VERSION, getServices } from "@/server/services";
import { errorResponse, jsonResponse, parseJsonBody, requestContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOTED_AT = Date.now();

export async function GET(): Promise<Response> {
  const { config, toolRegistry } = getServices();

  let dbOk = true;
  try {
    getServices().handle.sqlite.prepare("SELECT 1").run();
  } catch {
    dbOk = false;
  }

  return jsonResponse({
    status: dbOk ? "ok" : "degraded",
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
    database: dbOk ? "ok" : "error",
    llm: { configured: config.llmConfigured, model: config.openaiModel },
    search: { configured: config.searchConfigured, provider: config.searchProvider },
    timezone: config.timezone,
    limits: {
      maxSearchQueries: config.maxSearchQueries,
      maxSearchResults: config.maxSearchResults,
      maxAgentIterations: config.maxAgentIterations,
      maxResearchTimeMs: config.maxResearchTimeMs,
      searchCacheTtlSeconds: config.searchCacheTtlSeconds,
      rateLimitPerMinute: config.rateLimitPerMinute,
    },
    tools: toolRegistry.list(),
  });
}

export async function POST(request: Request): Promise<Response> {
  const { logger } = requestContext(request, getServices().logger);
  try {
    const body = await parseJsonBody<unknown>(request);
    const parsed = healthTestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Body must be { target: 'llm' | 'search' }.");
    }

    const { llm, toolRegistry, config } = getServices();

    if (parsed.data.target === "llm") {
      if (!config.llmConfigured) {
        return jsonResponse({ target: "llm", ok: false, detail: "OPENAI_API_KEY is not configured." });
      }
      const ok = await llm.ping();
      return jsonResponse({
        target: "llm",
        ok,
        detail: ok ? `Model ${config.openaiModel} responded.` : "Model did not respond.",
      });
    }

    if (!config.searchConfigured) {
      return jsonResponse({ target: "search", ok: false, detail: "TAVILY_API_KEY is not configured." });
    }
    const result = (await toolRegistry.execute("web_search", { query: "OpenAI news", maxResults: 1 })) as {
      results: unknown[];
    };
    return jsonResponse({
      target: "search",
      ok: result.results.length > 0,
      detail: result.results.length > 0 ? "Tavily returned results." : "Tavily responded with no results.",
    });
  } catch (error) {
    logger.error("health.test_failed", {});
    const message = error instanceof AppError && error.expose ? error.message : "Connectivity test failed.";
    return jsonResponse({ ok: false, detail: message }, { status: 200 });
  }
}
