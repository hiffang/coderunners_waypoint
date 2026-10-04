import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertHeaders, mapCalendar, mapOutlets, mapVehicles, parseCsv } from "../../prisma/lib/masters";
import { isoWeekOf } from "@/server/calendar";

const load = (f: "outlets" | "vehicles" | "calendar") => {
  const parsed = parseCsv(readFileSync(path.resolve(__dirname, `../../data/general/${f}.csv`), "utf8"));
  assertHeaders(f, parsed.headers);
  return parsed.rows;
};

describe("organizer master CSVs", () => {
  it("imports 120 outlets with canonical enums", () => {
    const outlets = mapOutlets(load("outlets"));
    expect(outlets).toHaveLength(120);
    const out001 = outlets.find((o) => o.id === "OUT001")!;
    expect(out001).toMatchObject({ brand: "FRESH", parkingConstraint: "VAN_ONLY", windowOpen: "05:00", windowClose: "07:30" });
    const mall = outlets.filter((o) => o.parkingConstraint === "MALL_DOCK");
    expect(mall.every((o) => o.mallWindowOpen && o.mallWindowClose)).toBe(true);
  });

  it("imports 60 vehicles: 12 reefer trucks, 40 dry trucks, 8 vans (4 reefer)", () => {
    const vehicles = mapVehicles(load("vehicles"));
    expect(vehicles).toHaveLength(60);
    expect(vehicles.filter((v) => v.refrigerated)).toHaveLength(16);
    const v = vehicles.find((x) => x.id === "VEH035")!;
    expect(v).toMatchObject({ type: "VAN", refrigerated: true, kmPerLiter: 10.3 });
    expect(v.fuelLitersPerKm).toBeCloseTo(1 / 10.3, 6);
  });

  it("imports the calendar and its ISO weeks agree with isoWeekOf", () => {
    const days = mapCalendar(load("calendar"));
    expect(days.length).toBeGreaterThan(900);
    for (const d of days) expect(isoWeekOf(d.date)).toEqual({ isoYear: d.isoYear, isoWeek: d.isoWeek });
    expect(days.filter((d) => d.dow === 6).every((d) => !d.isOperating)).toBe(true);
  });

  it("rejects unknown enum values, bad headers and count mismatches", () => {
    const rows = load("outlets");
    expect(() => mapOutlets([{ ...rows[0], parking_constraint: "tiny" }, ...rows.slice(1)])).toThrow(/unknown value "tiny"/);
    expect(() => mapOutlets(rows.slice(1))).toThrow(/expected 120 rows/);
    expect(() => assertHeaders("outlets", ["outlet_id"])).toThrow(/headers mismatch/);
    const vehicles = load("vehicles");
    expect(() => mapVehicles(vehicles.map((v) => (v.vehicle_id === "VEH035" ? { ...v, temp: "ambient" } : v)))).toThrow(/refrigerated vans/);
  });

  it("handles quoted CSV cells", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n').rows).toEqual([{ a: "x, y", b: 'say "hi"' }]);
  });
});
