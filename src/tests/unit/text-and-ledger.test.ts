import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractKeywords, keywordOverlap, toFtsQuery, truncate } from "@/shared/utils/text";
import { EvidenceLedger } from "@/server/research/evidence-ledger";
import { SearchCacheRepository } from "@/server/database/repositories/search-cache";
import { openDatabase } from "@/server/database/db";
import type { SearchResult } from "@/shared/types";

describe("text utilities", () => {
  it("extracts informative keywords without stopwords", () => {
    const keywords = extractKeywords("What did we shortlist for the CRM migration on Monday?");
    expect(keywords).toContain("shortlist");
    expect(keywords).toContain("crm");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("did");
  });

  it("builds safe FTS5 prefix queries (no operator injection)", () => {
    expect(toFtsQuery("Neon pricing!")).toBe("neon* AND pricing*");
    expect(toFtsQuery("")).toBe("");
    // Even hostile input only yields alphanumeric tokens.
    expect(toFtsQuery('a" OR 1=1 --')).not.toMatch(/OR/);
  });

  it("computes keyword overlap", () => {
    expect(keywordOverlap("neon postgres pricing", "neon pricing plans")).toBeGreaterThan(0);
    expect(keywordOverlap("neon", "supabase")).toBe(0);
  });

  it("truncates on word boundaries", () => {
    const out = truncate("word ".repeat(50), 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("evidence ledger", () => {
  function result(url: string, overrides: Partial<SearchResult> = {}): SearchResult {
    return {
      title: "Source",
      url,
      content: "excerpt text",
      publishedDate: null,
      retrievedAt: "2025-11-06T10:00:00Z",
      domain: new URL(url).hostname,
      score: 0.9,
      ...overrides,
    };
  }

  it("numbers citations sequentially", () => {
    const ledger = new EvidenceLedger();
    ledger.add(result("https://a.com/1"), "claim a");
    ledger.add(result("https://b.com/2"), "claim b");
    const list = ledger.list();
    expect(list.map((c) => c.citationIndex)).toEqual([1, 2]);
    expect(ledger.size).toBe(2);
  });

  it("dedupes the same URL", () => {
    const ledger = new EvidenceLedger();
    ledger.add(result("https://a.com/1"), "claim a");
    expect(ledger.add(result("https://a.com/1"), "duplicate")).toBeNull();
    expect(ledger.size).toBe(1);
  });

  it("formats a numbered prompt block with dates and unknowns", () => {
    const ledger = new EvidenceLedger();
    ledger.add(result("https://a.com/1", { publishedDate: "2025-11-01T00:00:00Z", title: "With date" }), "c");
    ledger.add(result("https://b.com/2", { publishedDate: null, title: "No date" }), "c");
    const block = ledger.formatForPrompt();
    expect(block).toContain("[1] With date");
    expect(block).toContain("published 2025-11-01");
    expect(block).toContain("publication date unknown");
  });
});

describe("search cache repository (TTL)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches, expires and respects the disabled flag", () => {
    vi.setSystemTime(1_700_000_000_000);
    const handle = openDatabase(":memory:");
    const cache = new SearchCacheRepository(handle);
    const results: SearchResult[] = [
      {
        title: "t",
        url: "https://a.com",
        content: "c",
        publishedDate: null,
        retrievedAt: "2025-11-06T10:00:00Z",
        domain: "a.com",
        score: 0.5,
      },
    ];

    expect(cache.get("key1")).toBeNull();
    cache.set("key1", results, 3600);
    expect(cache.get("key1")).toEqual(results);

    cache.set("key2", results, 0); // TTL <= 0 disables caching
    expect(cache.get("key2")).toBeNull();

    cache.set("key3", results, 1);
    vi.advanceTimersByTime(1500);
    expect(cache.get("key3")).toBeNull();
    handle.sqlite.close();
  });
});
