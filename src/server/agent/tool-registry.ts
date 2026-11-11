/**
 * Tool registry — the formal surface of the agent's external capabilities.
 *
 * Memento exposes exactly ONE external tool to the agent: `web_search`.
 * Database, memory and conversation operations are application
 * infrastructure the orchestrator calls directly; they are deliberately NOT
 * agent tools (see DESIGN.md, "Why a single search tool").
 *
 * Every web search in the system goes through this registry, which clamps
 * result limits to configured values.
 */
import { z } from "zod";
import { AppError } from "@/shared/utils/errors";
import type { SearchExecutor } from "@/server/search/search-executor";

export interface AgentTool {
  name: string;
  description: string;
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  list(): Array<{ name: string; description: string }> {
    return [...this.tools.values()].map(({ name, description }) => ({ name, description }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, input: unknown, options?: { signal?: AbortSignal }): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new AppError("NOT_FOUND", `Unknown tool: ${name}`);
    }
    return tool.execute(input, options);
  }
}

const webSearchInputSchema = z.object({
  query: z.string().trim().min(2).max(400),
  maxResults: z.number().int().min(1).max(10).optional(),
  topic: z.enum(["general", "news"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
});

export const WEB_SEARCH_TOOL_DESCRIPTION =
  "Search the web. Input: { query, maxResults?, topic?: 'general'|'news', timeRange? }. Returns normalized results with title, url, excerpt, domain, publishedDate (may be null), score.";

export function createDefaultToolRegistry(deps: {
  searchExecutor: SearchExecutor;
  maxResults: number;
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "web_search",
    description: WEB_SEARCH_TOOL_DESCRIPTION,
    execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
      const parsed = webSearchInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", `Invalid web_search input: ${parsed.error.issues[0]?.message}`);
      }
      const maxResults = Math.min(parsed.data.maxResults ?? deps.maxResults, deps.maxResults);
      const { results, cached } = await deps.searchExecutor.runSingle(
        {
          query: parsed.data.query,
          topic: parsed.data.topic ?? "general",
          timeRange: parsed.data.timeRange ?? null,
          purpose: "direct",
        },
        options?.signal,
      );
      return { results, cached };
    },
  });
  return registry;
}
