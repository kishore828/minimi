/**
 * Timezone-aware date arithmetic built on the standard Intl API.
 *
 * Why hand-rolled instead of a library: temporal reasoning is a signature
 * feature of Memento and we need deterministic, well-tested behavior at
 * timezone boundaries (e.g. resolving "November 3" in Asia/Kolkata at
 * 00:30 local time). The helpers below keep all arithmetic on *calendar
 * values* in the target zone and convert to/from UTC instants explicitly.
 */

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
}


const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `date` as seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  return {
    year,
    month,
    day,
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayOf(year, month, day),
  };
}

/** Weekday (0=Sun..6=Sat) for a calendar date — timezone-independent. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert wall-clock time in `timeZone` to the corresponding UTC instant.
 * Iterates to a fixed point because offsets can shift around DST transitions.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = naive;
  for (let i = 0; i < 3; i++) {
    const offset = tzOffsetMs(new Date(ts), timeZone);
    ts = naive - offset;
  }
  return new Date(ts);
}

/** UTC instant of local midnight that begins the local day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedTimeToUtc(timeZone, p.year, p.month, p.day);
}

/** UTC instant one local day after `startOfLocalDay(date)`. */
export function endOfLocalDay(date: Date, timeZone: string): Date {
  return addLocalDays(startOfLocalDay(date, timeZone), 1);
}

/** Adds `days` (can be fractional-free negative) as exact 24h steps. */
export function addLocalDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

export function addCalendarMonths(timeZone: string, year: number, month: number, day: number, months: number): {
  year: number;
  month: number;
  day: number;
} {
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  const lastDay = daysInMonth(newYear, newMonth);
  return { year: newYear, month: newMonth, day: Math.min(day, lastDay) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Most recent Monday-on-or-before the local day of `date`. */
export function startOfLocalWeek(date: Date, timeZone: string): Date {
  const parts = getZonedParts(date, timeZone);
  const backToMonday = (parts.weekday + 6) % 7; // Monday=0
  return addLocalDays(startOfLocalDay(date, timeZone), -backToMonday);
}

/** "Mon, 03 Nov 2025" style formatting in the target timezone. */
export function formatLocalDate(instant: Date, timeZone: string): string {
  const p = getZonedParts(instant, timeZone);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${p.day} ${monthNames[p.month - 1]} ${p.year}`;
}
