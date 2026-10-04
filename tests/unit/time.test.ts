import { describe, expect, it } from "vitest";
import { addDays, formatHhMm, isBeforeCutoff, localDate, localMinutes, parseHhMm, zonedInstant } from "@/server/time";

describe("time helpers (Asia/Colombo, UTC+05:30)", () => {
  it("converts local wall time to the correct UTC instant", () => {
    expect(zonedInstant("2026-09-26", "18:00").toISOString()).toBe("2026-09-26T12:30:00.000Z");
  });

  it("reads local date and minutes across the UTC day boundary", () => {
    const at = new Date("2026-09-26T19:00:00Z"); // 00:30 next day in Colombo
    expect(localDate(at)).toBe("2026-09-27");
    expect(localMinutes(at)).toBe(30);
  });

  it("treats the cutoff minute itself as closed", () => {
    expect(isBeforeCutoff("2026-09-26", "18:00", new Date("2026-09-26T12:29:59Z"))).toBe(true);
    expect(isBeforeCutoff("2026-09-26", "18:00", new Date("2026-09-26T12:30:00Z"))).toBe(false);
  });

  it("parses and formats HH:MM", () => {
    expect(parseHhMm("07:05")).toBe(425);
    expect(formatHhMm(425)).toBe("07:05");
    expect(() => parseHhMm("24:00")).toThrow();
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});
