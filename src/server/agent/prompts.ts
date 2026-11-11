/**
 * Prompt library for the agent core: planner classification and final
 * response generation. Feature modules (summarizer, comparator, extractor,
 * query planner) own their own prompts — see DESIGN.md for the reasoning.
 */
import type { ConversationMessage, SourceRef, ClaimComparison, HistoricalClaim } from "@/shared/types";
import type { RelevantMemory } from "@/server/memory/memory-manager";
import type { HistoricalConversationMatch } from "@/server/memory/conversation-retriever";
import type { TemporalReference } from "@/shared/utils/temporal";
import { truncate } from "@/shared/utils/text";

/* ------------------------------------------------------------------------- */
/* Planner                                                                   */
/* ------------------------------------------------------------------------- */

export const PLANNER_SYSTEM = `You classify requests for a research assistant that has persistent memory of past conversations and exactly one external tool: web search.

Categories (choose exactly one):
- CONVERSATIONAL: chat, stable knowledge (e.g. "difference between SQL and NoSQL"), explanations, writing, math. Nothing externally current is needed.
- HISTORY_LOOKUP: primarily asking what was discussed/decided/concluded earlier ("What did we shortlist on Monday?", "What did you tell me about X?").
- CURRENT_INFO: needs current external information (today's prices, latest releases, news, current docs).
- TEMPORAL_COMPARISON: compares an earlier discussion against the present ("Is that still correct?", "Has anything changed since last Tuesday?").
- FOLLOW_UP: refers to an entity/topic from earlier in the CURRENT conversation without naming it again ("What about their enterprise plan?").
- MULTI_ENTITY_RESEARCH: researches several distinct entities in parallel (five CRM tools, three databases).
- AMBIGUOUS_HISTORY: refers to history that may not exist or is too vague to resolve; a clarification question is needed.

Decision rules:
- Pure memory questions get needsSearch=false. Searching the web to answer "what did we discuss" is wrong — UNLESS the user also asks whether it is still accurate, which is TEMPORAL_COMPARISON.
- CURRENT_INFO, TEMPORAL_COMPARISON and MULTI_ENTITY_RESEARCH normally need needsSearch=true (a historical baseline may be missing — you will see candidate conversations; if none match, set needsSearch=false so the agent can respond honestly instead of fabricating a baseline).
- requiresHistoryRetrieval=true whenever the question refers to earlier discussions ("we", "last Tuesday", "previously", "what did I ask").
- entities: the distinct named things involved (products, companies, people, plans).
- historicalKeywords: words likely to appear in that earlier conversation (product names, "shortlist", "pricing", "hosting"...).
- draftQueries: raw search query ideas; a later step refines them.
- clarificationQuestion: only when the request cannot be resolved at all without it.

You will receive: the current conversation, long-term memories, candidate historical conversations (or "none found"), and deterministic date resolutions for temporal phrases. Trust the date resolutions — they are computed exactly, not guessed.

Respond as JSON: {"category": string, "needsSearch": boolean, "requiresHistoryRetrieval": boolean, "entities": string[], "historicalKeywords": string[], "draftQueries": string[], "clarificationQuestion": string|null, "reasoning": string}`;

export function buildPlannerContext(input: {
  question: string;
  recentHistory: ConversationMessage[];
  memories: RelevantMemory[];
  historicalMatches: HistoricalConversationMatch[];
  temporalRefs: TemporalReference[];
  currentDateLabel?: string;
}): string {
  const sections: string[] = [];

  if (input.currentDateLabel) {
    sections.push(`CURRENT DATE/TIME: ${input.currentDateLabel}`);
  }
  sections.push(`CURRENT USER MESSAGE:\n${input.question}`);

  if (input.temporalRefs.length > 0) {
    const lines = input.temporalRefs
      .map(
        (r) =>
          `- "${r.matchedText}" (${r.role === "present_anchor" ? "present anchor" : "historical window"}) resolves to ${r.startUtc.slice(0, 10)} .. ${r.endUtc.slice(0, 10)} UTC (${r.summary}; ${r.confidence})`,
      )
      .join("\n");
    sections.push(`DETERMINISTIC DATE RESOLUTIONS (authoritative):\n${lines}`);
  } else {
    sections.push("DETERMINISTIC DATE RESOLUTIONS: none detected in the message.");
  }

  if (input.recentHistory.length > 0) {
    const transcript = input.recentHistory
      .map((m) => `${m.role === "user" ? "User" : "Assistant"} (${m.createdAt.slice(0, 10)}): ${truncate(m.content, 500)}`)
      .join("\n");
    sections.push(`CURRENT CONVERSATION SO FAR:\n${transcript}`);
  } else {
    sections.push("CURRENT CONVERSATION SO FAR: (this is the first message of a new conversation)");
  }

  if (input.memories.length > 0) {
    const lines = input.memories.map((m) => `- (${m.category}, ${m.createdAt.slice(0, 10)}) ${m.content}`).join("\n");
    sections.push(`LONG-TERM MEMORIES:\n${lines}`);
  } else {
    sections.push("LONG-TERM MEMORIES: none stored yet.");
  }

  sections.push(buildHistoricalContext(input.historicalMatches, "CANDIDATE HISTORICAL CONVERSATIONS"));

  return sections.join("\n\n");
}

/* ------------------------------------------------------------------------- */
/* Response generator                                                        */
/* ------------------------------------------------------------------------- */

export const RESPONSE_SYSTEM = `You are Memento, a research assistant that remembers past conversations and verifies facts against the current web.

Voice and style:
- Direct, conversational, concise. Lead with the answer, then the support.
- Short paragraphs; bold sparingly for key facts; bullet lists when comparing several items.
- Never mention internal pipelines, stages, models or tool mechanics.

Memory discipline:
- Refer to past conversations naturally ("When we looked at this on 3 Nov...").
- NEVER fabricate memories. If the guidance says no matching conversation was found, say so plainly — do not invent one.
- Keep distinct: what the user said, what you concluded earlier, what external sources reported, and when each was verified.

Evidence discipline:
- Ground every factual statement that comes from the evidence list in citations like [1] or [2]. Use ONLY the numbers provided in the evidence list.
- Do not cite greetings, opinions, or your own reasoning.
- Quote prices and values exactly as sources state them; mention publication dates when they matter.
- When evidence is missing or conflicting, say exactly that. "I found no evidence of a pricing change in the sources I checked" is a valid and often the correct answer — never claim certainty you do not have.

Comparison answers:
- Structure: what we knew then → what I found now → what changed / what did not / what could not be verified.
- Use the exact values from the comparison data provided; do not invent different numbers.
- Finish with a one-line takeaway.

Length: as short as the question allows. Never pad.`;

export interface ResponseContext {
  question: string;
  recentHistory: ConversationMessage[];
  memoryContext: string | null;
  historicalContext: string | null;
  claimsContext: string | null;
  evidenceContext: string | null;
  comparisonContext: string | null;
  /** Extra honest-handling instructions (e.g. "history not found"). */
  guidance: string | null;
  currentDateLabel?: string;
}

export function buildResponseMessages(context: ResponseContext): Array<{ role: "user" | "assistant"; content: string }> {
  const sections: string[] = [];

  if (context.currentDateLabel) sections.push(`CURRENT DATE/TIME: ${context.currentDateLabel}`);
  if (context.recentHistory.length > 0) {
    const transcript = context.recentHistory
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${truncate(m.content, 700)}`)
      .join("\n");
    sections.push(`CONVERSATION SO FAR:\n${transcript}`);
  }
  if (context.memoryContext) sections.push(`LONG-TERM MEMORY:\n${context.memoryContext}`);
  if (context.historicalContext) sections.push(context.historicalContext);
  if (context.claimsContext) sections.push(context.claimsContext);
  if (context.evidenceContext) sections.push(`CURRENT EVIDENCE (cite as [n]):\n${context.evidenceContext}`);
  if (context.comparisonContext) sections.push(context.comparisonContext);
  if (context.guidance) sections.push(`IMPORTANT GUIDANCE:\n${context.guidance}`);

  sections.push(`USER'S QUESTION (answer this):\n${context.question}`);
  return [{ role: "user", content: sections.join("\n\n---\n\n") }];
}

/* ------------------------------------------------------------------------- */
/* Shared context builders                                                   */
/* ------------------------------------------------------------------------- */

export function buildHistoricalContext(matches: HistoricalConversationMatch[], header: string): string {
  if (matches.length === 0) {
    return `${header}: none found.`;
  }
  const blocks = matches.map((match) => {
    const lines: string[] = [];
    lines.push(`### "${match.title}" — conversation of ${match.matchedAt.slice(0, 10)} (match score ${match.score})`);
    if (match.summary) lines.push(`Summary: ${match.summary}`);
    for (const message of match.messages) {
      lines.push(`${message.role === "user" ? "User" : "Assistant"} (${message.createdAt.slice(0, 10)}): ${truncate(message.content, 900)}`);
    }
    return lines.join("\n");
  });
  return `${header}:\n${blocks.join("\n\n")}`;
}

export function buildMemoryContext(memories: RelevantMemory[]): string | null {
  if (memories.length === 0) return null;
  return memories.map((m) => `- (${m.category}, ${m.createdAt.slice(0, 10)}) ${m.content}`).join("\n");
}

export function buildClaimsContext(claims: HistoricalClaim[], asOfHint: string): string | null {
  if (claims.length === 0) return null;
  const lines = claims.map(
    (c) => `- ${c.subject} — ${c.topic}: ${c.claim}${c.value ? ` (value: ${c.value})` : ""} [as of ${c.asOf ?? asOfHint}]`,
  );
  return `CLAIMS FROM THE EARLIER DISCUSSION (verified as of ${asOfHint}):\n${lines.join("\n")}`;
}

export function buildComparisonContext(comparisons: ClaimComparison[], citations: SourceRef[]): string | null {
  if (comparisons.length === 0) return null;
  const lines = comparisons.map((c) => {
    const evidence = c.evidenceCitations.map((n) => `[${n}]`).join(" ");
    return `- ${c.subject} — ${c.claim}\n  Then: ${c.historicalValue ?? "not recorded"} | Now: ${c.currentValue ?? "unknown"}\n  Classification: ${c.classification} ${evidence}\n  ${c.explanation}`;
  });
  const citationIndex = citations.map((c) => `[${c.citationIndex}] ${c.title} (${c.domain})`).join(" ");
  return `COMPARISON RESULTS (already computed — do not contradict them):\n${lines.join("\n")}\n\nCITATION INDEX: ${citationIndex}`;
}
