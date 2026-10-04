/**
 * Parse and validate the organizer master CSVs in data/general/.
 * Pure (no DB) so it is unit-tested; prisma/seed.ts writes the result.
 * Any unknown header, enum value, malformed number or count mismatch throws:
 * we never guess or fabricate master data.
 */

export const EXPECTED_HEADERS = {
  outlets: [
    "outlet_id", "brand", "district", "depot", "dock_type", "parking_constraint",
    "mall_window", "window_open_time", "window_close_time",
  ],
  vehicles: [
    "vehicle_id", "type", "temp", "weight_cap_kg", "volume_cap_m3", "fuel_type",
    "km_per_l", "weekly_fuel_quota_l", "depot",
  ],
  calendar: [
    "date", "dow", "dow_name", "is_weekend", "iso_year", "iso_week", "is_payday",
    "festival", "festival_ramp", "is_holiday", "monsoon", "is_operating",
  ],
} as const;

/** Counts stated in the booklet / TEAM_CONTRACT section 1. */
export const EXPECTED_COUNTS = {
  outlets: 120,
  vehicles: 60,
  depots: ["Peliyagoda", "Kandy"],
  refrigeratedTrucks: 12,
  dryTrucks: 40,
  vans: 8,
  refrigeratedVans: 4,
};

export type Row = Record<string, string>;

export function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("CSV is empty");
  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line, i) => {
    const cells = splitLine(line);
    if (cells.length !== headers.length) {
      throw new Error(`Row ${i + 2}: expected ${headers.length} cells, got ${cells.length}`);
    }
    return Object.fromEntries(headers.map((h, j) => [h, cells[j].trim()]));
  });
  return { headers, rows };
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function assertHeaders(file: keyof typeof EXPECTED_HEADERS, headers: string[]) {
  const expected = EXPECTED_HEADERS[file];
  const missing = expected.filter((h) => !headers.includes(h));
  const extra = headers.filter((h) => !(expected as readonly string[]).includes(h));
  if (missing.length || extra.length) {
    throw new Error(`${file}.csv headers mismatch. missing=[${missing}] unexpected=[${extra}]`);
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function hhmm(v: string, ctx: string) {
  if (!HHMM.test(v)) throw new Error(`${ctx}: invalid HH:mm "${v}"`);
  return v;
}

function num(v: string, ctx: string, { positive = false } = {}) {
  const n = Number(v);
  if (v === "" || !Number.isFinite(n) || (positive ? n <= 0 : n < 0)) throw new Error(`${ctx}: invalid number "${v}"`);
  return n;
}

function bit(v: string, ctx: string) {
  if (v !== "0" && v !== "1") throw new Error(`${ctx}: expected 0/1, got "${v}"`);
  return v === "1";
}

function mapEnum<T extends string>(v: string, map: Record<string, T>, ctx: string): T {
  const out = map[v];
  if (!out) throw new Error(`${ctx}: unknown value "${v}" (allowed: ${Object.keys(map).join(", ")})`);
  return out;
}

export type OutletRecord = {
  id: string;
  brand: "FRESH" | "STYLE" | "TECH";
  district: string;
  depot: string;
  dockType: "STREET" | "REAR_DOCK" | "MALL_BAY";
  parkingConstraint: "NORMAL" | "VAN_ONLY" | "MALL_DOCK";
  windowOpen: string;
  windowClose: string;
  mallWindowOpen: string | null;
  mallWindowClose: string | null;
  raw: Row;
};

export function mapOutlets(rows: Row[]): OutletRecord[] {
  const out = rows.map((r) => {
    const ctx = `outlets.csv ${r.outlet_id}`;
    if (!/^OUT\d{3}$/.test(r.outlet_id)) throw new Error(`${ctx}: invalid outlet_id`);
    let mallWindowOpen: string | null = null;
    let mallWindowClose: string | null = null;
    if (r.mall_window) {
      const [a, b] = r.mall_window.split("-");
      mallWindowOpen = hhmm(a ?? "", ctx);
      mallWindowClose = hhmm(b ?? "", ctx);
    }
    const parkingConstraint = mapEnum(r.parking_constraint, { normal: "NORMAL", van_only: "VAN_ONLY", mall_dock: "MALL_DOCK" } as const, ctx);
    if (parkingConstraint === "MALL_DOCK" && !mallWindowOpen) throw new Error(`${ctx}: mall_dock outlet without mall_window`);
    const windowOpen = hhmm(r.window_open_time, ctx);
    const windowClose = hhmm(r.window_close_time, ctx);
    if (windowOpen >= windowClose) throw new Error(`${ctx}: window opens after it closes`);
    if (!r.district) throw new Error(`${ctx}: missing district`);
    return {
      id: r.outlet_id,
      brand: mapEnum(r.brand, { Fresh: "FRESH", Style: "STYLE", Tech: "TECH" } as const, ctx),
      district: r.district,
      depot: r.depot,
      dockType: mapEnum(r.dock_type, { street: "STREET", rear_dock: "REAR_DOCK", mall_bay: "MALL_BAY" } as const, ctx),
      parkingConstraint,
      windowOpen,
      windowClose,
      mallWindowOpen,
      mallWindowClose,
      raw: r,
    };
  });
  assertUnique(out.map((o) => o.id), "outlets.csv outlet_id");
  if (out.length !== EXPECTED_COUNTS.outlets) throw new Error(`outlets.csv: expected ${EXPECTED_COUNTS.outlets} rows, got ${out.length}`);
  assertDepots(out.map((o) => o.depot), "outlets.csv");
  return out;
}

export type VehicleRecord = {
  id: string;
  depot: string;
  type: "TRUCK" | "VAN";
  refrigerated: boolean;
  weightCapKg: number;
  volumeCapM3: number;
  fuelType: string;
  kmPerLiter: number;
  fuelLitersPerKm: number;
  weeklyFuelQuotaLiters: number;
  raw: Row;
};

export function mapVehicles(rows: Row[]): VehicleRecord[] {
  const out = rows.map((r) => {
    const ctx = `vehicles.csv ${r.vehicle_id}`;
    if (!/^VEH\d{3}$/.test(r.vehicle_id)) throw new Error(`${ctx}: invalid vehicle_id`);
    const kmPerLiter = num(r.km_per_l, ctx, { positive: true });
    return {
      id: r.vehicle_id,
      depot: r.depot,
      type: mapEnum(r.type, { truck: "TRUCK", van: "VAN" } as const, ctx),
      refrigerated: mapEnum(r.temp, { reefer: "yes", ambient: "no" } as const, ctx) === "yes",
      weightCapKg: num(r.weight_cap_kg, ctx, { positive: true }),
      volumeCapM3: num(r.volume_cap_m3, ctx, { positive: true }),
      fuelType: mapEnum(r.fuel_type, { diesel: "diesel" } as const, ctx),
      kmPerLiter,
      // Converted once here; fuel elsewhere is always liters.
      fuelLitersPerKm: Number((1 / kmPerLiter).toFixed(6)),
      weeklyFuelQuotaLiters: num(r.weekly_fuel_quota_l, ctx, { positive: true }),
      raw: r,
    };
  });
  assertUnique(out.map((v) => v.id), "vehicles.csv vehicle_id");
  const c = EXPECTED_COUNTS;
  const count = (f: (v: VehicleRecord) => boolean) => out.filter(f).length;
  const checks: Array<[string, number, number]> = [
    ["vehicles", out.length, c.vehicles],
    ["refrigerated trucks", count((v) => v.type === "TRUCK" && v.refrigerated), c.refrigeratedTrucks],
    ["dry trucks", count((v) => v.type === "TRUCK" && !v.refrigerated), c.dryTrucks],
    ["vans", count((v) => v.type === "VAN"), c.vans],
    ["refrigerated vans", count((v) => v.type === "VAN" && v.refrigerated), c.refrigeratedVans],
  ];
  for (const [label, got, want] of checks) {
    if (got !== want) throw new Error(`vehicles.csv: expected ${want} ${label}, got ${got}`);
  }
  assertDepots(out.map((v) => v.depot), "vehicles.csv");
  return out;
}

export type CalendarRecord = {
  date: string;
  dow: number;
  isWeekend: boolean;
  isoYear: number;
  isoWeek: number;
  isPayday: boolean;
  festival: string | null;
  festivalRamp: number;
  isHoliday: boolean;
  monsoon: boolean;
  isOperating: boolean;
};

export function mapCalendar(rows: Row[]): CalendarRecord[] {
  const out = rows.map((r) => {
    const ctx = `calendar.csv ${r.date}`;
    if (!DATE.test(r.date)) throw new Error(`${ctx}: invalid date`);
    const dow = num(r.dow, ctx);
    if (!Number.isInteger(dow) || dow > 6) throw new Error(`${ctx}: invalid dow`);
    return {
      date: r.date,
      dow,
      isWeekend: bit(r.is_weekend, ctx),
      isoYear: num(r.iso_year, ctx),
      isoWeek: num(r.iso_week, ctx),
      isPayday: bit(r.is_payday, ctx),
      festival: r.festival || null,
      festivalRamp: num(r.festival_ramp, ctx),
      isHoliday: bit(r.is_holiday, ctx),
      monsoon: bit(r.monsoon, ctx),
      isOperating: bit(r.is_operating, ctx),
    };
  });
  assertUnique(out.map((d) => d.date), "calendar.csv date");
  if (out.some((d) => d.dow === 6 && d.isOperating)) throw new Error("calendar.csv: Sunday marked operating");
  return out;
}

function assertUnique(values: string[], ctx: string) {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) throw new Error(`${ctx}: duplicate ${v}`);
    seen.add(v);
  }
}

function assertDepots(values: string[], ctx: string) {
  const unknown = [...new Set(values)].filter((d) => !EXPECTED_COUNTS.depots.includes(d));
  if (unknown.length) throw new Error(`${ctx}: unknown depot(s) ${unknown.join(", ")}`);
}
