import { randomUUID } from "node:crypto";

const ALPHABET = "0123456789abcdef";

/** Short, prefixed, collision-resistant identifier (e.g. `msg_9f2c4e1a7b8d`). */
export function newId(prefix: string): string {
  const uuid = randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid.slice(0, 20)}`;
}

export function newRequestId(): string {
  return randomUUID();
}

/** Stable cache key for a (query, options) pair. */
export function stableKey(parts: unknown[]): string {
  const json = JSON.stringify(parts);
  // FNV-1a — deterministic across processes, no crypto cost.
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16) + "_" + json.length.toString(36);
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]+_[0-9a-f]{6,32}$/.test(value);
}

export { ALPHABET };
