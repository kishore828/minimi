import { describe, expect, it } from "vitest";
import {
  canonicalUrlKey,
  clampScore,
  dedupeByUrn,
  normalizeDomain,
  parsePublishedDate,
} from "@/server/search/source-normalizer";
import type { SearchResult } from "@/shared/types";

function result(url: string, score = 0.8, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: url,
    url,
    content: "excerpt",
    publishedDate: null,
    retrievedAt: "2025-11-06T10:00:00Z",
    domain: normalizeDomain(url),
    score,
    ...overrides,
  };
}

describe("source normalizer", () => {
  it("normalizes domains (www stripped, lowercase)", () => {
    expect(normalizeDomain("https://www.Neon.tech/pricing")).toBe("neon.tech");
    expect(normalizeDomain("http://docs.example.com")).toBe("docs.example.com");
  });

  it("parses publication dates leniently but never invents them", () => {
    expect(parsePublishedDate("2025-11-01")).toBe("2025-11-01T00:00:00.000Z");
    expect(parsePublishedDate("Mon, 03 Nov 2025 10:00:00 GMT")).toBe("2025-11-03T10:00:00.000Z");
    expect(parsePublishedDate("not a date")).toBeNull();
    expect(parsePublishedDate("")).toBeNull();
    expect(parsePublishedDate(null)).toBeNull();
    expect(parsePublishedDate("2025")).toBeNull(); // bare year is too coarse
  });

  it("clamps provider scores into 0..1", () => {
    expect(clampScore(1.4)).toBe(1);
    expect(clampScore(-0.2)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0.5);
  });

  it("dedupes by canonical URL keeping the best score", () => {
    const input = [
      result("https://neon.tech/pricing", 0.7),
      result("https://www.neon.tech/pricing", 0.95), // same canonical key
      result("https://neon.tech/pricing?utm_source=x", 0.8), // tracking param stripped
      result("https://supabase.com/pricing", 0.6),
    ];
    const deduped = dedupeByUrn(input);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.domain === "neon.tech")?.score).toBe(0.95);
  });

  it("canonical keys ignore fragments and case", () => {
    expect(canonicalUrlKey("https://a.com/x#section")).toBe(canonicalUrlKey("https://www.a.com/x"));
  });
});
