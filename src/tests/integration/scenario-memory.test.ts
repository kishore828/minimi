/**
 * Memory scenarios: historical retrieval without web search (TEST 1) and
 * honest handling of missing history (TEST 6).
 */
import { describe, expect, it } from "vitest";
import { FakeLlm } from "../fixtures/fake-llm";
import { FakeSearchProvider, makeResult } from "../fixtures/fake-search";
import { createTestServices, runTurn, seedConversation, TEST_USER_ID } from "../fixtures/test-services";
import { resolveTemporalReferences } from "@/shared/utils/temporal";

const TZ = "Asia/Kolkata";

/** Resolve a temporal phrase now, so seeds always land inside the window. */
function resolveDate(text: string): Date {
  const refs = resolveTemporalReferences(text, new Date(), TZ);
  if (refs.length === 0) throw new Error(`No temporal reference in: ${text}`);
  return new Date(refs[0].startUtc);
}

const SHORTLIST_EXCHANGE = [
  {
    role: "user" as const,
    content: "We're shortlisting CRM tools for our 20-person sales team. Compare Salesforce, HubSpot, Zoho CRM, Pipedrive and Freshsales for us.",
  },
  {
    role: "assistant" as const,
    content:
      "Here's the shortlist comparison for your 20-person team:\n- Salesforce Sales Cloud Professional — $80/user/mo (annual)\n- HubSpot Sales Hub Professional — $90/user/mo\n- Zoho CRM Professional — $23/user/mo\n- Pipedrive Professional — $49.90/user/mo\n- Freshsales Pro — $47/user/mo\n\nFor a 20-seat team, Zoho CRM Professional at $23/user/mo was the most cost-effective option on the shortlist.",
  },
];

describe("TEST 1 — historical retrieval (no unnecessary web search)", () => {
  it("retrieves the exact shortlist from memory without any web search", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "HISTORY_LOOKUP",
        needsSearch: false,
        requiresHistoryRetrieval: true,
        entities: ["Salesforce", "HubSpot", "Zoho CRM", "Pipedrive", "Freshsales"],
        historicalKeywords: ["shortlist", "CRM"],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "Pure memory question",
      }),
      respond: () =>
        "On Monday you shortlisted five CRM tools for your 20-person sales team: Salesforce, HubSpot, Zoho CRM, Pipedrive and Freshsales. Zoho CRM Professional ($23/user/mo) looked like the most cost-effective option.",
      title: () => "CRM shortlist recall",
    });
    const search = new FakeSearchProvider(() => [makeResult({ url: "https://example.com/never-called" })]);
    const services = createTestServices({ llm, search });

    const monday = resolveDate("What did we shortlist on Monday?");
    await seedConversation(services.repos, {
      title: "CRM shortlist for sales team",
      at: monday,
      messages: SHORTLIST_EXCHANGE,
    });

    const result = await runTurn(services, { message: "What did we shortlist on Monday?" });

    // No web search happened.
    expect(search.calls).toHaveLength(0);
    expect(result.events.filter((e) => e.type === "sources")).toHaveLength(0);

    // The plan was a memory lookup.
    const planEvent = result.events.find((e) => e.type === "plan");
    expect(planEvent).toMatchObject({ plan: { category: "HISTORY_LOOKUP", needsSearch: false } });

    // The historical conversation was actually fed to the generator.
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).toContain("HISTORICAL CONVERSATION");
    expect(respondCall.content).toContain("Zoho CRM Professional");
    expect(respondCall.content).toContain("$23/user/mo");

    // Turn completed with zero citations (nothing was searched).
    expect(result.turnEnd).not.toBeNull();
    expect(result.turnEnd?.citations).toHaveLength(0);
    expect(result.turnEnd?.metrics.searchCalls).toBe(0);
    expect(result.error).toBeNull();

    // Both messages persisted.
    const stored = await services.repos.messages.listByConversation(result.conversationId!);
    expect(stored).toHaveLength(2);
    expect(stored[0].content).toContain("What did we shortlist");
  });
});

describe("TEST 6 — missing history", () => {
  it("says honestly that no matching conversation exists (and does not search)", async () => {
    const llm = new FakeLlm({
      planner: () => ({
        category: "HISTORY_LOOKUP",
        needsSearch: false,
        requiresHistoryRetrieval: true,
        entities: [],
        historicalKeywords: [],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "refers to history",
      }),
      respond: () =>
        "I couldn't find any conversation from three months ago in my stored memory, so I can't tell you what you asked. If you remember the topic, I'm happy to research it fresh.",
    });
    const search = new FakeSearchProvider(() => []);
    const services = createTestServices({ llm, search });

    // Seed only a very recent conversation — nothing three months back.
    await seedConversation(services.repos, {
      title: "Today's chat",
      at: new Date(),
      messages: [{ role: "user", content: "hello" }],
    });

    const result = await runTurn(services, { message: "What did I ask you three months ago?" });

    expect(search.calls).toHaveLength(0);
    expect(result.error).toBeNull();

    // The generator was explicitly instructed NOT to fabricate history.
    const respondCall = llm.callsFor("respond")[0];
    expect(respondCall.content).toContain("NO record");
    expect(respondCall.content).toContain("Do NOT fabricate");
    // No historical conversation section was provided.
    expect(respondCall.content).not.toContain("### \"");
  });
});

describe("cross-session persistence", () => {
  it("keeps conversations after a simulated server restart", async () => {
    const llm = new FakeLlm({
      respond: () => "Stored answer.",
      title: () => "Persistence check",
    });
    const search = new FakeSearchProvider(() => []);
    const dbPath = `:memory:`;

    // First "process": create a conversation with a completed turn.
    const first = createTestServices({ llm, search, dbPath });
    const firstRun = await runTurn(first, { message: "Remember that we picked Neon for Hostly." });
    expect(firstRun.turnEnd).not.toBeNull();

    // Simulate restart: brand-new handle over the same file requires a file
    // DB — use a temp file to prove real durability.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const fileDb = path.join(os.tmpdir(), `memento-test-${Date.now()}.db`);
    try {
      const persisted = createTestServices({ llm, search, dbPath: fileDb });
      const seeded = await runTurn(persisted, { message: "Remember that we picked Neon for Hostly." });
      persisted.handle.sqlite.close();

      // "Restart": new services instance, same file.
      const restarted = createTestServices({ llm, search, dbPath: fileDb });
      const conversations = await restarted.repos.conversations.list(TEST_USER_ID);
      expect(conversations.length).toBe(1);
      expect(conversations[0].title).toBe("Persistence check");

      const messages = await restarted.repos.messages.listByConversation(conversations[0].id);
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toBe("Stored answer.");

      // Full-text search across sessions still finds the exchange.
      const hits = await restarted.repos.messages.search(TEST_USER_ID, "Neon Hostly");
      expect(hits.length).toBeGreaterThan(0);
      restarted.handle.sqlite.close();
    } finally {
      fs.rmSync(fileDb, { force: true });
    }
    first.handle.sqlite.close();
  });
});
