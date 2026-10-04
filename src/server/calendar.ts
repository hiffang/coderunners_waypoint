import "server-only";
import { db } from "@/server/db";
import { addDays, isBeforeCutoff, localDate, now } from "@/server/time";

/** Orders close at this local time for the next operating day's run. Exactly 16:00 is closed. */
export const ORDER_CUTOFF = "16:00";

export type CalendarSource = "supplied" | "derived";

export type ServiceDay = {
  date: string;
  isOperating: boolean;
  isoYear: number;
  isoWeek: number;
  /** "derived" = outside the supplied calendar.csv range; Mon-Sat operating rule applied. */
  source: CalendarSource;
  festival: string | null;
  isHoliday: boolean;
};

export type CalendarLookup = (date: string) => ServiceDay;

/** ISO-8601 week of a YYYY-MM-DD date (pure; the date is a local calendar date). */
export function isoWeekOf(date: string): { isoYear: number; isoWeek: number } {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7; // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dow + 3); // Thursday of this week
  const isoYear = t.getUTCFullYear();
  const dayOfYear = (t.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1;
  return { isoYear, isoWeek: Math.ceil(dayOfYear / 7) };
}

/** Documented fallback for dates the supplied calendar does not cover: Monday-Saturday operate. */
export function derivedDay(date: string): ServiceDay {
  const [y, m, d] = date.split("-").map(Number);
  const isSunday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
  return { date, isOperating: !isSunday, ...isoWeekOf(date), source: "derived", festival: null, isHoliday: false };
}

/** First operating day strictly after `date`. */
export function nextOperatingDay(date: string, lookup: CalendarLookup): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (lookup(d).isOperating) return d;
  throw new Error(`No operating day within 60 days after ${date}`);
}

/**
 * Earliest run an order received at server instant `at` can join.
 * A run's queue closes at 16:00 on the operating day before it.
 *   Fri 15:59 -> Sat, Fri 16:00 -> Mon, Sat 15:59 -> Mon, Sat 16:00 -> Tue, Sun -> Tue.
 * Pure given `lookup`; never pass a device timestamp as `at`.
 */
export function earliestEligibleDate(at: Date, lookup: CalendarLookup): string {
  const today = localDate(at);
  const cutoffDay =
    lookup(today).isOperating && isBeforeCutoff(today, ORDER_CUTOFF, at) ? today : nextOperatingDay(today, lookup);
  return nextOperatingDay(cutoffDay, lookup);
}

/** Server-side order acceptance: requested date, adjusted forward to the earliest eligible run. */
export function resolveServiceDate(requestedDate: string, at: Date, lookup: CalendarLookup) {
  const earliest = earliestEligibleDate(at, lookup);
  const requestedDay = lookup(requestedDate);
  return {
    earliestEligibleDate: earliest,
    requestedIsOperating: requestedDay.isOperating,
    tooEarly: requestedDate < earliest,
  };
}

/**
 * Load a lookup backed by CalendarDay rows for [from, from + days]. Dates not
 * in the supplied calendar use `derivedDay`.
 */
export async function loadCalendar(from: string = localDate(now()), days = 60): Promise<CalendarLookup> {
  const to = addDays(from, days);
  const rows = await db.calendarDay.findMany({ where: { date: { gte: addDays(from, -7), lte: to } } });
  const map = new Map<string, ServiceDay>(
    rows.map((r) => [
      r.date,
      {
        date: r.date,
        isOperating: r.isOperating,
        isoYear: r.isoYear,
        isoWeek: r.isoWeek,
        source: "supplied" as const,
        festival: r.festival,
        isHoliday: r.isHoliday,
      },
    ]),
  );
  return (date) => map.get(date) ?? derivedDay(date);
}
