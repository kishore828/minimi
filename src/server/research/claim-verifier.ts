/**
 * Claim verification & citation validation.
 *
 * Structured LLM output is trusted only after passing these deterministic
 * gates:
 *  - citation indexes must reference an existing ledger entry;
 *  - an assertion that something CHANGED requires at least one valid citation
 *    — otherwise it is downgraded to INCONCLUSIVE;
 *  - inline [n] markers in generated text are stripped when out of range.
 */
import type { ChangeClassification, ClaimComparison } from "@/shared/types";

const CHANGE_CLASSIFICATIONS: ReadonlySet<ChangeClassification> = new Set([
  "PRICE_INCREASED",
  "PRICE_DECREASED",
  "FEATURE_ADDED",
  "FEATURE_REMOVED",
  "POLICY_CHANGED",
  "AVAILABILITY_CHANGED",
  "NEW_INFORMATION",
] as ChangeClassification[]);

/** Clamp comparison citations to the real evidence range. */
export function validateComparisonCitations(
  comparisons: ClaimComparison[],
  evidenceCount: number,
): ClaimComparison[] {
  return comparisons.map((comparison) => {
    const validCitations = [...new Set(comparison.evidenceCitations)].filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= evidenceCount,
    );

    const assertsChange = CHANGE_CLASSIFICATIONS.has(comparison.classification);
    const hasSupport = validCitations.length > 0;

    if (assertsChange && !hasSupport) {
      return {
        ...comparison,
        classification: "INCONCLUSIVE" as const,
        evidenceCitations: [],
        explanation: `${comparison.explanation} (downgraded: no verifiable source citation supports this change)`.trim(),
      };
    }
    if (!assertsChange && comparison.classification === "UNCHANGED" && validCitations.length === 0) {
      // UNCHANGED without evidence is allowed but must be phrased as
      // "no evidence of change found" — the explanation carries that nuance.
      return { ...comparison, evidenceCitations: [] };
    }
    return { ...comparison, evidenceCitations: validCitations };
  });
}

/** All [n] markers used in a text. */
export function extractCitationMarkers(text: string): number[] {
  const markers: number[] = [];
  const pattern = /\[(\d{1,2})\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    markers.push(Number(match[1]));
  }
  return markers;
}

/** Remove out-of-range [n] markers from generated text (in place edits). */
export function sanitizeTextCitations(text: string, evidenceCount: number): string {
  return text.replace(/\[(\d{1,2})\]/g, (full, num: string) => {
    const n = Number(num);
    return n >= 1 && n <= evidenceCount ? full : "";
  });
}

/** True when the response text cites at least one real source. */
export function hasValidCitations(text: string, evidenceCount: number): boolean {
  return extractCitationMarkers(text).some((n) => n >= 1 && n <= evidenceCount);
}
