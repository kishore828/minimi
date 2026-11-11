import { afterEach, describe, expect, it, vi } from "vitest";
import { TavilySearchProvider } from "@/server/search/tavily-provider";
import type { SearchResult } from "@/shared/types";

function okResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tavily provider", () => {
  it("sends the documented request shape with bearer auth", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      okResponse({ results: [{ title: "Neon pricing", url: "https://neon.tech/pricing", content: "Pro $19", score: 0.97, published_date: "2025-11-01" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new TavilySearchProvider({ apiKey: "tvly-test" });
    const results = await provider.search({ query: "neon pricing", maxResults: 5 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.query).toBe("neon pricing");
    expect(body.max_results).toBe(5);
    expect(body.search_depth).toBe("advanced");
    expect(body.include_answer).toBe(false);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Neon pricing",
      url: "https://neon.tech/pricing",
      domain: "neon.tech",
      publishedDate: "2025-11-01T00:00:00.000Z",
      score: 0.97,
    });
  });

  it("maps unknown published_date to null instead of inventing one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ results: [{ title: "t", url: "https://a.com/x", content: "c", score: 0.5, published_date: "" }] })),
    );
    const provider = new TavilySearchProvider({ apiKey: "k" });
    const results = await provider.search({ query: "q" });
    expect(results[0].publishedDate).toBeNull();
  });

  it("normalizes scores and domains from the provider payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          results: [
            { title: "a", url: "https://www.Example.com/one", content: "x", score: 1.7 },
            { title: "b", url: "https://example.com/two", content: "y" },
          ],
        }),
      ),
    );
    const provider = new TavilySearchProvider({ apiKey: "k" });
    const results: SearchResult[] = await provider.search({ query: "q" });
    expect(results[0].score).toBe(1); // clamped
    expect(results[0].domain).toBe("example.com");
    expect(results[1].score).toBe(0.5); // missing score defaults
  });

  it("retries 5xx with backoff and succeeds on the second attempt", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("boom", { status: 503 });
        return okResponse({ results: [{ title: "ok", url: "https://ok.com", content: "c", score: 0.5 }] });
      }),
    );
    const provider = new TavilySearchProvider({ apiKey: "k" });
    const results = await provider.search({ query: "q" });
    expect(calls).toBe(2);
    expect(results).toHaveLength(1);
  });

  it("fails fast on 4xx without retry", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TavilySearchProvider({ apiKey: "k", maxRetries: 2 });
    await expect(provider.search({ query: "q" })).rejects.toMatchObject({ code: "SEARCH_ERROR" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces a clear error for rejected API keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const provider = new TavilySearchProvider({ apiKey: "bad" });
    await expect(provider.search({ query: "q" })).rejects.toMatchObject({ code: "MISSING_API_KEY" });
  });

  it("passes time_range only for news topics", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => okResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TavilySearchProvider({ apiKey: "k" });

    await provider.search({ query: "q", topic: "news", timeRange: "week" });
    const [, newsInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const newsBody = JSON.parse(newsInit.body as string) as Record<string, unknown>;
    expect(newsBody.time_range).toBe("week");

    await provider.search({ query: "q", topic: "general", timeRange: "week" });
    const [, generalInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const generalBody = JSON.parse(generalInit.body as string) as Record<string, unknown>;
    expect(generalBody.time_range).toBeUndefined();
  });
});
