import { describe, expect, it } from "vitest";
import { resolveTemporalReferences } from "@/shared/utils/temporal";

/** Asia/Kolkata is UTC+5:30 with no DST — deterministic boundary testing. */
const TZ = "Asia/Kolkata";

function resolve(text: string, nowIso: string) {
  return resolveTemporalReferences(text, new Date(nowIso), TZ);
}

describe("temporal parser (TEST 10: date resolution)", () => {
  it("resolves 'last Tuesday' to the previous week's Tuesday when today is Tuesday", () => {
    // 2025-11-11 is a Tuesday, 09:00 IST = 03:30 UTC.
    const refs = resolve("What did I ask you last Tuesday?", "2025-11-11T03:30:00Z");
    expect(refs).toHaveLength(1);
    expect(refs[0].matchedText).toBe("last Tuesday");
    // Local Tuesday = 2025-11-04, midnight IST = 2025-11-03T18:30Z.
    expect(refs[0].startUtc).toBe("2025-11-03T18:30:00.000Z");
    expect(refs[0].endUtc).toBe("2025-11-04T18:30:00.000Z");
  });

  it("resolves 'last Tuesday' from a Thursday", () => {
    // 2025-11-06 is a Thursday.
    const refs = resolve("What did I ask you last Tuesday?", "2025-11-06T10:00:00Z");
    expect(refs[0].startUtc).toBe("2025-11-03T18:30:00.000Z"); // Tue 4 Nov IST
    expect(refs[0].summary).toContain("4 Nov 2025");
  });

  it("resolves 'yesterday' across a timezone boundary", () => {
    // 2025-11-06T19:00:00Z is 2025-11-07 00:30 IST — "yesterday" is 6 Nov local, not UTC.
    const refs = resolve("yesterday we talked about pricing", "2025-11-06T19:00:00Z");
    expect(refs[0].startUtc).toBe("2025-11-05T18:30:00.000Z"); // 6 Nov local midnight IST
    expect(refs[0].summary).toContain("6 Nov 2025");
  });

  it("resolves 'November 3' in the user's timezone, not UTC", () => {
    // Asked at 2025-11-03T19:30:00Z = 2025-11-04 01:00 IST. Nov 3 is still a valid past date.
    const refs = resolve("What did we discuss on November 3?", "2025-11-03T19:30:00Z");
    expect(refs).toHaveLength(1);
    expect(refs[0].startUtc).toBe("2025-11-02T18:30:00.000Z");
  });

  it("resolves 'November 3' to the previous year when it is in the future", () => {
    // Asked in January, "March 15" of this year is still ahead → previous year.
    const refs = resolve("What did we discuss on March 15?", "2025-01-10T10:00:00Z");
    expect(refs[0].summary).toContain("2024");
  });

  it("supports '3 November' and 'Nov 3rd' orderings", () => {
    expect(resolve("we met 3 November", "2025-11-06T10:00:00Z")[0].summary).toContain("3 Nov 2025");
    expect(resolve("we met on Nov 3rd", "2025-11-06T10:00:00Z")[0].summary).toContain("3 Nov 2025");
  });

  it("resolves 'since last Tuesday' as a range up to the end of today", () => {
    const refs = resolve("Has anything changed since last Tuesday?", "2025-11-06T10:00:00Z");
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe("since_relative");
    expect(refs[0].startUtc).toBe("2025-11-03T18:30:00.000Z");
    expect(new Date(refs[0].endUtc).getTime()).toBeGreaterThan(new Date("2025-11-06T10:00:00Z").getTime());
  });

  it("resolves 'three months ago' to a single day", () => {
    const refs = resolve("What did I ask you three months ago?", "2025-11-06T10:00:00Z");
    expect(refs[0].startUtc).toBe("2025-08-05T18:30:00.000Z");
    expect(refs[0].summary).toContain("6 Aug 2025");
  });

  it("resolves 'last week' to the previous Mon-Sun period", () => {
    const refs = resolve("what happened last week", "2025-11-06T10:00:00Z"); // Thursday
    expect(refs[0].startUtc).toBe("2025-10-26T18:30:00.000Z"); // Mon 27 Oct IST
    expect(refs[0].endUtc).toBe("2025-11-02T18:30:00.000Z"); // Mon 3 Nov IST (exclusive)
  });

  it("resolves 'earlier this month' from the 1st until now", () => {
    const refs = resolve("earlier this month we shortlisted CRMs", "2025-11-06T10:00:00Z");
    expect(refs[0].startUtc).toBe("2025-10-31T18:30:00.000Z"); // 1 Nov IST
    expect(refs[0].kind).toBe("this_period");
  });

  it("resolves ISO dates exactly", () => {
    const refs = resolve("check the news from 2025-11-03", "2025-11-06T10:00:00Z");
    expect(refs[0].startUtc).toBe("2025-11-02T18:30:00.000Z");
    expect(refs[0].confidence).toBe("exact");
  });

  it("resolves 'since Monday' from a Thursday to that Monday", () => {
    const refs = resolve("since Monday anything new?", "2025-11-06T10:00:00Z");
    expect(refs[0].summary).toContain("3 Nov 2025");
  });

  it("returns nothing for texts without temporal expressions", () => {
    expect(resolve("What is the difference between SQL and NoSQL?", "2025-11-06T10:00:00Z")).toHaveLength(0);
    expect(resolve("may the force be with you", "2025-11-06T10:00:00Z")).toHaveLength(0);
  });

  it("never resolves future weekdays as 'on Monday' (strictly past)", () => {
    // Friday 2025-11-07; "on Monday" = 3 Nov, not the upcoming 10 Nov.
    const refs = resolve("What did I ask you on Monday?", "2025-11-07T10:00:00Z");
    expect(refs[0].startUtc).toBe("2025-11-02T18:30:00.000Z");
  });

  it("respects a second timezone (UTC boundary sanity)", () => {
    const refs = resolveTemporalReferences("yesterday", new Date("2025-11-06T00:30:00Z"), "UTC");
    expect(refs[0].startUtc).toBe("2025-11-05T00:00:00.000Z");
  });

  it("marks 'today' as present_anchor alongside historical dates or live price checks", () => {
    const combined = resolve("What did I ask you on 3 November? Is your answer still correct today?", "2025-11-06T10:00:00Z");
    expect(combined.find((r) => r.matchedText === "3 November")?.role).toBe("historical");
    expect(combined.find((r) => r.matchedText === "today")?.role).toBe("present_anchor");

    const livePrice = resolve("What does Neon cost today?", "2025-11-06T10:00:00Z");
    expect(livePrice[0].role).toBe("present_anchor");

    const recallToday = resolve("What did I ask you today?", "2025-11-06T10:00:00Z");
    expect(recallToday[0].role).toBe("historical");
  });

  it("parses month-day with explicit year and rejects invalid calendar dates", () => {
    const explicitYear = resolve("On November 3, 2025 we checked pricing", "2026-11-06T10:00:00Z");
    expect(explicitYear).toHaveLength(1);
    expect(explicitYear[0].startUtc).toBe("2025-11-02T18:30:00.000Z");
    expect(explicitYear[0].role).toBe("historical");

    expect(resolve("What happened on February 30?", "2025-11-06T10:00:00Z")).toHaveLength(0);
  });
});
