/**
 * Idempotent seed. Safe to rerun on every container start.
 *
 * 1. Master data (always): data/general/{outlets,vehicles,calendar}.csv are
 *    validated (headers, enums, counts) and upserted. Missing or malformed CSVs
 *    abort the seed; nothing is fabricated.
 * 2. Demo data (DEMO_SEED=true): role accounts and a deterministic judge
 *    scenario, insert-if-missing only. Existing passwords, orders, plans and
 *    completed deliveries are never reset.
 *
 * Scenario (Peliyagoda, see docs/SEED_AND_DEMO.md):
 *   - PREVIOUS operating day before DEMO_SERVICE_DATE: a published plan with
 *     trips, one capacity deferral and an open loading shortfall.
 *   - DEMO_SERVICE_DATE: an overloaded confirmed queue for the dispatcher to plan.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type Brand, type Role, type Temp } from "../src/generated/prisma/client";
import {
  assertHeaders,
  mapCalendar,
  mapOutlets,
  mapVehicles,
  parseCsv,
  type CalendarRecord,
  type Row,
} from "./lib/masters";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DATA_DIR = path.resolve(process.cwd(), "data/general");

export const DEPOT_IDS = { Peliyagoda: "depot-peliyagoda", Kandy: "depot-kandy" } as const;
const DEMO_VEHICLE = "VEH035"; // refrigerated van, Peliyagoda
const DEMO_OUTLET = "OUT001"; // Fresh, Colombo, van_only, 05:00-07:30

function readCsv(file: "outlets" | "vehicles" | "calendar") {
  const full = path.join(DATA_DIR, `${file}.csv`);
  let text: string;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    throw new Error(`Missing ${full}. Place the organizer General Data CSVs in data/general/.`);
  }
  const { headers, rows } = parseCsv(text);
  assertHeaders(file, headers);
  return rows;
}

async function importMasters() {
  const outlets = mapOutlets(readCsv("outlets"));
  const vehicles = mapVehicles(readCsv("vehicles"));
  const calendar = mapCalendar(readCsv("calendar"));

  for (const [name, id] of Object.entries(DEPOT_IDS)) {
    await db.depot.upsert({ where: { id }, update: { name }, create: { id, name } });
  }
  const depotId = (name: string) => DEPOT_IDS[name as keyof typeof DEPOT_IDS];

  for (const o of outlets) {
    const data = {
      brand: o.brand,
      district: o.district,
      depotId: depotId(o.depot),
      dockType: o.dockType,
      parkingConstraint: o.parkingConstraint,
      windowOpen: o.windowOpen,
      windowClose: o.windowClose,
      mallWindowOpen: o.mallWindowOpen,
      mallWindowClose: o.mallWindowClose,
      raw: o.raw as Row,
    };
    await db.outlet.upsert({ where: { id: o.id }, update: data, create: { id: o.id, ...data } });
  }

  for (const v of vehicles) {
    // Vehicle status (workshop) is operational state: set on create only.
    const data = {
      depotId: depotId(v.depot),
      type: v.type,
      refrigerated: v.refrigerated,
      weightCapKg: v.weightCapKg,
      volumeCapM3: v.volumeCapM3,
      fuelType: v.fuelType,
      kmPerLiter: v.kmPerLiter,
      fuelLitersPerKm: v.fuelLitersPerKm,
      weeklyFuelQuotaLiters: v.weeklyFuelQuotaLiters,
      raw: v.raw as Row,
    };
    await db.vehicle.upsert({ where: { id: v.id }, update: data, create: { id: v.id, ...data } });
  }

  await db.calendarDay.createMany({ data: calendar, skipDuplicates: true });

  console.log(
    `masters: ${outlets.length} outlets, ${vehicles.length} vehicles, ${calendar.length} calendar days ` +
      `(${calendar[0].date}..${calendar[calendar.length - 1].date})`,
  );
  return { calendar, vehicles };
}

// ---------------------------------------------------------------- demo

type Account = {
  username: string;
  displayName: string;
  role: Role;
  depotId: string;
  outletId?: string;
  vehicleId?: string;
};

const DEMO_ACCOUNTS: Account[] = [
  { username: "dispatcher", displayName: "Dilani Perera", role: "DISPATCHER", depotId: DEPOT_IDS.Peliyagoda },
  { username: "loader", displayName: "Lahiru Silva", role: "LOADER", depotId: DEPOT_IDS.Peliyagoda },
  { username: "driver", displayName: "Dinesh Fernando", role: "DRIVER", depotId: DEPOT_IDS.Peliyagoda, vehicleId: DEMO_VEHICLE },
  { username: "store", displayName: "Shalini Jayawardena", role: "STORE", depotId: DEPOT_IDS.Peliyagoda, outletId: DEMO_OUTLET },
  // Second depot accounts for scope-negative checks.
  { username: "dispatcher-kandy", displayName: "Kasun Bandara", role: "DISPATCHER", depotId: DEPOT_IDS.Kandy },
  { username: "loader-kandy", displayName: "Nimal Rathnayake", role: "LOADER", depotId: DEPOT_IDS.Kandy },
];

/** Local Asia/Colombo wall time (fixed UTC+05:30, no DST) to an instant. */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

function previousOperatingDay(date: string, calendar: CalendarRecord[]) {
  const byDate = new Map(calendar.map((d) => [d.date, d]));
  let d = date;
  for (let i = 0; i < 30; i++) {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    d = t.toISOString().slice(0, 10);
    const row = byDate.get(d);
    // Outside the supplied calendar: documented Mon-Sat fallback.
    const operating = row ? row.isOperating : t.getUTCDay() !== 0;
    if (operating) return d;
  }
  throw new Error(`No operating day before ${date}`);
}

function isoWeekOf(date: string) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const isoYear = t.getUTCFullYear();
  return { isoYear, isoWeek: Math.ceil(((t.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7) };
}

type LineSpec = [description: string, units: number, unitWeightKg: number, unitVolumeM3: number];
type OrderSpec = { ref: string; outletId: string; brand: Brand; temp: Temp; lines: LineSpec[] };

const FRESH_AMBIENT: LineSpec[] = [
  ["Bread loaves (tray of 12)", 20, 6, 0.04],
  ["Rice 5 kg bags", 30, 5, 0.008],
];
const FRESH_CHILLED: LineSpec[] = [
  ["Fresh milk 1 L (crate of 12)", 18, 13, 0.025],
  ["Yoghurt cups (case of 24)", 10, 3.5, 0.012],
];

/** Queue for DEMO_SERVICE_DATE: overloads the two Peliyagoda refrigerated vans. */
function demoDayOrders(yymmdd: string): OrderSpec[] {
  const r = (n: string) => `ORD-${yymmdd}-${n}`;
  return [
    // Store account's outlet: separate ambient and chilled orders, same outlet/day.
    { ref: r("D01"), outletId: "OUT001", brand: "FRESH", temp: "AMBIENT", lines: FRESH_AMBIENT },
    { ref: r("D02"), outletId: "OUT001", brand: "FRESH", temp: "CHILLED", lines: FRESH_CHILLED },
    // van_only + chilled: competes for the only two refrigerated vans.
    // With the carried-over deferral (OUT003, 540 kg) the van_only chilled load is
    // 269 + 810 + 400 + 540 kg: it cannot be packed into two 1040 kg first trips.
    { ref: r("D03"), outletId: "OUT002", brand: "FRESH", temp: "CHILLED", lines: [["Fresh milk 1 L (crate of 12)", 50, 13, 0.025], ["Cheese blocks (case)", 20, 8, 0.015]] },
    { ref: r("D04"), outletId: "OUT002", brand: "FRESH", temp: "CHILLED", lines: [["Fresh juice 1 L (case of 12)", 40, 10, 0.02]] },
    { ref: r("D05"), outletId: "OUT003", brand: "FRESH", temp: "AMBIENT", lines: [["Bottled water 5 L (pack of 4)", 40, 20.5, 0.03]] },
    // Normal-access Fresh orders.
    { ref: r("D06"), outletId: "OUT004", brand: "FRESH", temp: "CHILLED", lines: FRESH_CHILLED },
    { ref: r("D07"), outletId: "OUT004", brand: "FRESH", temp: "AMBIENT", lines: FRESH_AMBIENT },
    { ref: r("D08"), outletId: "OUT005", brand: "FRESH", temp: "AMBIENT", lines: FRESH_AMBIENT },
    { ref: r("D09"), outletId: "OUT006", brand: "FRESH", temp: "CHILLED", lines: [["Chicken portions (chilled case)", 40, 10, 0.02]] },
    // Volume-heavy Style (mall dock window 09:00-11:00).
    { ref: r("D10"), outletId: "OUT015", brand: "STYLE", temp: "AMBIENT", lines: [["Garment rail boxes", 120, 6, 0.18], ["Shoe cartons", 60, 4, 0.06]] },
    // Weight-heavy Tech.
    { ref: r("D11"), outletId: firstOutlet("TECH"), brand: "TECH", temp: "AMBIENT", lines: [["Refrigerator units", 12, 85, 0.9], ["Washing machines", 10, 70, 0.6], ["Inverter batteries", 40, 28, 0.03]] },
  ];
}

// Filled from the imported outlets before use.
const firstOutletByBrand: Partial<Record<Brand, string>> = {};
function firstOutlet(brand: Brand) {
  const id = firstOutletByBrand[brand];
  if (!id) throw new Error(`No Peliyagoda ${brand} outlet with normal access`);
  return id;
}

function totals(lines: LineSpec[]) {
  let units = 0;
  let weight = new Prisma.Decimal(0);
  let volume = new Prisma.Decimal(0);
  for (const [, u, w, v] of lines) {
    units += u;
    weight = weight.plus(new Prisma.Decimal(w).times(u));
    volume = volume.plus(new Prisma.Decimal(v).times(u));
  }
  return { totalUnits: units, totalWeightKg: weight, totalVolumeM3: volume };
}

async function upsertAccounts(password: string, vehicleIds: string[]) {
  const passwordHash = await bcrypt.hash(password, 10);
  const accounts: Account[] = [...DEMO_ACCOUNTS];
  // One driver account per vehicle so every trip can be assigned an existing driver.
  for (const id of vehicleIds) {
    if (id === DEMO_VEHICLE) continue;
    const v = await db.vehicle.findUniqueOrThrow({ where: { id } });
    accounts.push({ username: `driver-${id.toLowerCase()}`, displayName: `Driver ${id}`, role: "DRIVER", depotId: v.depotId, vehicleId: id });
  }
  let created = 0;
  for (const a of accounts) {
    const existing = await db.user.findUnique({ where: { username: a.username } });
    if (existing) {
      // Repair scope on older rows without touching passwords or active state.
      if (existing.depotId === null) {
        await db.user.update({ where: { id: existing.id }, data: { depotId: a.depotId, outletId: a.outletId, vehicleId: a.vehicleId } });
      }
      continue;
    }
    await db.user.create({ data: { ...a, passwordHash } });
    created++;
  }
  console.log(`accounts: ${created} created, ${accounts.length - created} already present`);
}

async function createOrder(tx: Prisma.TransactionClient, spec: OrderSpec, opts: {
  createdById: string;
  requestedDate: string;
  eligibleServiceDate: string;
  submittedAt: Date;
  status: "CONFIRMED" | "DEFERRED" | "ALLOCATED";
}) {
  const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: spec.outletId } });
  if (outlet.brand !== spec.brand) throw new Error(`${spec.ref}: outlet ${outlet.id} is ${outlet.brand}`);
  return tx.order.create({
    data: {
      orderRef: spec.ref,
      outletId: outlet.id,
      depotId: outlet.depotId,
      createdById: opts.createdById,
      brand: spec.brand,
      temp: spec.temp,
      requestedDate: opts.requestedDate,
      eligibleServiceDate: opts.eligibleServiceDate,
      submittedAt: opts.submittedAt,
      status: opts.status,
      ...totals(spec.lines),
      lines: {
        create: spec.lines.map(([description, orderedUnits, unitWeightKg, unitVolumeM3], i) => ({
          lineNo: i + 1,
          description,
          orderedUnits,
          unitWeightKg,
          unitVolumeM3,
        })),
      },
    },
    include: { lines: true },
  });
}

async function seedScenario(serviceDate: string, calendar: CalendarRecord[]) {
  const prev = previousOperatingDay(serviceDate, calendar);
  const yy = (d: string) => d.slice(2).replaceAll("-", "");
  const users = Object.fromEntries(
    (await db.user.findMany({ where: { username: { in: ["dispatcher", "loader", "driver", "store", "driver-veh036"] } } })).map((u) => [u.username, u]),
  );
  for (const u of ["dispatcher", "loader", "driver", "store", "driver-veh036"]) if (!users[u]) throw new Error(`Missing account ${u}`);

  for (const brand of ["TECH"] as const) {
    const o = await db.outlet.findFirst({ where: { brand, depotId: DEPOT_IDS.Peliyagoda, parkingConstraint: "NORMAL" }, orderBy: { id: "asc" } });
    if (o) firstOutletByBrand[brand] = o.id;
  }

  // ---- Previous day: published plan with a deferral and an open loading shortfall.
  const existingPrev = await db.plan.findUnique({ where: { depotId_serviceDate: { depotId: DEPOT_IDS.Peliyagoda, serviceDate: prev } } });
  if (existingPrev) {
    console.log(`scenario: plan for ${prev} already present, skipping history day`);
  } else {
    await db.$transaction(async (tx) => {
      const submittedAt = at(previousOperatingDay(prev, calendar), "11:00");
      const base = { createdById: users.store.id, requestedDate: prev, eligibleServiceDate: prev, submittedAt };
      const p = (n: string) => `ORD-${yy(prev)}-${n}`;
      const o1 = await createOrder(tx, { ref: p("H01"), outletId: "OUT001", brand: "FRESH", temp: "CHILLED", lines: FRESH_CHILLED }, { ...base, status: "ALLOCATED" });
      const o2 = await createOrder(tx, { ref: p("H02"), outletId: "OUT002", brand: "FRESH", temp: "CHILLED", lines: [["Fresh milk 1 L (crate of 12)", 30, 13, 0.025]] }, { ...base, status: "ALLOCATED" });
      const o3 = await createOrder(tx, { ref: p("H03"), outletId: "OUT003", brand: "FRESH", temp: "CHILLED", lines: [["Fresh milk 1 L (crate of 12)", 55, 13, 0.025], ["Butter (case)", 25, 6, 0.01]] }, { ...base, status: "ALLOCATED" });
      // Deferred on prev for capacity; carried into the demo day queue with history.
      const o4 = await createOrder(tx, { ref: p("H04"), outletId: "OUT003", brand: "FRESH", temp: "CHILLED", lines: [["Fish (chilled case)", 45, 12, 0.02]] }, { ...base, status: "DEFERRED", eligibleServiceDate: serviceDate });

      const plan = await tx.plan.create({
        data: {
          depotId: DEPOT_IDS.Peliyagoda,
          serviceDate: prev,
          status: "PUBLISHED",
          revision: 1,
          publishedAt: at(previousOperatingDay(prev, calendar), "17:30"),
          publishedById: users.dispatcher.id,
          createdById: users.dispatcher.id,
          version: 3,
        },
      });

      // Seeded distances are estimates (Peliyagoda <-> Colombo city outlets), labelled in docs.
      const tripDefs = [
        { vehicleId: "VEH035", driverId: users.driver.id, depart: "04:30", ret: "07:00", km: 26, state: "PLANNED" as const,
          stops: [{ outletId: "OUT001", arrive: "05:00", orders: [o1] }, { outletId: "OUT002", arrive: "05:40", orders: [o2] }] },
        { vehicleId: "VEH036", driverId: users["driver-veh036"].id, depart: "04:40", ret: "06:40", km: 22, state: "LOADING" as const,
          stops: [{ outletId: "OUT003", arrive: "05:10", orders: [o3] }] },
      ];
      const trips = [];
      for (const t of tripDefs) {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: t.vehicleId } });
        const liters = new Prisma.Decimal(t.km).times(vehicle.fuelLitersPerKm).toDecimalPlaces(2);
        const trip = await tx.trip.create({
          data: {
            planId: plan.id,
            depotId: DEPOT_IDS.Peliyagoda,
            serviceDate: prev,
            vehicleId: t.vehicleId,
            assignedDriverId: t.driverId,
            tripNumber: 1,
            brand: "FRESH",
            district: "Colombo",
            plannedDepartureAt: at(prev, t.depart),
            plannedReturnAt: at(prev, t.ret),
            distanceKm: t.km,
            reservedFuelLiters: liters,
            state: t.state,
            planRevision: 1,
            loadingStartedAt: t.state === "LOADING" ? at(prev, "03:50") : null,
          },
        });
        for (const [i, s] of t.stops.entries()) {
          const stop = await tx.stop.create({
            data: { tripId: trip.id, outletId: s.outletId, sequence: i + 1, plannedArrivalAt: at(prev, s.arrive), plannedServiceMin: 20 },
          });
          for (const o of s.orders) {
            await tx.stopOrder.create({ data: { stopId: stop.id, orderId: o.id } });
            await tx.allocationDecision.create({
              data: { planId: plan.id, orderId: o.id, decision: "SERVED", tripId: trip.id, stopId: stop.id, priorityNote: "Tier 1: van_only chilled outlet" },
            });
          }
        }
        const week = isoWeekOf(prev);
        const fuelWeek = await tx.vehicleWeekFuel.upsert({
          where: { vehicleId_isoYear_isoWeek: { vehicleId: t.vehicleId, ...week } },
          update: { reservedLiters: { increment: liters }, version: { increment: 1 } },
          create: { vehicleId: t.vehicleId, ...week, quotaLiters: vehicle.weeklyFuelQuotaLiters, reservedLiters: liters },
        });
        await tx.tripFuelReservation.create({ data: { tripId: trip.id, fuelWeekId: fuelWeek.id, liters } });
        trips.push(trip);
      }

      await tx.allocationDecision.create({
        data: {
          planId: plan.id,
          orderId: o4.id,
          decision: "DEFERRED",
          reasonCode: "CAPACITY_WEIGHT",
          reasonText:
            "OUT003 is van_only and both Peliyagoda refrigerated vans (VEH035, VEH036, 1040 kg) were full; " +
            "adding this 540 kg order to VEH036 would reach 1405 kg (365 kg over).",
          nextEligibleDate: serviceDate,
          priorityNote: "Deferred: lower prior-deferral count than OUT003 order H03 (tie-break by submission time)",
        },
      });

      // Loader on VEH036: one line short, which opens a blocking shortfall issue.
      const loading = trips[1];
      const [milk, butter] = o3.lines;
      await tx.loadingCheck.createMany({
        data: [
          { tripId: loading.id, orderLineId: milk.id, expectedUnits: milk.orderedUnits, loadedUnits: milk.orderedUnits - 7, damageUnits: 0, note: "Only 48 crates in chiller", planRevision: 1, checkedById: users.loader.id, checkedAt: at(prev, "04:05") },
          { tripId: loading.id, orderLineId: butter.id, expectedUnits: butter.orderedUnits, loadedUnits: butter.orderedUnits, damageUnits: 0, planRevision: 1, checkedById: users.loader.id, checkedAt: at(prev, "04:06") },
        ],
      });
      await tx.issue.create({
        data: {
          type: "SHORTFALL",
          severity: "HIGH",
          blocking: true,
          orderId: o3.id,
          tripId: loading.id,
          orderLineId: milk.id,
          reporterId: users.loader.id,
          reporterRole: "LOADER",
          text: `${o3.orderRef}: 7 of 55 milk crates missing from chiller stock.`,
          createdAt: at(prev, "04:07"),
        },
      });
      await tx.trip.update({ where: { id: loading.id }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({
        data: { actorId: users.dispatcher.id, action: "plan.publish", entityType: "Plan", entityId: plan.id, after: { revision: 1, seeded: true }, planRevision: 1 },
      });
    });
    console.log(`scenario: published plan for ${prev} with deferral and loading shortfall`);
  }

  // ---- Demo day: overloaded confirmed queue.
  const submittedAt = at(prev, "10:30");
  let created = 0;
  for (const spec of demoDayOrders(yy(serviceDate))) {
    if (await db.order.findUnique({ where: { orderRef: spec.ref } })) continue;
    await db.$transaction((tx) =>
      createOrder(tx, spec, {
        createdById: users.store.id,
        requestedDate: serviceDate,
        eligibleServiceDate: serviceDate,
        submittedAt,
        status: "CONFIRMED",
      }),
    );
    created++;
  }
  console.log(`scenario: ${created} demo-day orders created for ${serviceDate} (previous run ${prev})`);
}

async function main() {
  const { calendar, vehicles } = await importMasters();

  if (process.env.DEMO_SEED !== "true") {
    console.log("DEMO_SEED is not 'true'; skipping demo accounts and scenario.");
    return;
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) throw new Error("DEMO_PASSWORD (min 8 chars) is required when DEMO_SEED=true");
  const serviceDate = process.env.DEMO_SERVICE_DATE ?? "2026-09-26";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) throw new Error("DEMO_SERVICE_DATE must be YYYY-MM-DD");

  await upsertAccounts(password, vehicles.map((v) => v.id));
  await seedScenario(serviceDate, calendar);
  console.log("seed complete");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
