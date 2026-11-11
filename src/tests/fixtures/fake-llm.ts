/**
 * Deterministic fake LLM for integration tests.
 *
 * Routes by `purpose` (planner, query_planner, claim_extract, compare_claims,
 * respond, memory_extract, summarize, title). Every call is recorded so
 * tests can assert exactly what the pipeline fed the model.
 */
import type { ZodType } from "zod";
import type { LlmCallOptions, LlmClient, LlmResult, LlmStreamChunk, LlmUsage } from "@/server/llm/client";

export type RouteHandler = (options: LlmCallOptions) => unknown;

export interface RecordedCall {
  purpose: string;
  system: string;
  content: string;
}

const USAGE: LlmUsage = { promptTokens: 120, completionTokens: 60 };

export class FakeLlm implements LlmClient {
  readonly model = "fake-model";
  readonly calls: RecordedCall[] = [];
  private readonly routes: Record<string, RouteHandler>;

  constructor(routes: Record<string, RouteHandler> = {}) {
    this.routes = routes;
  }

  private routeResult(options: LlmCallOptions): unknown {
    const handler = this.routes[options.purpose];
    if (handler) return handler(options);
    return defaultResponse(options.purpose);
  }

  async complete(options: LlmCallOptions): Promise<LlmResult> {
    this.calls.push({
      purpose: options.purpose,
      system: options.system,
      content: options.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
    });
    const result = this.routeResult(options);
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return { text, usage: { ...USAGE } };
  }

  async completeJson<T>(options: LlmCallOptions, schema: ZodType<T>): Promise<{ data: T; usage: LlmUsage | null }> {
    const result = await this.complete(options);
    const parsed = JSON.parse(result.text) as unknown;
    return { data: schema.parse(parsed), usage: result.usage };
  }

  async *stream(options: LlmCallOptions): AsyncIterable<LlmStreamChunk> {
    this.calls.push({
      purpose: options.purpose,
      system: options.system,
      content: options.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
    });
    const result = this.routeResult(options);
    const text = typeof result === "string" ? result : JSON.stringify(result);
    for (let i = 0; i < text.length; i += 24) {
      yield { type: "token", text: text.slice(i, i + 24) };
    }
    yield { type: "usage", usage: { ...USAGE } };
  }

  async ping(): Promise<boolean> {
    return true;
  }

  /** Swap a route between turns (e.g. different planner answers per message). */
  setRoute(purpose: string, handler: RouteHandler): void {
    this.routes[purpose] = handler;
  }

  callsFor(purpose: string): RecordedCall[] {
    return this.calls.filter((c) => c.purpose === purpose);
  }
}

function defaultResponse(purpose: string): unknown {
  switch (purpose) {
    case "planner":
      return {
        category: "CONVERSATIONAL",
        needsSearch: false,
        requiresHistoryRetrieval: false,
        entities: [],
        historicalKeywords: [],
        draftQueries: [],
        clarificationQuestion: null,
        reasoning: "default",
      };
    case "query_planner":
      return { queries: [] };
    case "claim_extract":
      return { claims: [] };
    case "compare_claims":
      return { comparisons: [] };
    case "memory_extract":
      return { memories: [] };
    case "summarize":
      return { summary: "Summary." };
    case "title":
      return "Test conversation";
    case "respond":
    default:
      return "OK.";
  }
}
