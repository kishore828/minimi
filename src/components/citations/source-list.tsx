"use client";

import { ExternalLink } from "lucide-react";
import type { SourceRef } from "@/shared/types";
import { formatDateShort } from "@/lib/client/format";
import { Separator } from "@/components/ui/separator";

interface SourceListProps {
  citations: SourceRef[];
}

/** Numbered source list below an answer. Each entry is a real, clickable search result. */
export function SourceList({ citations }: SourceListProps) {
  if (citations.length === 0) return null;

  return (
    <section aria-label="Sources" className="mt-4">
      <Separator className="mb-3" />
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sources</h3>
      <ol className="space-y-1.5">
        {citations.map((source) => (
          <li
            key={`${source.citationIndex}-${source.url}`}
            id={`source-${source.citationIndex}`}
            className="group flex items-start gap-2.5 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/40"
          >
            <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-primary/10 px-1 font-mono text-[10px] font-semibold text-primary">
              {source.citationIndex}
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-1 text-sm font-medium text-foreground decoration-primary/40 underline-offset-2 hover:underline"
              >
                {source.title}
              </a>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {source.domain}
                {source.publishedDate ? ` · published ${formatDateShort(source.publishedDate)}` : " · publication date unknown"}
                {` · retrieved ${formatDateShort(source.retrievedAt)}`}
              </p>
            </div>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
              aria-label="Open source in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
