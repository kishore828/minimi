/**
 * Conversation summarization & titling.
 *
 * Summaries are retrieval artifacts first, prose second: they must preserve
 * entities, prices, decisions and dates so future "what did we decide about
 * X" questions can find them.
 */
import type { LlmClient } from "@/server/llm/client";
import type { ConversationMessage } from "@/shared/types";
import { truncate } from "@/shared/utils/text";

const SUMMARY_SYSTEM = `You maintain a rolling summary of a research conversation.

Requirements:
- At most 120 words.
- PRESERVE concrete details someone might ask about later: product/company names, prices and plans, versions, decisions made, deadlines, dates.
- Note what the user asked and what was concluded, separately.
- Note time-sensitive facts (prices, policies, availability) explicitly as "as of <date>" when the conversation implies a date.
- Plain text, no headings or lists.`;

const TITLE_SYSTEM = `Generate a short title (3-6 words) for a conversation.
- Capture the main topic (products, decisions, questions).
- No quotes, no trailing period, title case.
Examples: "CRM Shortlist for Sales Team", "Neon vs Supabase Pricing", "Postgres Hosting Options".`;

export class ConversationSummarizer {
  constructor(private readonly llm: LlmClient) {}

  async summarize(input: {
    messages: ConversationMessage[];
    previousSummary: string | null;
    signal?: AbortSignal;
  }): Promise<string> {
    const transcript = input.messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${truncate(m.content, 1500)}`)
      .join("\n\n");

    const userContent = input.previousSummary
      ? `Previous summary:\n${input.previousSummary}\n\nNew messages since:\n${transcript}\n\nProduce the updated rolling summary.`
      : `Conversation so far:\n${transcript}\n\nProduce the summary.`;

    const result = await this.llm.complete({
      purpose: "summarize",
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.2,
      maxTokens: 400,
      signal: input.signal,
    });
    return result.text.trim();
  }

  async generateTitle(input: {
    userMessage: string;
    assistantMessage: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const result = await this.llm.complete({
      purpose: "title",
      system: TITLE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `User: ${truncate(input.userMessage, 600)}\nAssistant: ${truncate(input.assistantMessage, 600)}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 30,
      signal: input.signal,
    });
    const title = result.text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    return title.length > 0 ? title : "New conversation";
  }
}
