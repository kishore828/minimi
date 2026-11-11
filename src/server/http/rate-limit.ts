/**
 * In-memory sliding-window rate limiter (per process). Local single-user
 * deployments do not justify a Redis dependency; the interface makes the
 * upgrade path obvious.
 */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxPerMinute: number) {}

  check(key: string, now = Date.now()): RateLimitDecision {
    const windowStart = now - 60_000;
    const entry = this.hits.get(key) ?? [];
    const recent = entry.filter((t) => t > windowStart);

    if (recent.length >= this.maxPerMinute) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Occasional cleanup to bound memory.
    if (this.hits.size > 5000) {
      for (const [k, times] of this.hits) {
        const live = times.filter((t) => t > windowStart);
        if (live.length === 0) this.hits.delete(k);
        else this.hits.set(k, live);
      }
    }

    return { allowed: true, retryAfterSeconds: 0, remaining: this.maxPerMinute - recent.length };
  }
}
