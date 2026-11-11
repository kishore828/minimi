import { eq, lt } from "drizzle-orm";
import { searchCache } from "../schema";
import type { DatabaseHandle } from "../db";
import type { SearchResult } from "@/shared/types";

/**
 * SQLite-backed search cache with TTL. Survives restarts, keeps the agent
 * polite when users re-ask similar questions, and doubles as the provider
 * rate-limit shield.
 */
export class SearchCacheRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  get(cacheKey: string): SearchResult[] | null {
    const row = this.handle.db
      .select()
      .from(searchCache)
      .where(eq(searchCache.cacheKey, cacheKey))
      .get();
    if (!row) return null;
    if (row.expiresAt < Date.now()) {
      this.handle.db.delete(searchCache).where(eq(searchCache.cacheKey, cacheKey)).run();
      return null;
    }
    try {
      return JSON.parse(row.resultsJson) as SearchResult[];
    } catch {
      return null;
    }
  }

  set(cacheKey: string, results: SearchResult[], ttlSeconds: number): void {
    if (ttlSeconds <= 0) return; // caching disabled
    const now = Date.now();
    this.handle.db
      .insert(searchCache)
      .values({
        cacheKey,
        resultsJson: JSON.stringify(results),
        createdAt: now,
        expiresAt: now + ttlSeconds * 1000,
      })
      .onConflictDoUpdate({
        target: searchCache.cacheKey,
        set: { resultsJson: JSON.stringify(results), createdAt: now, expiresAt: now + ttlSeconds * 1000 },
      })
      .run();
  }

  purgeExpired(): number {
    const result = this.handle.db.delete(searchCache).where(lt(searchCache.expiresAt, Date.now())).run();
    return result.changes;
  }

  clear(): void {
    this.handle.sqlite.prepare("DELETE FROM search_cache").run();
  }
}
