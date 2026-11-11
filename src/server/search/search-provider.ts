/**
 * Search provider abstraction. The agent knows nothing about Tavily — it
 * depends on this interface only, so adding another provider (Brave, Bing,
 * Serper, ...) is a single class plus a registration line.
 */
import type { SearchInput, SearchResult } from "@/shared/types";

export interface SearchProviderOptions {
  signal?: AbortSignal;
  /** Hard cap on results per query, enforced by the caller's config. */
  maxResults?: number;
}

export interface SearchProvider {
  readonly name: string;
  search(input: SearchInput, options?: SearchProviderOptions): Promise<SearchResult[]>;
}
