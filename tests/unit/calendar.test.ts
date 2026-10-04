import { describe, expect, it } from "vitest";
import { derivedDay, earliestEligibleDate, isoWeekOf, nextOperatingDay, type CalendarLookup } from "@/server/calendar";

// Colombo is UTC+05:30: 16:00 local = 10:30Z.
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const normal: CalendarLookup = derivedDay;

describe("order cutoff (16:00 Asia/Colombo, exactly 16:00 is closed)", () => {
  // 2026-09-25 is a Friday.
  it.each([
    ["Fri 15:59", "2026-09-25", "15:59", "2026-09-26"],
    ["Fri 16:00", "2026-09-25", "16:00", "2026-09-28"],
    ["Sat 15:59", "2026-09-26", "15:59", "2026-09-28"],
    ["Sat 16:00", "2026-09-26", "16:00", "2026-09-29"],
    ["Sun morning", "2026-09-27", "09:00", "2026-09-29"],
    ["Mon 00:10", "2026-09-28", "00:10", "2026-09-29"],
  ])("%s -> %s", (_label, date, time, expected) => {
    expect(earliestEligibleDate(local(date, time), normal)).toBe(expected);
  });

  it("uses the Colombo date, not the UTC date", () => {
    // 2026-09-25T19:00Z is Sat 00:30 in Colombo.
    expect(earliestEligibleDate(new Date("2026-09-25T19:00:00Z"), normal)).toBe("2026-09-28");
  });

  it("skips supplied non-operating days (2026-04-13/14 New Year)", () => {
    const holidays = new Set(["2026-04-13", "2026-04-14"]);
    const lookup: CalendarLookup = (d) => ({ ...derivedDay(d), isOperating: derivedDay(d).isOperating && !holidays.has(d), source: "supplied" });
    // Sat 11 April 15:00 -> Mon 13 closed, Tue 14 closed -> Wed 15.
    expect(earliestEligibleDate(local("2026-04-11", "15:00"), lookup)).toBe("2026-04-15");
    // Sat 11 April 16:00: next cutoff is Wed 15 16:00 -> Thu 16.
    expect(earliestEligibleDate(local("2026-04-11", "16:00"), lookup)).toBe("2026-04-16");
    expect(nextOperatingDay("2026-04-12", lookup)).toBe("2026-04-15");
  });
});

describe("calendar fallback", () => {
  it("marks Sundays closed and flags derived days", () => {
    expect(derivedDay("2026-09-27")).toMatchObject({ isOperating: false, source: "derived" });
    expect(derivedDay("2026-09-26")).toMatchObject({ isOperating: true, isoYear: 2026, isoWeek: 39 });
  });

  it.each([
    ["2024-01-01", 2024, 1],
    ["2024-12-30", 2025, 1],
    ["2026-01-01", 2026, 1],
    ["2027-01-01", 2026, 53],
    ["2026-06-28", 2026, 26],
  ])("ISO week of %s", (date, isoYear, isoWeek) => {
    expect(isoWeekOf(date)).toEqual({ isoYear, isoWeek });
  });
});
