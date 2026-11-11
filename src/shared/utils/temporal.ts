/**
 * Deterministic temporal expression parser.
 *
 * The agent never asks the LLM to compute dates. This module turns phrases
 * like "last Tuesday", "since November 3" or "three months ago" into exact
 * UTC ranges resolved in the configured application timezone. The planner
 * receives these resolved ranges as ground truth alongside the raw text.
 *
 * Semantics:
 *  - Single-day references resolve to [dayStart, dayStart + 24h).
 *  - Period references ("last week", "this month") resolve to the full period.
 *  - "since X" resolves to [startOf(X), endOfToday] — everything from then
 *    until now, which is what memory retrieval needs.
 *  - "last <weekday>" is always strictly before today (if today is Tuesday,
 *    "last Tuesday" means a week ago). Same rule for "on <weekday>".
 *  - Bare "November 3" uses the current year; if that date is still in the
 *    future it falls back to the previous year.
 */

import type { ZonedParts } from "./timezone";
import {
  addCalendarMonths,
  addLocalDays,
  daysInMonth,
  endOfLocalDay,
  formatLocalDate,
  getZonedParts,
  startOfLocalDay,
  startOfLocalWeek,
  zonedTimeToUtc,
} from "./timezone";

export interface TemporalReference {
  matchedText: string;
  kind: string;
  /** Whether the phrase points to historical conversation time or anchors the present ("correct today?"). */
  role: "historical" | "present_anchor";
  /** Inclusive UTC start. */
  startUtc: string;
  /** Exclusive UTC end. */
  endUtc: string;
  confidence: "exact" | "approximate";
  /** Human-readable description, e.g. "3 Nov 2025" or "6–12 Oct 2025". */
  summary: string;
}

interface ResolvedRange {
  kind: string;
  start: Date;
  end: Date;
  confidence: "exact" | "approximate";
  summary: string;
}

interface TemporalContext {
  timeZone: string;
  todayParts: ZonedParts;
  todayStart: Date;
  todayEnd: Date;
}

const MONTH_TOKENS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const WEEKDAY_TOKENS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTH_DAY =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY = "(?:sun(?:day)?|mon(?:day)?|tues?(?:day)?|weds?(?:nesday)?|thurs?(?:day)?|fri(?:day)?|sat(?:urday)?)";
const ORDINAL = "(?:st|nd|rd|th)";

const MONTH_DAY_RE = new RegExp(MONTH_DAY, "i");

function weekdayNumberFrom(token: string): number | null {
  const entry = Object.entries(WEEKDAY_TOKENS).find(([key]) => token.startsWith(key));
  return entry ? entry[1] : null;
}

function daysBackToWeekday(currentWeekday: number, targetWeekday: number): number {
  let back = (currentWeekday - targetWeekday + 7) % 7;
  if (back === 0) back = 7; // "last Tuesday" said on a Tuesday means a week ago
  return back;
}

function localDayOf(ctx: TemporalContext, daysBack: number): Date {
  return addLocalDays(ctx.todayStart, -daysBack);
}

function dayRange(start: Date, summary: string, kind: string, confidence: "exact" | "approximate"): ResolvedRange {
  return { kind, start, end: addLocalDays(start, 1), confidence, summary };
}

interface Matcher {
  name: string;
  pattern: RegExp;
  resolve: (match: RegExpMatchArray, ctx: TemporalContext) => ResolvedRange | null;
}

const MATCHERS: Matcher[] = [
  /* 1. "since <relative>" — everything from that point until now. */
  {
    name: "since_relative",
    pattern: new RegExp(
      `\\bsince\\s+(yesterday|today|last\\s+${WEEKDAY}|${WEEKDAY}|last\\s+week|last\\s+month|last\\s+year)\\b`,
      "gi",
    ),
    resolve: (match, ctx) => {
      const inner = match[1].toLowerCase().trim();
      let start: Date;
      let summary: string;
      if (inner === "yesterday") {
        start = localDayOf(ctx, 1);
        summary = formatLocalDate(start, ctx.timeZone);
      } else if (inner === "today") {
        start = ctx.todayStart;
        summary = formatLocalDate(start, ctx.timeZone);
      } else if (inner.startsWith("last")) {
        const tail = inner.replace(/^last\s+/, "");
        if (tail === "week") {
          const thisMonday = startOfLocalWeek(ctx.todayStart, ctx.timeZone);
          start = addLocalDays(thisMonday, -7);
          summary = `week of ${formatLocalDate(start, ctx.timeZone)}`;
        } else if (tail === "month") {
          const p = addCalendarMonths(ctx.timeZone, ctx.todayParts.year, ctx.todayParts.month, 1, -1);
          start = zonedTimeToUtc(ctx.timeZone, p.year, p.month, 1);
          summary = `${formatLocalDate(start, ctx.timeZone)} (month start)`;
        } else {
          const weekday = weekdayNumberFrom(tail);
          if (weekday === null) return null;
          const back = daysBackToWeekday(ctx.todayParts.weekday, weekday);
          start = localDayOf(ctx, back);
          summary = formatLocalDate(start, ctx.timeZone);
        }
      } else {
        const weekday = weekdayNumberFrom(inner);
        if (weekday === null) return null;
        const back = daysBackToWeekday(ctx.todayParts.weekday, weekday);
        start = localDayOf(ctx, back);
        summary = formatLocalDate(start, ctx.timeZone);
      }
      return {
        kind: "since_relative",
        start,
        end: ctx.todayEnd,
        confidence: "approximate",
        summary: `since ${summary}`,
      };
    },
  },

  /* 2. ISO date: 2025-11-03 */
  {
    name: "iso_date",
    pattern: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g,
    resolve: (match, ctx) => {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
      const start = zonedTimeToUtc(ctx.timeZone, year, month, day);
      return dayRange(start, formatLocalDate(start, ctx.timeZone), "iso_date", "exact");
    },
  },

  /* 3. "November 3" / "Nov 3rd" / "3 November" / "November 3, 2025" */
  {
    name: "month_day",
    pattern: new RegExp(
      `\\b(?:${MONTH_DAY})\\.?\\s+(\\d{1,2})${ORDINAL}?(?:,?\\s+(20\\d{2}))?\\b|\\b(\\d{1,2})${ORDINAL}?\\s+(?:of\\s+)?(${MONTH_DAY})\\.?(?:,?\\s+(20\\d{2}))?\\b`,
      "gi",
    ),
    resolve: (match, ctx) => {
      const monthToken = (match[1] ? MONTH_DAY_RE.exec(match[0]) : MONTH_DAY_RE.exec(match[4] ?? ""))?.[0]?.toLowerCase();
      const day = match[1] ? Number(match[1]) : Number(match[3]);
      const explicitYearRaw = match[2] ?? match[5];
      if (!monthToken) return null;
      const month = MONTH_TOKENS[monthToken.replace(/[^a-z]/g, "")];
      if (!month || day < 1 || day > 31) return null;
      let year = explicitYearRaw ? Number(explicitYearRaw) : ctx.todayParts.year;
      if (day > daysInMonth(year, month)) return null;
      let candidate = zonedTimeToUtc(ctx.timeZone, year, month, day);
      // Bare month-day in the future means the previous year.
      if (!explicitYearRaw && candidate.getTime() > ctx.todayEnd.getTime()) {
        year -= 1;
        if (day > daysInMonth(year, month)) return null;
        candidate = zonedTimeToUtc(ctx.timeZone, year, month, day);
      }
      return dayRange(candidate, formatLocalDate(candidate, ctx.timeZone), "month_day", explicitYearRaw ? "exact" : "approximate");
    },
  },

  /* 4. "3 days ago" / "two weeks ago" / "a month ago" */
  {
    name: "n_units_ago",
    pattern: /\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month)s?\s+ago\b/gi,
    resolve: (match, ctx) => {
      const rawNumber = match[1].toLowerCase();
      const n = /^\d+$/.test(rawNumber) ? Number(rawNumber) : NUMBER_WORDS[rawNumber];
      if (!n || n < 1 || n > 24) return null;
      const unit = match[2].toLowerCase();
      let start: Date;
      if (unit === "day") {
        start = localDayOf(ctx, n);
      } else if (unit === "week") {
        start = localDayOf(ctx, n * 7);
      } else {
        const p = addCalendarMonths(ctx.timeZone, ctx.todayParts.year, ctx.todayParts.month, ctx.todayParts.day, -n);
        start = zonedTimeToUtc(ctx.timeZone, p.year, p.month, p.day);
      }
      return dayRange(start, formatLocalDate(start, ctx.timeZone), "n_units_ago", "approximate");
    },
  },

  /* 5. "yesterday" / "today" */
  {
    name: "named_day",
    pattern: /\b(yesterday|today)\b/gi,
    resolve: (match, ctx) => {
      const isYesterday = match[1].toLowerCase() === "yesterday";
      const start = isYesterday ? localDayOf(ctx, 1) : ctx.todayStart;
      return dayRange(start, formatLocalDate(start, ctx.timeZone), "named_day", "exact");
    },
  },

  /* 6. "last Tuesday" */
  {
    name: "last_weekday",
    pattern: new RegExp(`\\blast\\s+(${WEEKDAY})\\b`, "gi"),
    resolve: (match, ctx) => {
      const weekday = weekdayNumberFrom(match[1].toLowerCase());
      if (weekday === null) return null;
      const back = daysBackToWeekday(ctx.todayParts.weekday, weekday);
      const start = localDayOf(ctx, back);
      return dayRange(start, formatLocalDate(start, ctx.timeZone), "last_weekday", "exact");
    },
  },

  /* 7. "on Monday" — most recent past occurrence of that weekday. */
  {
    name: "on_weekday",
    pattern: new RegExp(`\\bon\\s+(${WEEKDAY})\\b`, "gi"),
    resolve: (match, ctx) => {
      const weekday = weekdayNumberFrom(match[1].toLowerCase());
      if (weekday === null) return null;
      const back = daysBackToWeekday(ctx.todayParts.weekday, weekday);
      const start = localDayOf(ctx, back);
      return dayRange(start, formatLocalDate(start, ctx.timeZone), "on_weekday", "exact");
    },
  },

  /* 8. "last week" / "last month" / "last year" — previous full calendar period. */
  {
    name: "last_period",
    pattern: /\blast\s+(week|month|year)\b/gi,
    resolve: (match, ctx) => {
      const period = match[1].toLowerCase();
      if (period === "week") {
        const start = addLocalDays(startOfLocalWeek(ctx.todayStart, ctx.timeZone), -7);
        const end = addLocalDays(start, 7);
        return {
          kind: "last_period",
          start,
          end,
          confidence: "approximate",
          summary: `${formatLocalDate(start, ctx.timeZone)} – ${formatLocalDate(addLocalDays(end, -1), ctx.timeZone)}`,
        };
      }
      if (period === "month") {
        const p = addCalendarMonths(ctx.timeZone, ctx.todayParts.year, ctx.todayParts.month, 1, -1);
        const start = zonedTimeToUtc(ctx.timeZone, p.year, p.month, 1);
        const end = zonedTimeToUtc(ctx.timeZone, ctx.todayParts.year, ctx.todayParts.month, 1);
        return {
          kind: "last_period",
          start,
          end,
          confidence: "approximate",
          summary: `${formatLocalDate(start, ctx.timeZone)} – ${formatLocalDate(addLocalDays(end, -1), ctx.timeZone)}`,
        };
      }
      const start = zonedTimeToUtc(ctx.timeZone, ctx.todayParts.year - 1, 1, 1);
      const end = zonedTimeToUtc(ctx.timeZone, ctx.todayParts.year, 1, 1);
      return {
        kind: "last_period",
        start,
        end,
        confidence: "approximate",
        summary: `year ${ctx.todayParts.year - 1}`,
      };
    },
  },

  /* 9. "this week" / "earlier this week" / "this month" / "this year" */
  {
    name: "this_period",
    pattern: /\b(?:earlier\s+)?this\s+(week|month|year)\b/gi,
    resolve: (match, ctx) => {
      const period = match[1].toLowerCase();
      if (period === "week") {
        const start = startOfLocalWeek(ctx.todayStart, ctx.timeZone);
        return {
          kind: "this_period",
          start,
          end: ctx.todayEnd,
          confidence: "approximate",
          summary: `this week (since ${formatLocalDate(start, ctx.timeZone)})`,
        };
      }
      if (period === "month") {
        const start = zonedTimeToUtc(ctx.timeZone, ctx.todayParts.year, ctx.todayParts.month, 1);
        return {
          kind: "this_period",
          start,
          end: ctx.todayEnd,
          confidence: "approximate",
          summary: `this month (since ${formatLocalDate(start, ctx.timeZone)})`,
        };
      }
      const start = zonedTimeToUtc(ctx.timeZone, ctx.todayParts.year, 1, 1);
      return {
        kind: "this_period",
        start,
        end: ctx.todayEnd,
        confidence: "approximate",
        summary: `this year (since ${formatLocalDate(start, ctx.timeZone)})`,
      };
    },
  },
];

const EXPLICIT_HISTORICAL_TODAY_RE =
  /\b(earlier\s+today|what\s+did\s+(?:we|i)\s+(?:talk|discuss|ask|say|decide|shortlist)[^?.!]*\btoday\b|\btoday(?:'s)?\s+(?:conversation|chat|discussion|earlier))\b/i;

const EXPLICIT_PRESENT_TODAY_RE =
  /\b(still|correct|accurate|true|valid|current(?:ly)?|now|right now|changed?|cost|price|pricing|worth|latest|happened|news)\b.*\btoday\b|\btoday\s*[?.!]?\s*$/i;

/**
 * Find every temporal expression in `text` and resolve it deterministically.
 * Results are returned in order of appearance. Overlapping matches are
 * resolved by matcher priority (e.g. "since last Tuesday" is consumed by the
 * since-matcher, not split into separate references).
 */
export function resolveTemporalReferences(text: string, now: Date, timeZone: string): TemporalReference[] {
  const ctx: TemporalContext = {
    timeZone,
    todayParts: getZonedParts(now, timeZone),
    todayStart: startOfLocalDay(now, timeZone),
    todayEnd: endOfLocalDay(now, timeZone),
  };

  const consumed: Array<{ start: number; end: number }> = [];
  const found: Array<{ ref: Omit<TemporalReference, "role">; index: number }> = [];

  const overlaps = (start: number, end: number) =>
    consumed.some((span) => start < span.end && end > span.start);

  for (const matcher of MATCHERS) {
    matcher.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.pattern.exec(text)) !== null) {
      const spanStart = match.index;
      const spanEnd = match.index + match[0].length;
      if (overlaps(spanStart, spanEnd)) continue;
      const resolved = matcher.resolve(match, ctx);
      if (!resolved) continue;
      consumed.push({ start: spanStart, end: spanEnd });
      found.push({
        index: spanStart,
        ref: {
          matchedText: match[0],
          kind: resolved.kind,
          startUtc: resolved.start.toISOString(),
          endUtc: resolved.end.toISOString(),
          confidence: resolved.confidence,
          summary: resolved.summary,
        },
      });
    }
  }

  const hasNonTodayRef = found.some((f) => f.ref.matchedText.toLowerCase() !== "today");
  const explicitHistoricalToday = EXPLICIT_HISTORICAL_TODAY_RE.test(text);
  const explicitPresentToday = EXPLICIT_PRESENT_TODAY_RE.test(text);

  return found
    .sort((a, b) => a.index - b.index)
    .map((f) => {
      const isBareToday = f.ref.kind === "named_day" && f.ref.matchedText.toLowerCase() === "today";
      const role: TemporalReference["role"] =
        isBareToday && (hasNonTodayRef || (!explicitHistoricalToday && explicitPresentToday))
          ? "present_anchor"
          : "historical";
      return { ...f.ref, role };
    });
}
