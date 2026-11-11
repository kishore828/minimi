import { describe, expect, it } from "vitest";
import { rankMemories, scoreMemory } from "@/server/memory/memory-ranking";
import type { Memory } from "@/shared/types";

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem_${Math.random().toString(36).slice(2, 8)}`,
    userId: "local-user",
    conversationId: null,
    content: "We shortlisted Salesforce, HubSpot and Zoho CRM.",
    category: "decision",
    importance: 0.8,
    sourceMessageId: null,
    createdAt: new Date("2025-11-01T10:00:00Z").toISOString(),
    updatedAt: new Date("2025-11-01T10:00:00Z").toISOString(),
    ...overrides,
  };
}

const NOW = new Date("2025-11-06T10:00:00Z");

describe("memory ranking", () => {
  it("scores entity matches higher than unrelated memories", () => {
    const related = memory({ content: "Salesforce pricing was $25/user/month" });
    const unrelated = memory({ content: "The user prefers dark mode dashboards", importance: 0.9 });
    const relatedScore = scoreMemory(related, "Salesforce pricing", ["Salesforce"], NOW);
    const unrelatedScore = scoreMemory(unrelated, "Salesforce pricing", ["Salesforce"], NOW);
    expect(relatedScore).toBeGreaterThan(unrelatedScore);
  });

  it("rewards recency with a half-life decay", () => {
    const fresh = memory({ createdAt: "2025-11-05T10:00:00Z" });
    const stale = memory({ createdAt: "2025-08-01T10:00:00Z" });
    expect(scoreMemory(fresh, "query", [], NOW)).toBeGreaterThan(scoreMemory(stale, "query", [], NOW));
  });

  it("ranks and limits results", () => {
    const ranked = rankMemories(
      [
        memory({ content: "irrelevant", importance: 0.1 }),
        memory({ content: "Salesforce decision", importance: 0.9 }),
        memory({ content: "another Salesforce note", importance: 0.6 }),
      ],
      "What did we decide about Salesforce?",
      ["Salesforce"],
      NOW,
      2,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0].memory.content).toContain("Salesforce decision");
  });
});
