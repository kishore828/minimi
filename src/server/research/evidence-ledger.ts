/**
 * Evidence ledger.
 *
 * Every citation the assistant can possibly emit is minted here, numbered,
 * deduplicated by URL and traceable to a real provider result. The response
 * generator only ever sees this ledger — fabricating a citation is
 * structurally impossible.
 */
import type { SearchResult, SourceRef } from "@/shared/types";
import { clampExcerpt } from "@/server/search/source-normalizer";
import { canonicalUrlKey } from "@/server/search/source-normalizer";
import { truncate } from "@/shared/utils/text";

export class EvidenceLedger {
  private readonly entries: SourceRef[] = [];
  private readonly seenKeys = new Set<string>();

  get size(): number {
    return this.entries.length;
  }

  /**
   * Add a result supporting `claim`. Returns the numbered citation, or null
   * when the URL was already ledgered (dedupe).
   */
  add(result: SearchResult, claim: string): SourceRef | null {
    const key = canonicalUrlKey(result.url);
    if (this.seenKeys.has(key)) return null;
    this.seenKeys.add(key);
    const citation: SourceRef = {
      citationIndex: this.entries.length + 1,
      claim: truncate(claim, 300),
      title: result.title,
      url: result.url,
      domain: result.domain,
      publishedDate: result.publishedDate,
      retrievedAt: result.retrievedAt,
      excerpt: clampExcerpt(result.content),
    };
    this.entries.push(citation);
    return citation;
  }

  list(): SourceRef[] {
    return [...this.entries];
  }

  /** Numbered block fed to prompts, e.g. "[3] Neon Pricing (neon.tech) — …". */
  formatForPrompt(maxExcerptChars = 350): string {
    return this.entries
      .map((e) => {
        const date = e.publishedDate ? `published ${e.publishedDate.slice(0, 10)}` : "publication date unknown";
        return `[${e.citationIndex}] ${e.title} — ${e.domain} (${date}, retrieved ${e.retrievedAt.slice(0, 10)})\n${clampExcerpt(e.excerpt, maxExcerptChars)}`;
      })
      .join("\n\n");
  }
}
