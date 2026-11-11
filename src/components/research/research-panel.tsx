"use client";

import { useState, type ReactNode } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  GitCompareArrows,
  Globe,
  History,
  Loader2,
  PenLine,
  ListChecks,
} from "lucide-react";
import type { AgentStage } from "@/shared/types/events";
import type { ResearchTrace } from "@/lib/client/use-chat";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STAGE_META: Record<AgentStage, { label: string; icon: ReactNode }> = {
  understanding: { label: "Understanding request", icon: <Brain className="h-3.5 w-3.5" /> },
  retrieving_history: { label: "Retrieving conversation history", icon: <History className="h-3.5 w-3.5" /> },
  planning: { label: "Planning research", icon: <ListChecks className="h-3.5 w-3.5" /> },
  searching: { label: "Searching the web", icon: <Globe className="h-3.5 w-3.5" /> },
  comparing: { label: "Comparing evidence", icon: <GitCompareArrows className="h-3.5 w-3.5" /> },
  generating: { label: "Preparing answer", icon: <PenLine className="h-3.5 w-3.5" /> },
};

const CATEGORY_LABELS: Record<string, string> = {
  CONVERSATIONAL: "Direct answer",
  HISTORY_LOOKUP: "Memory lookup",
  CURRENT_INFO: "Live research",
  TEMPORAL_COMPARISON: "Then vs. now",
  FOLLOW_UP: "Follow-up",
  MULTI_ENTITY_RESEARCH: "Multi-entity research",
  AMBIGUOUS_HISTORY: "Clarifying history",
};

interface ResearchPanelProps {
  trace: ResearchTrace;
  streaming: boolean;
  defaultOpen?: boolean;
}

/**
 * Live research activity, rendered exclusively from real backend events.
 * Stages, queries, and result counts all come from the SSE stream.
 */
export function ResearchPanel({ trace, streaming, defaultOpen = false }: ResearchPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  const hasActivity = trace.stages.length > 0 || trace.searches.length > 0 || trace.plan !== null;
  if (!hasActivity) return null;

  const totalResults = trace.searches.reduce((sum, s) => sum + (s.resultCount ?? 0), 0);
  const summary = trace.searches.length > 0
    ? `${trace.searches.length} search${trace.searches.length === 1 ? "" : "es"} · ${totalResults} result${totalResults === 1 ? "" : "s"}`
    : trace.plan?.category === "HISTORY_LOOKUP"
      ? "From conversation memory"
      : "Thinking through your question";

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
            aria-expanded={open}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary",
                streaming && trace.stages[trace.stages.length - 1] && "animate-pulse",
              )}
            >
              <Globe className="h-3.5 w-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-foreground">Research</span>
              <span className="truncate text-xs text-muted-foreground">{summary}</span>
            </span>
            {trace.plan && (
              <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                {CATEGORY_LABELS[trace.plan.category] ?? trace.plan.category}
              </Badge>
            )}
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 py-3">
            {/* Stage timeline */}
            <ol className="space-y-1.5">
              {trace.stages.map((stage) => {
                const meta = STAGE_META[stage.stage];
                return (
                  <li key={stage.stage} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                        stage.status === "done"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {stage.status === "active" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                    </span>
                    <span className={cn(stage.status === "active" ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {meta.label}
                    </span>
                    {stage.detail && <span className="truncate text-xs text-muted-foreground/70">· {stage.detail}</span>}
                  </li>
                );
              })}
            </ol>

            {/* Queries */}
            {trace.searches.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Queries</h4>
                <ul className="space-y-1">
                  {trace.searches.map((search, index) => (
                    <li key={`${search.query}-${index}`} className="flex items-center gap-2 text-xs">
                      {search.status === "running" ? (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                      ) : (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            search.status === "done" ? "bg-primary" : "bg-destructive",
                          )}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{search.query}</span>
                      {search.status !== "running" && (
                        <span className="shrink-0 tabular-nums text-muted-foreground/70">
                          {search.cached ? "cached" : `${search.resultCount ?? 0} results`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Entities */}
            {trace.plan && trace.plan.entities.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Entities</span>
                {trace.plan.entities.map((entity) => (
                  <Badge key={entity} variant="outline" className="text-xs font-normal">
                    {entity}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
