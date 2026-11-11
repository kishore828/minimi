import { describe, expect, it } from "vitest";
import { rankSources, selectBalancedEvidence } from "@/server/research/source-ranker";
import type { SearchResult } from "@/shared/types";

function result(overrides: Partial<SearchResult> & { url: string }): SearchResult {
  return {
    title: overrides.title ?? "Result",
    content: overrides.content ?? "",
    publishedDate: overrides.publishedDate ?? null,
    retrievedAt: "2025-11-06T10:00:00Z",
    domain: overrides.domain ?? new URL(overrides.url).hostname.replace(/^www\./, ""),
    score: overrides.score ?? 0.5,
    url: overrides.url,
  };
}

const CONTEXT = {
  question: "Has Salesforce pricing changed?",
  entities: ["Salesforce"],
  now: new Date("2025-11-06T10:00:00Z"),
};

describe("source ranker", () => {
  it("boosts official domains for the entity", () => {
    const ranked = rankSources(
      [
        result({ url: "https://random-blog.example/salesforce-pricing", title: "Blog take", score: 0.99 }),
        result({ url: "https://www.salesforce.com/pricing/", title: "Salesforce pricing", score: 0.6 }),
      ],
      CONTEXT,
    );
    expect(ranked[0].result.domain).toBe("salesforce.com");
    expect(ranked[0].reasons).toContain("official domain for entity");
  });

  it("boosts official docs/pricing/changelog paths", () => {
    const ranked = rankSources(
      [result({ url: "https://example.com/some/random/page" }), result({ url: "https://example.com/pricing" })],
      CONTEXT,
    );
    expect(ranked[0].result.url).toBe("https://example.com/pricing");
  });

  it("boosts fresh publication dates", () => {
    const ranked = rankSources(
      [
        result({ url: "https://a.com/old", publishedDate: "2020-01-01" }),
        result({ url: "https://b.com/new", publishedDate: "2025-11-01" }),
      ],
      CONTEXT,
    );
    expect(ranked[0].result.domain).toBe("b.com");
  });

  it("applies a diversity penalty to repeated domains", () => {
    const ranked = rankSources(
      [
        result({ url: "https://same.com/1", score: 0.9 }),
        result({ url: "https://same.com/2", score: 0.9 }),
        result({ url: "https://other.com/1", score: 0.8 }),
      ],
      CONTEXT,
    );
    const sameDomain = ranked.filter((r) => r.result.domain === "same.com");
    expect(sameDomain[1].reasons).toContain("repeat domain (diversity penalty)");
  });

  it("returns an empty list unchanged", () => {
    expect(rankSources([], CONTEXT)).toEqual([]);
  });

  it("selects balanced evidence across multiple entities under a tight cap", () => {
    const ranked = rankSources(
      [
        result({ url: "https://www.salesforce.com/pricing", title: "Salesforce Pricing", content: "Salesforce plans", score: 0.99 }),
        result({ url: "https://help.salesforce.com/s/article", title: "Salesforce Editions", content: "Salesforce features", score: 0.95 }),
        result({ url: "https://www.salesforce.com/news", title: "Salesforce News", content: "Salesforce updates", score: 0.92 }),
        result({ url: "https://www.hubspot.com/pricing", title: "HubSpot Pricing", content: "HubSpot plans", score: 0.8 }),
      ],
      { question: "Compare Salesforce and HubSpot pricing", entities: ["Salesforce", "HubSpot"], now: CONTEXT.now },
    );

    const balanced = selectBalancedEvidence(ranked, ["Salesforce", "HubSpot"], 3);
    expect(balanced).toHaveLength(3);
    expect(balanced.some((r) => r.result.domain.includes("salesforce"))).toBe(true);
    expect(balanced.some((r) => r.result.domain.includes("hubspot"))).toBe(true);
  });
});
