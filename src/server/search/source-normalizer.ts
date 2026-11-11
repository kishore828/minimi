/**
 * Normalization shared by every search provider:
 * - domain extraction + canonicalization (www stripped, lowercase)
 * - lenient publication-date parsing that NEVER invents dates
 * - result deduplication by canonical URL
 * - excerpt clamping
 */
import type { SearchResult } from "@/shared/types";

export function normalizeDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}

/**
 * Parse a provider-supplied date string into ISO UTC. Returns null for
 * anything unparseable — an unknown publication date must stay unknown.
 */
export function parsePublishedDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  // Pure year ("2025") is too coarse to call a publication date.
  if (/^\d{4}$/.test(text)) return null;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0.5;
  return Math.min(1, Math.max(0, score));
}

/** Keep the best-scoring result per canonical URL, order preserved. */
export function dedupeByUrn(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const result of results) {
    const key = canonicalUrlKey(result.url);
    const existing = seen.get(key);
    if (!existing || result.score > existing.score) {
      seen.set(key, result);
    }
  }
  return [...seen.values()];
}

export function canonicalUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = parsed.protocol === "https:" ? "https:" : parsed.protocol;
    // Strip common tracking params.
    const tracking = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "referrer"]);
    for (const key of [...parsed.searchParams.keys()]) {
      if (tracking.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    let path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function clampExcerpt(content: string, maxChars = 600): string {
  return content.length <= maxChars ? content : `${content.slice(0, maxChars - 1).trimEnd()}…`;
}
