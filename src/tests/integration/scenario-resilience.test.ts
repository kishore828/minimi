/**
 * Resilience scenarios:
 *   TEST 5 — no unnecessary search for stable knowledge
 *   TEST 7 — contradictory sources handled with prioritization + uncertainty
 *   TEST 8 — failed search provider degrades gracefully
 *   TEST 9 — follow-up continuity resolves "their" from context
 */
import { describe, expect, it } from "vitest";
import { FakeLlm } from "../fixtures/fake-llm";
import { FakeSearchProvider, makeResult, searchFailure } from "../fixtures/fake-search";
import { createTestServices, runTurn, seedConversation } from "../fixtures/test-services";
import { resolveTemporalReferences } from "@/shared/utils/temporal";

const TZ = "Asia/Kolkata";

function resolveDate(text: string): Date {
  const refs = resolveTemporalReferences(text, new Date(), TZ);
  if (refs.length === 0) throw new Error(`No temporal reference in: ${text}`);
  return new Date(refs[0].startUtc);
}

describe("TEST 5 — no unnecessary search", () => {
  it("answers stable knowledge directly with zero search calls", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "CONVERSATIONAL",
        needsSearch: false,
        requiresHistoryRetrieval: false,
        entities: [],
        historicalKeywords: [],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "stable knowledge",
      }),
      respond: () =>
        "SQL databases are relational with fixed schemas and ACID guarantees; NoSQL databases trade some of that for flexible schemas and horizontal scale. Use SQL when relationships and consistency dominate, NoSQL when scale and schema flexibility dominate.",
      title: () => "SQL vs NoSQL",
    });
    const search = new FakeSearchProvider(() => [makeResult({ url: "https://never-called.example" })]);
    const services = createTestServices({ llm, search });

    const result = await runTurn(services, { message: "What is the difference between SQL and NoSQL?" });

    expect(search.calls).toHaveLength(0);
    expect(result.events.filter((e) => e.type === "sources")).toHaveLength(0);
    expect(result.events.filter((e) => e.type === "search_start")).toHaveLength(0);
    expect(result.turnEnd?.metrics.searchCalls).toBe(0);
    expect(result.turnEnd?.citations).toHaveLength(0);
    expect(result.text).toContain("relational");
    expect(result.error).toBeNull();

    // No claim extraction either — there was nothing to compare.
    expect(llm.callsFor("claim_extract")).toHaveLength(0);
  });
});

describe("TEST 7 — contradictory sources", () => {
  it("prioritizes the official source and marks the conflict INCONCLUSIVE with both citations", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "TEMPORAL_COMPARISON",
        needsSearch: true,
        requiresHistoryRetrieval: true,
        entities: ["Supabase"],
        historicalKeywords: ["Supabase", "pricing"],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "verify old price",
      }),
      query_planner: () => ({
        queries: [{ query: "Supabase Pro pricing", topic: "general", timeRange: null, purpose: "Supabase" }],
      }),
      claim_extract: () => ({
        claims: [
          { subject: "Supabase Pro", topic: "pricing", claim: "Supabase Pro cost $25/month", type: "PRICE", value: "$25/month", asOf: null, messageIndex: 1 },
        ],
      }),
      compare_claims: () => ({
        comparisons: [
          {
            subject: "Supabase Pro",
            claim: "Supabase Pro cost $25/month",
            historicalValue: "$25/month",
            currentValue: "conflicting: $25 (official) vs $20 (blog)",
            classification: "INCONCLUSIVE",
            evidenceCitations: [1, 2],
            explanation: "The official pricing page still lists $25, but a secondary blog claims $20. Preferring the official source, but flagging the conflict.",
          },
        ],
      }),
      respond: () =>
        "Last week we noted Supabase Pro at $25/month. Right now the official pricing page still shows $25/month [1], but a blog claims $20/month [2] — the sources conflict, so I can't say for certain that the price is unchanged.",
      title: () => "Supabase pricing conflict",
    });
    const search = new FakeSearchProvider(() => [
      // Official source first despite the blog's higher provider score.
      makeResult({ url: "https://supabase.com/pricing", title: "Supabase Pricing", content: "Pro plan $25 per month.", score: 0.88 }),
      makeResult({ url: "https://someblog.example/supabase-cheaper", title: "Supabase is cheaper now", content: "Supabase Pro now only $20.", score: 0.99, publishedDate: "2025-11-05" }),
    ]);
    const services = createTestServices({ llm, search });

    const lastWeek = resolveDate("since last week");
    await seedConversation(services.repos, {
      title: "Supabase for Hostly",
      at: lastWeek,
      messages: [
        { role: "user", content: "What does Supabase Pro cost?" },
        { role: "assistant", content: "Supabase Pro costs $25/month." },
      ],
    });

    const result = await runTurn(services, { message: "Is Supabase Pro still $25 a month?" });

    // Both sources entered the evidence ledger, official domain first.
    const citations = result.turnEnd?.citations ?? [];
    expect(citations).toHaveLength(2);
    expect(citations[0].domain).toBe("supabase.com");

    // The conflict was carried through as INCONCLUSIVE with both citations.
    const comparisonEvent = result.events.find((e) => e.type === "comparison") as
      | { comparisons: Array<{ classification: string; evidenceCitations: number[] }> }
      | undefined;
    expect(comparisonEvent?.comparisons[0].classification).toBe("INCONCLUSIVE");
    expect(comparisonEvent?.comparisons[0].evidenceCitations).toEqual([1, 2]);

    // The answer text communicates the uncertainty rather than asserting.
    expect(result.text).toContain("can't say for certain");
    expect(result.error).toBeNull();
  });
});

describe("TEST 8 — failed search provider", () => {
  it("completes the turn honestly when the search API is down", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "CURRENT_INFO",
        needsSearch: true,
        requiresHistoryRetrieval: false,
        entities: ["Neon"],
        historicalKeywords: [],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "current info",
      }),
      query_planner: () => ({
        queries: [{ query: "Neon pricing", topic: "general", timeRange: null, purpose: "Neon" }],
      }),
      respond: () =>
        "I couldn't verify current Neon pricing — the web search is unavailable right now. Based on what we discussed before, Neon Pro was $19/month as of last Tuesday, but please treat that as unverified.",
      title: () => "Neon pricing (unverified)",
    });
    const search = new FakeSearchProvider(() => searchFailure());
    const services = createTestServices({ llm, search });

    const result = await runTurn(services, { message: "What does Neon Pro cost right now?" });

    // The turn did NOT crash into an error event.
    expect(result.error).toBeNull();
    expect(result.turnEnd).not.toBeNull();

    // The failed query was reported as an event (honest UI state).
    const searchEnds = result.events.filter((e) => e.type === "search_end");
    expect(searchEnds).toHaveLength(1);
    expect((searchEnds[0] as { resultCount: number }).resultCount).toBe(0);

    // No fabricated citations.
    expect(result.turnEnd?.citations).toHaveLength(0);

    // The generator was explicitly instructed to say it could not verify.
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).toContain("could NOT verify current information");
  });

  it("marks historical claims NO_LONGER_VERIFIABLE when evidence cannot be fetched", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "TEMPORAL_COMPARISON",
        needsSearch: true,
        requiresHistoryRetrieval: true,
        entities: ["Neon"],
        historicalKeywords: ["Neon"],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "comparison",
      }),
      query_planner: () => ({
        queries: [{ query: "Neon pricing", topic: "general", timeRange: null, purpose: "Neon" }],
      }),
      claim_extract: () => ({
        claims: [
          { subject: "Neon Pro", topic: "pricing", claim: "Neon Pro cost $19/month", type: "PRICE", value: "$19/month", asOf: null, messageIndex: 1 },
        ],
      }),
      respond: () => "I could not re-verify Neon Pro pricing right now — search is down.",
      title: () => "Neon check",
    });
    const search = new FakeSearchProvider(() => searchFailure());
    const services = createTestServices({ llm, search });

    const lastTuesday = resolveDate("since last Tuesday");
    await seedConversation(services.repos, {
      title: "Neon pricing",
      at: lastTuesday,
      messages: [
        { role: "user", content: "Neon Pro price?" },
        { role: "assistant", content: "Neon Pro is $19/month." },
      ],
    });

    const result = await runTurn(services, { message: "Is Neon Pro still $19 since last Tuesday?" });
    const comparisonEvent = result.events.find((e) => e.type === "comparison") as
      | { comparisons: Array<{ classification: string }> }
      | undefined;
    expect(comparisonEvent?.comparisons[0].classification).toBe("NO_LONGER_VERIFIABLE");
    // The un-verifiable comparison is still persisted for the record.
    const research = await services.repos.research.getByMessage(result.turnEnd!.messageId);
    expect(research?.comparisons?.[0].classification).toBe("NO_LONGER_VERIFIABLE");
  });
});

describe("TEST 9 — follow-up continuity", () => {
  it("resolves 'their enterprise plan' from the current conversation context", async () => {
    const llm = new FakeLlm();
    const search = new FakeSearchProvider((input) => [
      makeResult({
        url: "https://www.salesforce.com/products/sales-cloud/pricing/",
        title: "Salesforce Pricing",
        content: `Enterprise Edition — ${input.query.toLowerCase().includes("enterprise") ? "$165/user/month" : "Professional pricing"}.`,
        score: 0.95,
      }),
    ]);
    const services = createTestServices({ llm, search });

    // Turn 1: establish the referent.
    llm.setRoute("planner", () => ({
      category: "CURRENT_INFO",
      needsSearch: true,
      requiresHistoryRetrieval: false,
      entities: ["Salesforce"],
      historicalKeywords: [],
      draftQueries: [],
      clarificationQuestion: null,
      reasoning: "current pricing",
    }));
    llm.setRoute("query_planner", () => ({
      queries: [{ query: "Salesforce Sales Cloud pricing", topic: "general", timeRange: null, purpose: "Salesforce" }],
    }));
    llm.setRoute("respond", () => "Salesforce Sales Cloud Professional is $80/user/month [1].");
    llm.setRoute("title", () => "Salesforce pricing");

    const first = await runTurn(services, { message: "What does Salesforce Sales Cloud cost?" });
    expect(first.turnEnd).not.toBeNull();
    const conversationId = first.conversationId!;

    // Turn 2: "their" must resolve to Salesforce from context.
    llm.setRoute("planner", () => ({
      category: "FOLLOW_UP",
      needsSearch: true,
      requiresHistoryRetrieval: false,
      entities: ["Salesforce"],
      historicalKeywords: [],
      draftQueries: [],
      clarificationQuestion: null,
      reasoning: "refers to Salesforce from context",
    }));
    llm.setRoute("query_planner", () => ({
      queries: [{ query: "Salesforce Sales Cloud Enterprise plan pricing", topic: "general", timeRange: null, purpose: "Salesforce" }],
    }));
    llm.setRoute("respond", () => "The Enterprise Edition runs $165/user/month [1] — roughly double the Professional tier we discussed.");

    const second = await runTurn(services, { message: "What about their enterprise plan?", conversationId });

    // The planner saw the prior exchange (that's how "their" resolves).
    const plannerCalls = llm.callsFor("planner");
    expect(plannerCalls[1].content).toContain("Salesforce Sales Cloud Professional is $80/user/month");

    // The search query was entity-qualified, not a bare "enterprise plan".
    expect(search.calls[search.calls.length - 1].query).toContain("Salesforce");

    // The response generator had the prior exchange as context, and the
    // streamed answer referenced it.
    const respondCall = llm.callsFor("respond")[1];
    expect(respondCall.content).toContain("CONVERSATION SO FAR");
    expect(respondCall.content).toContain("Salesforce Sales Cloud Professional is $80/user/month");
    expect(second.text).toContain("Professional tier we discussed");
    expect(second.turnEnd?.citations).toHaveLength(1);
  });
});
