/**
 * TEST 4 — multi-entity research: five CRM tools researched independently
 * with per-entity queries, bounded by configuration.
 */
import { describe, expect, it } from "vitest";
import { FakeLlm } from "../fixtures/fake-llm";
import { FakeSearchProvider, makeResult } from "../fixtures/fake-search";
import { createTestServices, runTurn, seedConversation } from "../fixtures/test-services";
import { resolveTemporalReferences } from "@/shared/utils/temporal";

const TZ = "Asia/Kolkata";
const CRMS = ["Salesforce", "HubSpot", "Zoho CRM", "Pipedrive", "Freshsales"];

function resolveDate(text: string): Date {
  const refs = resolveTemporalReferences(text, new Date(), TZ);
  if (refs.length === 0) throw new Error(`No temporal reference in: ${text}`);
  return new Date(refs[0].startUtc);
}

function entityQueryPlanner(options: { messages: Array<{ role: string; content: string }> }) {
  const match = options.messages[0].content.match(/Entities to cover:\s*(.+)/);
  const entities = match ? match[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    queries: entities.map((entity) => ({
      query: `${entity} pricing update ${new Date().getFullYear()}`,
      topic: "general" as const,
      timeRange: null,
      purpose: entity,
    })),
  };
}

function multiEntitySetup(options: { maxSearchQueries?: number } = {}) {
  const llm = new FakeLlm({
    planner: () => ({
      category: "MULTI_ENTITY_RESEARCH",
      needsSearch: true,
      requiresHistoryRetrieval: true,
      entities: CRMS,
      historicalKeywords: ["shortlist", "CRM"],
      draftQueries: [],
      clarificationQuestion: null,
      reasoning: "five entities, parallel research",
    }),
    query_planner: (opts) => entityQueryPlanner(opts),
    claim_extract: () => ({
      claims: CRMS.map((crm) => ({
        subject: crm,
        topic: "pricing",
        claim: `${crm} was on the shortlist`,
        type: "PRICE" as const,
        value: null,
        asOf: null,
        messageIndex: 1,
      })),
    }),
    compare_claims: () => ({
      comparisons: CRMS.map((crm, index) => ({
        subject: crm,
        claim: `${crm} was on the shortlist`,
        historicalValue: null,
        currentValue: `${crm} Professional is available`,
        classification: index === 0 ? "NEW_INFORMATION" : "UNCHANGED",
        evidenceCitations: [index + 1],
        explanation: "Official page reviewed.",
      })),
    }),
    respond: () =>
      `I checked all five CRMs from Monday's shortlist. ${CRMS[0]} announced new AI features [1]; the other four look unchanged [2][3][4][5].`,
    title: () => "CRM shortlist update",
  });

  const search = new FakeSearchProvider((input) => {
    const entity = CRMS.find((crm) => input.query.toLowerCase().includes(crm.toLowerCase().split(" ")[0]));
    return [
      makeResult({
        url: `https://www.${entity?.toLowerCase().replace(/[^a-z]/g, "") ?? "unknown"}.com/pricing`,
        title: `${entity ?? "CRM"} pricing`,
        content: `${entity} plans and pricing page.`,
        score: 0.9,
      }),
    ];
  });

  const services = createTestServices({
    llm,
    search,
    ...(options.maxSearchQueries !== undefined ? { config: { maxSearchQueries: options.maxSearchQueries } } : {}),
  });
  return { llm, search, services };
}

describe("TEST 4 — multi-entity comparison", () => {
  it("researches each CRM independently and compares all five", async () => {
    const { llm, search, services } = multiEntitySetup();

    const monday = resolveDate("Has any of them changed since Monday?");
    await seedConversation(services.repos, {
      title: "CRM shortlist for 20-person sales team",
      at: monday,
      messages: [
        { role: "user", content: "Shortlist five CRM tools for our 20-person sales team." },
        { role: "assistant", content: `Shortlist: ${CRMS.join(", ")}.` },
      ],
    });

    const result = await runTurn(services, {
      message: "Has any of them changed pricing or shipped something big since Monday?",
    });

    // Five DISTINCT queries — one per product, never one blended query.
    expect(search.calls).toHaveLength(5);
    const distinctQueries = new Set(search.calls.map((c) => c.query));
    expect(distinctQueries.size).toBe(5);
    for (const crm of CRMS) {
      expect(search.calls.some((c) => c.query.toLowerCase().includes(crm.toLowerCase().split(" ")[0]))).toBe(true);
    }

    // Structured comparison for all five entities with citations.
    const comparisonEvent = result.events.find((e) => e.type === "comparison") as
      | { comparisons: Array<{ subject: string; classification: string; evidenceCitations: number[] }> }
      | undefined;
    expect(comparisonEvent).toBeDefined();
    expect(comparisonEvent!.comparisons).toHaveLength(5);
    for (const comparison of comparisonEvent!.comparisons) {
      expect(comparison.evidenceCitations.length).toBeGreaterThan(0);
    }

    // All five sources are real, distinct citations.
    expect(result.turnEnd?.citations).toHaveLength(5);
    const urls = new Set(result.turnEnd!.citations.map((c) => c.url));
    expect(urls.size).toBe(5);

    // The comparison table data persisted with the message.
    const research = await services.repos.research.getByMessage(result.turnEnd!.messageId);
    expect(research?.comparisons).toHaveLength(5);
  });

  it("never exceeds the configured query cap even with more entities", async () => {
    const { search, services } = multiEntitySetup({ maxSearchQueries: 3 });
    await runTurn(services, { message: "Has any of the five CRMs changed pricing since Monday?" });
    expect(search.calls.length).toBeLessThanOrEqual(3);
  });
});
