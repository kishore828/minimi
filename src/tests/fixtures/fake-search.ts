/** Deterministic fake search provider with call recording. */
import { AppError } from "@/shared/utils/errors";
import type { SearchInput, SearchResult } from "@/shared/types";
import type { SearchProvider, SearchProviderOptions } from "@/server/search/search-provider";

export type SearchHandler = (input: SearchInput) => SearchResult[] | Error;

export function makeResult(overrides: Partial<SearchResult> & { url: string }): SearchResult {
  const domain = overrides.domain ?? new URL(overrides.url).hostname.replace(/^www\./, "");
  return {
    title: overrides.title ?? "Untitled result",
    url: overrides.url,
    content: overrides.content ?? "Sample excerpt.",
    publishedDate: overrides.publishedDate ?? null,
    retrievedAt: overrides.retrievedAt ?? new Date().toISOString(),
    domain,
    score: overrides.score ?? 0.9,
  };
}

export class FakeSearchProvider implements SearchProvider {
  readonly name = "fake";
  readonly calls: SearchInput[] = [];
  private readonly handler: SearchHandler;

  constructor(handler: SearchHandler) {
    this.handler = handler;
  }

  async search(input: SearchInput, _options?: SearchProviderOptions): Promise<SearchResult[]> {
    this.calls.push(input);
    const result = this.handler(input);
    if (result instanceof Error) throw result;
    return result;
  }

  queries(): string[] {
    return this.calls.map((c) => c.query);
  }
}

export const searchFailure = () => new AppError("SEARCH_ERROR", "Simulated provider outage.", { expose: true });
