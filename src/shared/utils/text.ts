/** Text utilities used by memory ranking, FTS query building and prompts. */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by",
  "for", "with", "about", "against", "between", "into", "through", "during",
  "before", "after", "above", "below", "to", "from", "up", "down", "in", "out",
  "on", "off", "over", "under", "again", "further", "once", "here", "there",
  "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "can",
  "will", "just", "should", "now", "i", "me", "my", "we", "our", "you", "your",
  "he", "him", "his", "she", "her", "it", "its", "they", "them", "their",
  "what", "which", "who", "whom", "this", "that", "these", "those", "am", "is",
  "are", "was", "were", "be", "been", "being", "have", "has", "had", "having",
  "do", "does", "did", "doing", "of", "as", "until", "while", "because",
  "would", "could", "ought", "how", "why", "where", "any", "did", "get", "got",
  "let", "like", "make", "much", "need", "please", "really", "said", "say",
  "see", "seem", "still", "take", "thing", "things", "think", "want", "well",
  "also", "ever", "back", "going", "gone", "know", "one", "two", "us",
]);

/** Lowercase word tokens, ignoring punctuation. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9'+]+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 0);
}

/** Informative keywords (tokens minus stopwords), most frequent first. */
export function extractKeywords(text: string, limit = 12): string[] {
  const tokens = tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([token]) => token);
}

/** Jaccard-style keyword overlap between two texts, in 0..1. */
export function keywordOverlap(a: string, b: string): number {
  const setA = new Set(tokenize(a).filter((t) => !STOPWORDS.has(t)));
  const setB = new Set(tokenize(b).filter((t) => !STOPWORDS.has(t)));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  return intersection / Math.min(setA.size, setB.size);
}

/** Trim to `maxChars`, cutting on a word boundary when possible. */
export function truncate(text: string, maxChars: number, suffix = "…"): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars - suffix.length);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + suffix;
}

/** Rough token estimate (~4 chars per token) for budget accounting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Escape free text into a safe FTS5 prefix query: `foo bar` -> `foo* AND bar*`.
 * Only alphanumeric characters survive, so FTS operators cannot be injected.
 */
export function toFtsQuery(text: string, limit = 8): string {
  const tokens = tokenize(text).filter((t) => t.length > 1).slice(0, limit);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" AND ");
}
