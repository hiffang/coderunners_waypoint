import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/guards";

/** Development/test fixture only: builds a published, released trip without going through M1/M2 flows. */

export async function sessionUser(username: string): Promise<SessionUser> {
  const u = await db.user.findUniqueOrThrow({ where: { username } });
  return { id: u.id, name: u.displayName, username: u.username, role: u.role, depotId: u.depotId, outletId: u.outletId, vehicleId: u.vehicleId };
}

/** A random far-future service date so reruns never collide with seed data or each other. */
export function freshServiceDate() {
  const y = 2030 + Math.floor(Math.random() * 60);
  const m = 1 + Math.floor(Math.random() * 12);
  const d = 1 + Math.floor(Math.random() * 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type LineSpec = { description: string; units: number; loaded?: number };
type StopSpec = { outletId: string; orders: Array<{ temp?: "AMBIENT" | "CHILLED"; lines: LineSpec[] }> };

export async function createTrip(opts: {
  serviceDate: string;
  vehicleId: string;
  driverId: string;
  tripNumber?: number;
  state?: "PLANNED" | "LOADING" | "READY";
  stops: StopSpec[];
  planId?: string;
}) {
  const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: opts.vehicleId } });
  const creator = await db.user.findUniqueOrThrow({ where: { username: "dispatcher" } });
  const store = await db.user.findUniqueOrThrow({ where: { username: "store" } });
  const tripNumber = opts.tripNumber ?? 1;
  const at = (hh: string) => new Date(`${opts.serviceDate}T${hh}:00+05:30`);

  return db.$transaction(async (tx) => {
    const plan =
      opts.planId !== undefined
        ? await tx.plan.findUniqueOrThrow({ where: { id: opts.planId } })
        : await tx.plan.create({
            data: {
              depotId: vehicle.depotId,
              serviceDate: opts.serviceDate,
              status: "PUBLISHED",
              revision: 1,
              publishedAt: at("00:00"),
              publishedById: creator.id,
              createdById: creator.id,
            },
          });
    const km = 20;
    const liters = new Prisma.Decimal(km).times(vehicle.fuelLitersPerKm).toDecimalPlaces(2);
    const trip = await tx.trip.create({
      data: {
        planId: plan.id,
        depotId: vehicle.depotId,
        serviceDate: opts.serviceDate,
        vehicleId: vehicle.id,
        assignedDriverId: opts.driverId,
        tripNumber,
        brand: "FRESH",
        district: "Colombo",
        plannedDepartureAt: at(tripNumber === 1 ? "04:30" : "09:00"),
        plannedReturnAt: at(tripNumber === 1 ? "08:00" : "12:00"),
        distanceKm: km,
        reservedFuelLiters: liters,
        state: opts.state ?? "READY",
        planRevision: 1,
        readyAt: (opts.state ?? "READY") === "READY" ? at("04:00") : null,
      },
    });
    const orders: Array<{ id: string; lines: Array<{ id: string; orderedUnits: number }> }> = [];
    const stops = [];
    for (const [i, s] of opts.stops.entries()) {
      const stop = await tx.stop.create({
        data: { tripId: trip.id, outletId: s.outletId, sequence: i + 1, plannedArrivalAt: at(`0${5 + i}:00`), plannedServiceMin: 20 },
      });
      stops.push(stop);
      const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: s.outletId } });
      for (const o of s.orders) {
        const order = await tx.order.create({
          data: {
            orderRef: `TST-${randomUUID().slice(0, 12)}`,
            outletId: outlet.id,
            depotId: outlet.depotId,
            createdById: store.id,
            brand: outlet.brand,
            temp: o.temp ?? "AMBIENT",
            requestedDate: opts.serviceDate,
            eligibleServiceDate: opts.serviceDate,
            submittedAt: at("00:00"),
            status: "ALLOCATED",
            totalUnits: o.lines.reduce((n, l) => n + l.units, 0),
            totalWeightKg: 10,
            totalVolumeM3: 0.1,
            lines: { create: o.lines.map((l, n) => ({ lineNo: n + 1, description: l.description, orderedUnits: l.units, unitWeightKg: 1, unitVolumeM3: 0.01 })) },
          },
          include: { lines: { orderBy: { lineNo: "asc" } } },
        });
        orders.push(order);
        await tx.stopOrder.create({ data: { stopId: stop.id, orderId: order.id } });
        await tx.allocationDecision.create({ data: { planId: plan.id, orderId: order.id, decision: "SERVED", tripId: trip.id, stopId: stop.id } });
        if ((opts.state ?? "READY") === "READY") {
          await tx.loadingCheck.createMany({
            data: order.lines.map((l, n) => ({
              tripId: trip.id,
              orderLineId: l.id,
              expectedUnits: l.orderedUnits,
              loadedUnits: o.lines[n].loaded ?? l.orderedUnits,
              damageUnits: 0,
              planRevision: 1,
              checkedById: creator.id,
            })),
          });
        }
      }
    }
    const [y] = opts.serviceDate.split("-").map(Number);
    const isoWeek = 1 + Math.floor(Math.random() * 52);
    const fuelWeek = await tx.vehicleWeekFuel.upsert({
      where: { vehicleId_isoYear_isoWeek: { vehicleId: vehicle.id, isoYear: y, isoWeek } },
      update: { reservedLiters: { increment: liters } },
      create: { vehicleId: vehicle.id, isoYear: y, isoWeek, quotaLiters: vehicle.weeklyFuelQuotaLiters, reservedLiters: liters },
    });
    await tx.tripFuelReservation.create({ data: { tripId: trip.id, fuelWeekId: fuelWeek.id, liters } });
    return { plan, trip, stops, orders, fuelWeekId: fuelWeek.id, liters };
  });
}

/** A provisional upload row, as POST /api/shared/files would create it. */
export async function provisionalAttachment(uploadedById: string) {
  return db.attachment.create({
    data: { uploadedById, clientFileId: randomUUID(), contentType: "image/jpeg", size: 1234, storageKey: `test/${randomUUID()}.jpg` },
  });
}

export function mutationRequest(key: string) {
  return new Request("http://localhost/api/driver/test", { method: "POST", headers: { "Idempotency-Key": key, origin: "http://localhost", host: "localhost" } });
}
