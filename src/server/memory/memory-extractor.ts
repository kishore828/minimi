/**
 * Memory extraction: durable facts worth remembering long after the
 * conversation scrolls away. Deliberately conservative — small talk extracts
 * nothing, and every memory is traceable to its source message.
 */
import type { LlmClient } from "@/server/llm/client";
import { memoryExtractionSchema } from "@/shared/schemas";
import type { MemoryCategory } from "@/shared/types";
import { truncate } from "@/shared/utils/text";
import type { z } from "zod";

const EXTRACTION_SYSTEM = `You extract durable memories from a conversation turn for a research assistant with long-term memory.

What qualifies:
- Facts about the user (role, team, constraints, preferences): category "preference".
- Decisions made: category "decision".
- Entities the user cares about (products, companies, technologies): category "entity".
- Concrete research conclusions with their date (e.g. "As of 3 Nov 2025, Neon Pro cost $19/mo"): category "research_conclusion".
- Other stable facts: category "fact".

What does NOT qualify: small talk, transient questions, meta-talk about the assistant, anything the user asked but was never answered.

Rules:
- At most 4 memories. Write each as a compact standalone sentence.
- Include the as-of date for time-sensitive facts when known.
- If nothing qualifies, return an empty list.
- importance: 0.1-1.0 (decisions and research conclusions >= 0.6, small facts ~0.3).

Respond as JSON: {"memories": [{"content": string, "category": "fact"|"decision"|"preference"|"entity"|"research_conclusion"|"other", "importance": number}]}`;

export type ExtractedMemory = z.infer<typeof memoryExtractionSchema>["memories"][number];

export class MemoryExtractor {
  constructor(private readonly llm: LlmClient) {}

  async extract(input: {
    userMessage: string;
    assistantMessage: string;
    currentDateLabel?: string;
    signal?: AbortSignal;
  }): Promise<ExtractedMemory[]> {
    try {
      const dateHeader = input.currentDateLabel ? `Current date: ${input.currentDateLabel}\n\n` : "";
      const { data } = await this.llm.completeJson(
        {
          purpose: "memory_extract",
          system: EXTRACTION_SYSTEM,
          messages: [
            {
              role: "user",
              content: `${dateHeader}User said:\n${truncate(input.userMessage, 3000)}\n\nAssistant replied:\n${truncate(input.assistantMessage, 3000)}`,
            },
          ],
          temperature: 0.1,
          maxTokens: 600,
          signal: input.signal,
        },
        memoryExtractionSchema,
        "memoryExtraction",
      );
      return data.memories.filter((m) => m.content.length > 2);
    } catch {
      // Memory extraction is best-effort: a failure here must never break the turn.
      return [];
    }
  }
}

export type { MemoryCategory };
