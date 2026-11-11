/**
 * POST /api/search — direct access to the agent's single external tool.
 *
 * Used by the settings dialog ("Test search connection") and as a utility
 * endpoint. Results come from the same normalized pipeline (cache, limits,
 * dedupe) that research turns use.
 */
import { searchApiSchema } from "@/shared/schemas";
import { AppError } from "@/shared/utils/errors";
import { getServices } from "@/server/services";
import { SlidingWindowRateLimiter } from "@/server/http/rate-limit";
import { errorResponse, jsonResponse, parseJsonBody, requestContext } from "@/server/http/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowRateLimiter(30);

export async function POST(request: Request): Promise<Response> {
  const { logger, clientKey } = requestContext(request, getServices().logger);

  const limit = limiter.check(`search:${clientKey}`);
  if (!limit.allowed) {
    return errorResponse(new AppError("RATE_LIMITED", "Too many search requests. Try again shortly."), "n/a");
  }

  try {
    const body = await parseJsonBody<unknown>(request);
    const parsed = searchApiSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid search request.");
    }

    const { toolRegistry, config } = getServices();
    if (!config.searchConfigured) {
      throw new AppError("MISSING_API_KEY", "TAVILY_API_KEY is not configured.", { expose: true });
    }

    const result = (await toolRegistry.execute("web_search", {
      query: parsed.data.query,
      ...(parsed.data.maxResults ? { maxResults: parsed.data.maxResults } : {}),
    }, { signal: request.signal })) as { results: Array<{ title: string; url: string; domain: string; publishedDate: string | null; score: number }>; cached: boolean };

    return jsonResponse({
      provider: "tavily",
      cached: result.cached,
      results: result.results.map((r) => ({
        title: r.title,
        url: r.url,
        domain: r.domain,
        publishedDate: r.publishedDate,
        score: r.score,
      })),
    });
  } catch (error) {
    logger.error("search.failed", {});
    return errorResponse(error, request.headers.get("x-request-id") ?? "n/a");
  }
}
