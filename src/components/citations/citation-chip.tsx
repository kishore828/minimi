"use client";

import { useCallback } from "react";
import type { SourceRef } from "@/shared/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CitationChipProps {
  index: number;
  citations: SourceRef[];
}

/**
 * Inline [n] citation marker. Only rendered for indexes that exist in the
 * evidence ledger — out-of-range markers never appear in the UI.
 */
export function CitationChip({ index, citations }: CitationChipProps) {
  const source = citations.find((c) => c.citationIndex === index);

  const scrollToSource = useCallback(() => {
    const anchor = document.getElementById(`source-${index}`);
    if (anchor) {
      anchor.scrollIntoView({ behavior: "smooth", block: "center" });
      anchor.classList.add("ring-2", "ring-primary/40");
      setTimeout(() => anchor.classList.remove("ring-2", "ring-primary/40"), 1200);
    } else if (source) {
      window.open(source.url, "_blank", "noopener,noreferrer");
    }
  }, [index, source]);

  if (!source) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={scrollToSource}
            className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-1 items-center justify-center rounded-[4px] bg-primary/10 px-1 align-middle font-mono text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
            aria-label={`Citation ${index}: ${source.title}`}
          >
            {index}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          <p className="font-medium">{source.title}</p>
          <p className="text-muted-foreground">
            {source.domain}
            {source.publishedDate ? ` · ${source.publishedDate.slice(0, 10)}` : " · date unknown"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
