/**
 * LLM client abstraction.
 *
 * The orchestrator only depends on this interface, so tests inject a
 * deterministic FakeLlm and the OpenAI implementation can be swapped
 * (or pointed at a compatible gateway via OPENAI_BASE_URL) without
 * touching agent logic.
 */
import type { ZodType } from "zod";
import OpenAI from "openai";
import { AppError } from "@/shared/utils/errors";
import { searchQueryPlanSchema } from "@/shared/schemas";

export interface LlmMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  /** Logical purpose ("planner", "compare", ...) — used for routing in fakes and metrics. */
  purpose: string;
  system: string;
  messages: LlmMessageInput[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage | null;
}

export type LlmStreamChunk =
  | { type: "token"; text: string }
  | { type: "usage"; usage: LlmUsage };

export interface LlmClient {
  readonly model: string;
  complete(options: LlmCallOptions): Promise<LlmResult>;
  completeJson<T>(options: LlmCallOptions, schema: ZodType<T>, schemaName: string): Promise<{ data: T; usage: LlmUsage | null }>;
  stream(options: LlmCallOptions): AsyncIterable<LlmStreamChunk>;
  /** Cheap connectivity check used by /api/health. */
  ping(): Promise<boolean>;
}

export class OpenAiLlmClient implements LlmClient {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(options: { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number }) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: this.timeoutMs,
      maxRetries: 1,
    });
  }

  private buildParams(options: LlmCallOptions, stream: boolean) {
    const isReasoningModel = /^(o[1-9]|gpt-5)/i.test(this.model);
    const maxTokens = options.maxTokens ?? 2048;
    return {
      model: this.model,
      ...(isReasoningModel
        ? { max_completion_tokens: maxTokens }
        : { temperature: options.temperature ?? 0.3, max_tokens: maxTokens }),
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(options.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system" as const, content: options.system },
        ...options.messages,
      ],
    };
  }

  async complete(options: LlmCallOptions): Promise<LlmResult> {
    try {
      // Widen the SDK's overloaded return type (see stream() note).
      const response = (await this.client.chat.completions.create(this.buildParams(options, false), {
        signal: options.signal,
      })) as unknown as OpenAI.Chat.Completions.ChatCompletion;
      const text = response.choices[0]?.message?.content ?? "";
      return {
        text,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens ?? 0,
              completionTokens: response.usage.completion_tokens ?? 0,
            }
          : null,
      };
    } catch (error) {
      throw toLlmError(error);
    }
  }

  async completeJson<T>(
    options: LlmCallOptions,
    schema: ZodType<T>,
    schemaName: string,
  ): Promise<{ data: T; usage: LlmUsage | null }> {
    let lastError: unknown = null;
    let totalUsage: LlmUsage = { promptTokens: 0, completionTokens: 0 };

    for (let attempt = 0; attempt < 2; attempt++) {
      const attemptMessages =
        attempt === 0
          ? options.messages
          : [
              ...options.messages,
              { role: "assistant" as const, content: "INVALID_JSON" },
              {
                role: "user" as const,
                content: `Your previous output was not valid for the "${schemaName}" schema. Respond again with corrected, valid JSON only.`,
              },
            ];

      let result: LlmResult;
      try {
        result = await this.complete({ ...options, messages: attemptMessages, jsonMode: true, temperature: 0 });
      } catch (error) {
        lastError = error;
        continue;
      }
      if (result.usage) {
        totalUsage = {
          promptTokens: totalUsage.promptTokens + result.usage.promptTokens,
          completionTokens: totalUsage.completionTokens + result.usage.completionTokens,
        };
      }

      const parsed = parseJsonObject(result.text);
      if (parsed !== null) {
        const validated = schema.safeParse(parsed);
        if (validated.success) {
          return { data: validated.data, usage: totalUsage };
        }
        lastError = new AppError("LLM_ERROR", `Schema validation failed for ${schemaName}: ${validated.error.issues[0]?.message ?? "unknown"}`);
      } else {
        lastError = new AppError("LLM_ERROR", `Model returned non-JSON output for ${schemaName}`);
      }
    }
    throw lastError instanceof Error ? lastError : new AppError("LLM_ERROR", "Structured output failed");
  }

  async *stream(options: LlmCallOptions): AsyncIterable<LlmStreamChunk> {
    // The SDK's overloads resolve to `Stream<ChatCompletionChunk>` when
    // `stream: true`; buildParams returns a plain object so we widen the type.
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = (await this.client.chat.completions.create(this.buildParams(options, true), {
        signal: options.signal,
      })) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    } catch (error) {
      throw toLlmError(error);
    }
    try {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield { type: "token", text };
        if (chunk.usage) {
          yield {
            type: "usage",
            usage: {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
            },
          };
        }
      }
    } catch (error) {
      throw toLlmError(error);
    }
  }

  async ping(): Promise<boolean> {
    const result = await this.complete({
      purpose: "ping",
      system: "Reply with the single word: ok",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 5,
      temperature: 0,
    });
    return result.text.trim().length > 0;
  }
}

function toLlmError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 502;
    if (status === 401) {
      return new AppError("MISSING_API_KEY", "The OpenAI API key was rejected. Check OPENAI_API_KEY.", { expose: true, cause: error });
    }
    if (status === 429) {
      return new AppError("LLM_ERROR", "The model is rate limited right now. Try again shortly.", { expose: true, cause: error });
    }
    return new AppError("LLM_ERROR", "The model provider returned an error.", { expose: true, cause: error });
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new AppError("ABORTED", "Model call was cancelled.", { expose: true, cause: error });
  }
  return new AppError("LLM_ERROR", "Model call failed.", { expose: true, cause: error });
}

/** Tolerant JSON extraction (handles code fences and leading prose). */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (inner !== null) return inner;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const inner = tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    if (inner !== null) return inner;
  }
  return null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Placeholder used when OPENAI_API_KEY is not configured. Every method fails
 * with a clear, actionable error — but crucially, constructing services never
 * crashes, so health, conversations and the UI all keep working without keys.
 */
export class UnconfiguredLlmClient implements LlmClient {
  readonly model = "not-configured";

  private fail(): never {
    throw new AppError("MISSING_API_KEY", "OPENAI_API_KEY is not configured. Add it to .env and restart the server.");
  }

  complete(): Promise<LlmResult> {
    this.fail();
  }

  completeJson<T>(): Promise<{ data: T; usage: LlmUsage | null }> {
    this.fail();
  }

  async *stream(): AsyncIterable<LlmStreamChunk> {
    this.fail();
  }

  async ping(): Promise<boolean> {
    return false;
  }
}

/** Re-exported so search code can share the tolerant parser. */
export { searchQueryPlanSchema };
