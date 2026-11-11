"use client";

import type { ChangeClassification, ClaimComparison } from "@/shared/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CitationChip } from "@/components/citations/citation-chip";
import type { SourceRef } from "@/shared/types";

const CLASSIFICATION_META: Record<
  ChangeClassification,
  { label: string; className: string }
> = {
  UNCHANGED: { label: "Unchanged", className: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
  PRICE_INCREASED: { label: "Price ↑", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  PRICE_DECREASED: { label: "Price ↓", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  FEATURE_ADDED: { label: "Feature added", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  FEATURE_REMOVED: { label: "Feature removed", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  POLICY_CHANGED: { label: "Policy changed", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  AVAILABILITY_CHANGED: { label: "Availability changed", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  NEW_INFORMATION: { label: "New information", className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  NO_LONGER_VERIFIABLE: { label: "Not verifiable", className: "bg-slate-500/10 text-slate-500 dark:text-slate-400" },
  INCONCLUSIVE: { label: "Inconclusive", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

interface ComparisonTableProps {
  comparisons: ClaimComparison[];
  citations: SourceRef[];
}

/** Then-vs-now comparison grid, rendered from validated comparison data. */
export function ComparisonTable({ comparisons, citations }: ComparisonTableProps) {
  if (comparisons.length === 0) return null;

  return (
    <section aria-label="Comparison" className="mt-4 overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Then vs. now</h3>
        <p className="text-xs text-muted-foreground">Compared against your earlier discussion, with supporting evidence.</p>
      </div>

      {/* Header row (desktop) */}
      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_150px_90px] gap-3 border-b px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:grid">
        <span>Topic</span>
        <span>Previously</span>
        <span>Now</span>
        <span>Status</span>
        <span>Evidence</span>
      </div>

      <ul className="divide-y">
        {comparisons.map((comparison, index) => {
          const meta = CLASSIFICATION_META[comparison.classification];
          return (
            <li
              key={`${comparison.subject}-${index}`}
              className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_150px_90px] md:items-start md:gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{comparison.subject}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{comparison.claim}</p>
              </div>
              <div className="text-sm text-muted-foreground md:pt-0.5">
                <span className="md:hidden font-medium text-muted-foreground/70">Previously: </span>
                {comparison.historicalValue ?? "—"}
              </div>
              <div className="text-sm text-foreground md:pt-0.5">
                <span className="md:hidden font-medium text-muted-foreground/70">Now: </span>
                {comparison.currentValue ?? "unknown"}
              </div>
              <div className="md:pt-0.5">
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", meta.className)}>
                  {meta.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-0.5 md:pt-0.5">
                {comparison.evidenceCitations.length > 0 ? (
                  comparison.evidenceCitations.map((n) => <CitationChip key={n} index={n} citations={citations} />)
                ) : (
                  <span className="text-xs text-muted-foreground/60">none</span>
                )}
              </div>
              {comparison.explanation && (
                <p className="col-span-full text-xs leading-relaxed text-muted-foreground/80">{comparison.explanation}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
