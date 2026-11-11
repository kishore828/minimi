/**
 * Wraps an LlmClient so every call (complete, structured, streaming) is
 * automatically recorded on the current turn's tracker. Lets all pipeline
 * components stay usage-agnostic while metrics stay exact.
 */
import type { LlmCallOptions, LlmClient, LlmResult, LlmStreamChunk, LlmUsage } from "./client";
import type { ZodType } from "zod";
import type { TurnTracker } from "@/server/evaluation/metrics";

export class TrackedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly tracker: TurnTracker,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  async complete(options: LlmCallOptions): Promise<LlmResult> {
    const result = await this.inner.complete(options);
    this.tracker.recordLlmCall(options.purpose, result.usage);
    return result;
  }

  async completeJson<T>(options: LlmCallOptions, schema: ZodType<T>, schemaName: string): Promise<{ data: T; usage: LlmUsage | null }> {
    const result = await this.inner.completeJson(options, schema, schemaName);
    this.tracker.recordLlmCall(options.purpose, result.usage);
    return result;
  }

  async *stream(options: LlmCallOptions): AsyncIterable<LlmStreamChunk> {
    for await (const chunk of this.inner.stream(options)) {
      if (chunk.type === "usage") {
        this.tracker.recordLlmCall(options.purpose, chunk.usage);
      }
      yield chunk;
    }
  }

  async ping(): Promise<boolean> {
    return this.inner.ping();
  }
}
