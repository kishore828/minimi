/**
 * Response generator: streams the final answer with citation discipline.
 * The orchestrator accumulates tokens and sanitizes citations against the
 * evidence ledger after the stream ends.
 */
import type { LlmClient } from "@/server/llm/client";
import { buildResponseMessages, RESPONSE_SYSTEM, type ResponseContext } from "./prompts";

export class ResponseGenerator {
  constructor(private readonly llm: LlmClient) {}

  async *stream(context: ResponseContext, signal?: AbortSignal): AsyncGenerator<string> {
    const messages = buildResponseMessages(context);
    const stream = this.llm.stream({
      purpose: "respond",
      system: RESPONSE_SYSTEM,
      messages,
      temperature: 0.4,
      maxTokens: 1600,
      signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === "token" && chunk.text.length > 0) {
        yield chunk.text;
      }
    }
  }
}
