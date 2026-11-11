/**
 * Tavily Search provider.
 *
 * Responsibilities: request shape, auth, timeout, retry with exponential
 * backoff (429/5xx/network only — other 4xx fails fast), and response
 * mapping. Normalization (domains, dates, dedupe) lives in
 * source-normalizer so it is shared by every provider.
 */
import { AppError } from "@/shared/utils/errors";
import type { SearchInput, SearchResult } from "@/shared/types";
import { normalizeDomain, parsePublishedDate, clampScore } from "./source-normalizer";
import type { SearchProvider, SearchProviderOptions } from "./search-provider";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string | null;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: { apiKey: string; timeoutMs?: number; maxRetries?: number }) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async search(input: SearchInput, options: SearchProviderOptions = {}): Promise<SearchResult[]> {
    const maxResults = Math.min(input.maxResults ?? 5, 10);
    const body: Record<string, unknown> = {
      query: input.query,
      max_results: maxResults,
      topic: input.topic ?? "general",
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
    };
    // Tavily only honors time_range on news topics; for general searches we
    // keep freshness signals for ranking instead of dropping older results.
    if (input.timeRange && input.topic === "news") {
      body.time_range = input.timeRange;
    }

    let lastError: unknown = null;
    let fatal: AppError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await delay(backoffMs(attempt));
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const onOuterAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onOuterAbort, { once: true });
      try {
        const response = await fetch(TAVILY_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.status === 429 || response.status >= 500) {
          lastError = new AppError("SEARCH_ERROR", `Tavily responded with ${response.status}.`);
          continue; // transient → retry
        }
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          if (response.status === 401 || response.status === 403) {
            fatal = new AppError("MISSING_API_KEY", "The Tavily API key was rejected. Check TAVILY_API_KEY.", { expose: true });
          } else {
            fatal = new AppError("SEARCH_ERROR", `Tavily responded with ${response.status}: ${text.slice(0, 200)}`);
          }
          break; // fatal → no retry
        }

        const data = (await response.json()) as TavilyResponse;
        return this.mapResults(data);
      } catch (error) {
        if (error instanceof AppError) throw error;
        lastError = error;
        if (options.signal?.aborted) {
          throw new AppError("ABORTED", "Search was cancelled.", { expose: true, cause: error });
        }
        // Network error → retry.
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onOuterAbort);
      }
    }

    if (fatal) throw fatal;
    throw new AppError("SEARCH_ERROR", "Web search is temporarily unavailable.", { expose: true, cause: lastError });
  }

  private mapResults(data: TavilyResponse): SearchResult[] {
    const retrievedAt = new Date().toISOString();
    return (data.results ?? [])
      .filter((r): r is TavilyResult & { url: string } => typeof r.url === "string" && r.url.length > 0)
      .map((r) => ({
        title: r.title?.trim() || r.url,
        url: r.url,
        content: r.content?.trim() ?? "",
        publishedDate: parsePublishedDate(r.published_date ?? null),
        retrievedAt,
        domain: normalizeDomain(r.url),
        score: clampScore(r.score ?? 0.5),
      }));
  }
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
