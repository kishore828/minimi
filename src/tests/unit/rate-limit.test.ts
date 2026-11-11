import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "@/server/http/rate-limit";

describe("sliding window rate limiter", () => {
  it("allows up to the limit and then blocks", () => {
    const limiter = new SlidingWindowRateLimiter(3);
    const t0 = Date.now();
    expect(limiter.check("ip", t0).allowed).toBe(true);
    expect(limiter.check("ip", t0 + 100).allowed).toBe(true);
    expect(limiter.check("ip", t0 + 200).allowed).toBe(true);
    const blocked = limiter.check("ip", t0 + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = new SlidingWindowRateLimiter(1);
    expect(limiter.check("a", 1).allowed).toBe(true);
    expect(limiter.check("b", 1).allowed).toBe(true);
    expect(limiter.check("a", 2).allowed).toBe(false);
  });

  it("frees the window after a minute", () => {
    const limiter = new SlidingWindowRateLimiter(1);
    const t0 = Date.now();
    expect(limiter.check("ip", t0).allowed).toBe(true);
    expect(limiter.check("ip", t0 + 30_000).allowed).toBe(false);
    expect(limiter.check("ip", t0 + 61_000).allowed).toBe(true);
  });
});
