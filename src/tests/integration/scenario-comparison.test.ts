/**
 * Temporal comparison scenarios: TEST 2 (is the earlier answer still
 * correct?) and TEST 3 (did pricing change since last Tuesday?).
 */
import { describe, expect, it } from "vitest";
import { FakeLlm } from "../fixtures/fake-llm";
import { FakeSearchProvider, makeResult } from "../fixtures/fake-search";
import { createTestServices, runTurn, seedConversation } from "../fixtures/test-services";
import { resolveTemporalReferences } from "@/shared/utils/temporal";

const TZ = "Asia/Kolkata";

function resolveDate(text: string): Date {
  const refs = resolveTemporalReferences(text, new Date(), TZ);
  if (refs.length === 0) throw new Error(`No temporal reference in: ${text}`);
  return new Date(refs[0].startUtc);
}

/** Parse the "Entities to cover: a, b" line from query-planner prompts. */
function entitiesFromPrompt(content: string): string[] {
  const match = content.match(/Entities to cover:\s*(.+)/);
  return match ? match[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

const TEMPORAL_PLANNER = () => ({
  category: "TEMPORAL_COMPARISON",
  needsSearch: true,
  requiresHistoryRetrieval: true,
  entities: [],
  historicalKeywords: ["Neon", "pricing"],
  draftQueries: [],
  clarificationQuestion: null,
  reasoning: "compares past discussion to now",
});

const ENTITY_QUERY_PLANNER = (options: { messages: Array<{ role: string; content: string }> }) => {
  const entities = entitiesFromPrompt(options.messages[0].content);
  const queries = (entities.length > 0 ? entities : ["Neon"]).map((entity) => ({
    query: `${entity} pricing change ${new Date().getFullYear()}`,
    topic: "general" as const,
    timeRange: null,
    purpose: entity,
  }));
  return { queries };
};

describe("TEST 2 — historical accuracy re-check", () => {
  it("retrieves the old answer, re-verifies time-sensitive claims and compares", async () => {
    const llm = new FakeLlm({
      planner: TEMPORAL_PLANNER,
      query_planner: (options) => ENTITY_QUERY_PLANNER(options),
      claim_extract: () => ({
        claims: [
          {
            subject: "Neon Pro plan",
            topic: "pricing",
            claim: "Neon Pro cost $19/month",
            type: "PRICE",
            value: "$19/month",
            asOf: null,
            messageIndex: 1,
          },
        ],
      }),
      compare_claims: () => ({
        comparisons: [
          {
            subject: "Neon Pro plan",
            claim: "Neon Pro cost $19/month",
            historicalValue: "$19/month",
            currentValue: "$25/month",
            classification: "PRICE_INCREASED",
            evidenceCitations: [1],
            explanation: "The official pricing page now lists $25/month for the Pro plan.",
          },
        ],
      }),
      respond: () =>
        "When we looked at this on November 3, Neon Pro was $19/month. Checking the current pricing page: the Pro plan is now $25/month — a price increase [1]. Nothing else on the plan appears to have changed.",
      title: () => "Neon pricing re-check",
    });
    const search = new FakeSearchProvider(() => [
      makeResult({
        url: "https://neon.tech/pricing",
        title: "Neon Pricing",
        content: "Pro plan — $25 per month, billed monthly.",
        publishedDate: "2025-11-05",
        score: 0.98,
      }),
    ]);
    const services = createTestServices({ llm, search });

    const nov3 = resolveDate("What did we discuss on November 3?");
    await seedConversation(services.repos, {
      title: "Neon for Hostly",
      at: nov3,
      messages: [
        { role: "user", content: "What does Neon's Pro plan cost? We need Postgres for Hostly." },
        { role: "assistant", content: "Neon Pro costs $19/month with 10 GB of storage — a solid fit for the initial Hostly deployment." },
      ],
    });

    const result = await runTurn(services, { message: "What did you tell me on November 3? Is it still correct?" });

    // Research actually happened.
    expect(search.calls.length).toBeGreaterThanOrEqual(1);
    expect(search.calls[0].query).toContain("Neon");

    // Sources were streamed before the answer.
    const sourcesEvent = result.events.find((e) => e.type === "sources");
    expect(sourcesEvent).toBeDefined();
    expect((sourcesEvent as { sources: Array<{ url: string }> }).sources[0].url).toBe("https://neon.tech/pricing");

    // The comparison was classified with a valid citation.
    const comparisonEvent = result.events.find((e) => e.type === "comparison") as
      | { comparisons: Array<{ classification: string; evidenceCitations: number[] }> }
      | undefined;
    expect(comparisonEvent).toBeDefined();
    expect(comparisonEvent!.comparisons[0].classification).toBe("PRICE_INCREASED");
    expect(comparisonEvent!.comparisons[0].evidenceCitations).toEqual([1]);

    // Citations in the final answer point at real evidence.
    expect(result.turnEnd?.citations).toHaveLength(1);
    expect(result.turnEnd?.citations[0].url).toBe("https://neon.tech/pricing");
    expect(result.text).toContain("[1]");

    // The generator saw claims + evidence + computed comparisons.
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).toContain("CLAIMS FROM THE EARLIER DISCUSSION");
    expect(respondCall.content).toContain("$19/month");
    expect(respondCall.content).toContain("CURRENT EVIDENCE");
    expect(respondCall.content).toContain("COMPARISON RESULTS");

    // Everything persisted atomically: research + evidence + comparisons.
    const research = await services.repos.research.getByMessage(result.turnEnd!.messageId);
    expect(research).not.toBeNull();
    expect(research!.evidence).toHaveLength(1);
    expect(research!.comparisons?.[0].classification).toBe("PRICE_INCREASED");
    expect(research!.searchCount).toBeGreaterThanOrEqual(1);
  });
});

describe("TEST 3 — pricing change since last Tuesday", () => {
  it("compares per-provider pricing against the historical discussion", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "TEMPORAL_COMPARISON",
        needsSearch: true,
        requiresHistoryRetrieval: true,
        entities: [],
        historicalKeywords: ["Neon", "Supabase", "hosting"],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "pricing comparison",
      }),
      query_planner: (options) => ENTITY_QUERY_PLANNER(options),
      claim_extract: () => ({
        claims: [
          { subject: "Neon Pro", topic: "pricing", claim: "Neon Pro cost $19/month", type: "PRICE", value: "$19/month", asOf: null, messageIndex: 1 },
          { subject: "Supabase Pro", topic: "pricing", claim: "Supabase Pro cost $25/month", type: "PRICE", value: "$25/month", asOf: null, messageIndex: 1 },
        ],
      }),
      compare_claims: () => ({
        comparisons: [
          {
            subject: "Neon Pro",
            claim: "Neon Pro cost $19/month",
            historicalValue: "$19/month",
            currentValue: "$25/month",
            classification: "PRICE_INCREASED",
            evidenceCitations: [1],
            explanation: "Official pricing page now lists $25/month.",
          },
          {
            subject: "Supabase Pro",
            claim: "Supabase Pro cost $25/month",
            historicalValue: "$25/month",
            currentValue: "$25/month",
            classification: "UNCHANGED",
            evidenceCitations: [2],
            explanation: "Official pricing page confirms $25/month.",
          },
        ],
      }),
      respond: () => "Since last Tuesday: Neon Pro went from $19 to $25/month [1]. Supabase Pro is still $25/month [2].",
      title: () => "Postgres hosting pricing check",
    });
    const search = new FakeSearchProvider((input) => {
      if (input.query.toLowerCase().includes("neon")) {
        return [makeResult({ url: "https://neon.tech/pricing", title: "Neon Pricing", content: "Pro $25/month", score: 0.97, publishedDate: "2025-11-04" })];
      }
      return [makeResult({ url: "https://supabase.com/pricing", title: "Supabase Pricing", content: "Pro $25/month", score: 0.96, publishedDate: "2025-11-04" })];
    });
    const services = createTestServices({ llm, search });

    const lastTuesday = resolveDate("Has any pricing changed since last Tuesday?");
    await seedConversation(services.repos, {
      title: "Postgres hosting for Hostly",
      at: lastTuesday,
      messages: [
        { role: "user", content: "Compare Neon and Supabase Postgres pricing for Hostly." },
        {
          role: "assistant",
          content: "For the initial Hostly deployment: Neon Pro is $19/month and Supabase Pro is $25/month. Both have free tiers to start.",
        },
      ],
    });

    const result = await runTurn(services, { message: "Has any pricing changed since last Tuesday?" });

    // One entity-specific query per provider discussed.
    const queries = search.calls.map((c) => c.query);
    expect(queries.some((q) => /neon/i.test(q))).toBe(true);
    expect(queries.some((q) => /supabase/i.test(q))).toBe(true);

    const comparisonEvent = result.events.find((e) => e.type === "comparison") as
      | { comparisons: Array<{ subject: string; classification: string }> }
      | undefined;
    expect(comparisonEvent).toBeDefined();
    const bySubject = new Map(comparisonEvent!.comparisons.map((c) => [c.subject, c.classification]));
    expect(bySubject.get("Neon Pro")).toBe("PRICE_INCREASED");
    expect(bySubject.get("Supabase Pro")).toBe("UNCHANGED");

    expect(result.turnEnd?.citations.length).toBeGreaterThanOrEqual(2);
    expect(result.error).toBeNull();
  });

  it("ignores 'today' as a present anchor when checking a missing historical date", async () => {
    const llm = new FakeLlm({
      planner: TEMPORAL_PLANNER,
      query_planner: ENTITY_QUERY_PLANNER,
      respond: () => "I do not have any record of a conversation from that date.",
    });
    const search = new FakeSearchProvider(() => []);
    const services = createTestServices({ llm, search });

    await seedConversation(services.repos, {
      title: "Unrelated chat from today",
      at: new Date(),
      messages: [
        { role: "user", content: "Tell me about Redis caching today." },
        { role: "assistant", content: "Redis supports in-memory caching." },
      ],
    });

    const nowParts = new Date().toLocaleDateString("en-CA", { timeZone: TZ }).split("-");
    const missingDate = nowParts[1] === "11" && nowParts[2] === "03" ? "4 November" : "3 November";
    const result = await runTurn(services, {
      message: `What did I ask you on ${missingDate}? Is your answer still correct today?`,
    });

    expect(result.error).toBeNull();
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).toContain("NO record");
    expect(respondCall.content).not.toContain("Unrelated chat from today");
  });

  it("falls back to earlier messages in the current conversation and keeps FTS matches without summaries", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "TEMPORAL_COMPARISON",
        needsSearch: true,
        requiresHistoryRetrieval: true,
        entities: ["Neon"],
        historicalKeywords: ["Neon", "Drizzle"],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "compare earlier baseline",
      }),
      query_planner: ENTITY_QUERY_PLANNER,
      claim_extract: () => ({ claims: [] }),
      respond: () => "Comparing against earlier in our conversation and prior notes [1].",
    });
    const search = new FakeSearchProvider(() => [
      makeResult({ url: "https://neon.tech/pricing", title: "Neon Pricing", content: "Pro $25/mo", score: 0.95 }),
    ]);
    const services = createTestServices({ llm, search });

    // Seed an older cross-session conversation with the default title and NO summary (FTS only).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await seedConversation(services.repos, {
      title: "New conversation",
      at: thirtyDaysAgo,
      messages: [
        { role: "user", content: "Remember our Neon + Drizzle pooling notes?" },
        { role: "assistant", content: "Neon Launch had connection pooling enabled with Drizzle ORM." },
      ],
    });

    // Seed an active conversation with baseline messages in the same thread.
    const activeConv = await seedConversation(services.repos, {
      title: "Active Postgres thread",
      at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      messages: [
        { role: "user", content: "Earlier we noted Neon Pro was $19/month for Hostly." },
        { role: "assistant", content: "Yes, Neon Pro was $19/month with Drizzle compatibility." },
      ],
    });

    const result = await runTurn(services, {
      conversationId: activeConv,
      message: "Earlier in this chat we discussed Neon and Drizzle. Has anything changed?",
    });

    expect(result.error).toBeNull();
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).not.toContain("NO record");
    expect(respondCall.content).toContain("HISTORICAL CONVERSATION");
    expect(respondCall.content).toContain("Drizzle pooling notes");
  });

  it("falls back to earlier messages in the current conversation when no cross-session history exists", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "TEMPORAL_COMPARISON",
        needsSearch: true,
        requiresHistoryRetrieval: true,
        entities: ["Neon"],
        historicalKeywords: ["Neon", "pricing"],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "same-thread baseline comparison",
      }),
      query_planner: ENTITY_QUERY_PLANNER,
      claim_extract: () => ({ claims: [] }),
      respond: () => "Compared against earlier in this chat: Neon Pro moved to $25/mo [1].",
    });
    const search = new FakeSearchProvider(() => [
      makeResult({ url: "https://neon.tech/pricing", title: "Neon Pricing", content: "Pro $25/mo", score: 0.95 }),
    ]);
    const services = createTestServices({ llm, search });

    const activeConv = await seedConversation(services.repos, {
      title: "Postgres hosting chat",
      at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      messages: [
        { role: "user", content: "What does Neon Pro cost right now?" },
        { role: "assistant", content: "Neon Pro is listed at $19/month." },
      ],
    });

    const result = await runTurn(services, {
      conversationId: activeConv,
      message: "Earlier in this chat we looked at Neon pricing. Has anything changed?",
    });

    expect(result.error).toBeNull();
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).not.toContain("NO record");
    expect(respondCall.content).toContain("Neon Pro is listed at $19/month");
  });
});
