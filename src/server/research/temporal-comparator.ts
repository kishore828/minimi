/**
 * Temporal comparator — Memento's signature capability.
 *
 * Two LLM steps, both structurally validated:
 *  1. Extract verifiable claims from the historical conversation.
 *  2. Classify each claim against CURRENT evidence with citations.
 *
 * Deterministic guardrails (claim-verifier.ts) ensure a "changed"
 * classification can only survive with a real supporting citation, and the
 * date arithmetic itself never touches the LLM (temporal.ts).
 */
import type { LlmClient } from "@/server/llm/client";
import { claimExtractionSchema, comparisonOutputSchema } from "@/shared/schemas";
import type { ClaimComparison, ConversationMessage, HistoricalClaim } from "@/shared/types";
import { truncate } from "@/shared/utils/text";
import { validateComparisonCitations } from "./claim-verifier";

const CLAIM_EXTRACTION_SYSTEM = `You extract time-sensitive factual claims from a historical conversation so they can be re-verified later.

Rules:
- Extract only claims that were actually stated or concluded in the conversation — never infer or add knowledge.
- Prefer claims whose truth can change: prices, plans, features, policies, availability, versions.
- "subject" is the entity (product/company/team). "topic" is the aspect (e.g. "Pro plan pricing").
- "value" is the concrete value stated (e.g. "$19/month"), null if the conversation did not state one.
- "asOf" is the date the claim was true according to the conversation (use the conversation date given below), null if unknown.
- "messageIndex" is the index of the message in the numbered transcript that contains the claim.
- Skip chit-chat, opinions, and questions that were never answered.
- At most 12 claims, most important first.

Respond as JSON: {"claims": [{"subject": string, "topic": string, "claim": string, "type": "PRICE"|"FEATURE"|"POLICY"|"AVAILABILITY"|"FACT"|"OTHER", "value": string|null, "asOf": string|null, "messageIndex": number}]}`;

const COMPARISON_SYSTEM = `You compare historical claims against current evidence from fresh web search results.

Classification rules — follow them strictly:
- UNCHANGED: current evidence explicitly confirms the same value/fact. Cite the confirming source(s).
- PRICE_INCREASED / PRICE_DECREASED: a source states a new price that differs from the historical value. Cite it.
- FEATURE_ADDED / FEATURE_REMOVED: a source explicitly reports the feature change. Cite it.
- POLICY_CHANGED / AVAILABILITY_CHANGED: a source explicitly reports the change. Cite it.
- NEW_INFORMATION: significant new information that materially updates the topic (not a change to an existing claim). Cite it.
- NO_LONGER_VERIFIABLE: you found no current evidence that could confirm or refute the claim.
- INCONCLUSIVE: sources conflict, or the historical claim was too vague to compare.

Hard rules:
- NEVER classify something as changed without citing the evidence number(s) that support it.
- Prefer primary sources (official pricing pages, docs, changelogs) over secondary reporting when they conflict; mention the conflict in the explanation.
- If prices differ, quote both the historical value and the current value exactly.
- If the evidence does not actually address the claim, that is NO_LONGER_VERIFIABLE — not UNCHANGED. "I found no evidence of a change" is NOT the same as "the price is unchanged".
- Keep explanations to 1-2 sentences.

Respond as JSON: {"comparisons": [{"subject": string, "claim": string, "historicalValue": string|null, "currentValue": string|null, "classification": "UNCHANGED"|"PRICE_INCREASED"|"PRICE_DECREASED"|"FEATURE_ADDED"|"FEATURE_REMOVED"|"POLICY_CHANGED"|"AVAILABILITY_CHANGED"|"NEW_INFORMATION"|"NO_LONGER_VERIFIABLE"|"INCONCLUSIVE", "evidenceCitations": number[], "explanation": string}]}`;

export class TemporalComparator {
  constructor(private readonly llm: LlmClient) {}

  async extractClaims(input: {
    messages: Array<{ role: ConversationMessage["role"]; content: string; createdAt: string }>;
    referenceDateHint?: string;
    signal?: AbortSignal;
  }): Promise<HistoricalClaim[]> {
    if (input.messages.length === 0) return [];
    const transcript = input.messages
      .map((m, i) => `[${i}] ${m.role === "user" ? "User" : "Assistant"} (${m.createdAt.slice(0, 10)}): ${truncate(m.content, 1200)}`)
      .join("\n\n");

    const context = [
      input.referenceDateHint ? `This conversation took place around: ${input.referenceDateHint}` : null,
      transcript,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { data } = await this.llm.completeJson(
      {
        purpose: "claim_extract",
        system: CLAIM_EXTRACTION_SYSTEM,
        messages: [{ role: "user", content: context }],
        temperature: 0.1,
        maxTokens: 1400,
        signal: input.signal,
      },
      claimExtractionSchema,
      "claimExtraction",
    );

    const maxIndex = input.messages.length - 1;
    return data.claims
      .filter((c) => c.claim.length > 2)
      .map((c) => ({ ...c, messageIndex: Math.min(Math.max(0, c.messageIndex), maxIndex) }));
  }

  async compare(input: {
    claims: HistoricalClaim[];
    evidencePrompt: string;
    evidenceCount: number;
    comparisonDateHint: string;
    currentDateLabel?: string;
    signal?: AbortSignal;
  }): Promise<ClaimComparison[]> {
    if (input.claims.length === 0) return [];

    const claimsBlock = input.claims
      .map(
        (c, i) =>
          `${i + 1}. Subject: ${c.subject} | Topic: ${c.topic} | Type: ${c.type}\n   Claim: ${c.claim}\n   Historical value: ${c.value ?? "not stated"}\n   As of: ${c.asOf ?? input.comparisonDateHint}`,
      )
      .join("\n");

    const dateLine = input.currentDateLabel ? `Current date: ${input.currentDateLabel}\n\n` : "";
    const { data } = await this.llm.completeJson(
      {
        purpose: "compare_claims",
        system: COMPARISON_SYSTEM,
        messages: [
          {
            role: "user",
            content: `${dateLine}Historical claims (from a conversation on/around ${input.comparisonDateHint}):\n${claimsBlock}\n\nCurrent evidence from web search:\n${input.evidencePrompt}`,
          },
        ],
        temperature: 0.1,
        maxTokens: 1800,
        signal: input.signal,
      },
      comparisonOutputSchema,
      "comparisonOutput",
    );

    return validateComparisonCitations(data.comparisons, input.evidenceCount);
  }
}
