import { describe, expect, it } from "vitest";
import {
  extractCitationMarkers,
  hasValidCitations,
  sanitizeTextCitations,
  validateComparisonCitations,
} from "@/server/research/claim-verifier";
import type { ClaimComparison } from "@/shared/types";

function comparison(overrides: Partial<ClaimComparison> = {}): ClaimComparison {
  return {
    subject: "Neon Pro",
    claim: "Neon Pro cost $19/month",
    historicalValue: "$19/month",
    currentValue: "$25/month",
    classification: "PRICE_INCREASED",
    evidenceCitations: [1],
    explanation: "Official pricing page now lists $25.",
    ...overrides,
  };
}

describe("claim verifier & citation validation", () => {
  it("keeps citations that exist in the evidence ledger", () => {
    const result = validateComparisonCitations([comparison({ evidenceCitations: [1, 2, 2] })], 3);
    expect(result[0].evidenceCitations).toEqual([1, 2]);
  });

  it("drops out-of-range citations", () => {
    const result = validateComparisonCitations([comparison({ evidenceCitations: [1, 99] })], 2);
    expect(result[0].evidenceCitations).toEqual([1]);
  });

  it("downgrades unsupported change claims to INCONCLUSIVE", () => {
    const result = validateComparisonCitations([comparison({ evidenceCitations: [42] })], 3);
    expect(result[0].classification).toBe("INCONCLUSIVE");
    expect(result[0].evidenceCitations).toEqual([]);
    expect(result[0].explanation).toContain("no verifiable source citation");
  });

  it("allows UNCHANGED without citations (phrased as absence of evidence)", () => {
    const result = validateComparisonCitations(
      [comparison({ classification: "UNCHANGED", evidenceCitations: [], explanation: "No evidence of change found." })],
      0,
    );
    expect(result[0].classification).toBe("UNCHANGED");
  });

  it("allows NO_LONGER_VERIFIABLE without citations", () => {
    const result = validateComparisonCitations(
      [comparison({ classification: "NO_LONGER_VERIFIABLE", evidenceCitations: [7] })],
      1,
    );
    expect(result[0].classification).toBe("NO_LONGER_VERIFIABLE");
    expect(result[0].evidenceCitations).toEqual([]);
  });

  it("extracts and sanitizes inline markers", () => {
    expect(extractCitationMarkers("Price went up [1] per [2] and [99].")).toEqual([1, 2, 99]);
    expect(sanitizeTextCitations("Kept [1] dropped [99].", 2)).toBe("Kept [1] dropped .");
    expect(hasValidCitations("Nothing here.", 0)).toBe(false);
    expect(hasValidCitations("Cited [1].", 1)).toBe(true);
  });
});
