// E2E fixture (development/test only): a published, warehouse-released trip for
// the demo `driver` account, created straight in the database because the
// dispatcher/loader flows are owned by other members. Never used by the app.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../src/generated/prisma/client";

export function testDb() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

function freshDate() {
  const y = 2030 + Math.floor(Math.random() * 60);
  const m = 1 + Math.floor(Math.random() * 12);
  const d = 1 + Math.floor(Math.random() * 28);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function createReadyTrip(db: PrismaClient, username = "driver") {
  const driver = await db.user.findUniqueOrThrow({ where: { username } });
  const vehicleId = driver.vehicleId!;
  // Leftover e2e trips on the road would block departure.
  await db.trip.updateMany({ where: { vehicleId, serviceDate: { gte: "2030-01-01" }, state: { not: "COMPLETED" } }, data: { state: "COMPLETED", returnedAt: new Date() } });
  const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  const dispatcher = await db.user.findUniqueOrThrow({ where: { username: "dispatcher" } });
  const store = await db.user.findUniqueOrThrow({ where: { username: "store" } });
  const serviceDate = freshDate();
  const at = (hh: string) => new Date(`${serviceDate}T${hh}:00+05:30`);

  return db.$transaction(async (tx) => {
    const plan = await tx.plan.create({
      data: { depotId: vehicle.depotId, serviceDate, status: "PUBLISHED", revision: 1, publishedAt: at("00:00"), publishedById: dispatcher.id, createdById: dispatcher.id },
    });
    const liters = new Prisma.Decimal(26).times(vehicle.fuelLitersPerKm).toDecimalPlaces(2);
    const trip = await tx.trip.create({
      data: {
        planId: plan.id, depotId: vehicle.depotId, serviceDate, vehicleId, assignedDriverId: driver.id, tripNumber: 1, brand: "FRESH", district: "Colombo",
        plannedDepartureAt: at("04:30"), plannedReturnAt: at("07:00"), distanceKm: 26, reservedFuelLiters: liters, state: "READY", planRevision: 1, readyAt: at("04:10"),
      },
    });
    const stops = [];
    const orders = [];
    for (const [i, outletId] of ["OUT001", "OUT002"].entries()) {
      const stop = await tx.stop.create({ data: { tripId: trip.id, outletId, sequence: i + 1, plannedArrivalAt: at(i === 0 ? "05:00" : "05:40"), plannedServiceMin: 20 } });
      const order = await tx.order.create({
        data: {
          orderRef: `E2E-${randomUUID().slice(0, 8)}`, outletId, depotId: vehicle.depotId, createdById: store.id, brand: "FRESH", temp: "CHILLED",
          requestedDate: serviceDate, eligibleServiceDate: serviceDate, submittedAt: at("00:00"), status: "ALLOCATED", totalUnits: 28, totalWeightKg: 269, totalVolumeM3: 0.57,
          lines: { create: [
            { lineNo: 1, description: "Fresh milk 1 L (crate of 12)", orderedUnits: 18, unitWeightKg: 13, unitVolumeM3: 0.025 },
            { lineNo: 2, description: "Yoghurt cups (case of 24)", orderedUnits: 10, unitWeightKg: 3.5, unitVolumeM3: 0.012 },
          ] },
        },
        include: { lines: true },
      });
      await tx.stopOrder.create({ data: { stopId: stop.id, orderId: order.id } });
      await tx.allocationDecision.create({ data: { planId: plan.id, orderId: order.id, decision: "SERVED", tripId: trip.id, stopId: stop.id } });
      await tx.loadingCheck.createMany({
        data: order.lines.map((l) => ({ tripId: trip.id, orderLineId: l.id, expectedUnits: l.orderedUnits, loadedUnits: l.orderedUnits, damageUnits: 0, planRevision: 1, checkedById: dispatcher.id })),
      });
      stops.push(stop);
      orders.push(order);
    }
    const isoYear = Number(serviceDate.slice(0, 4));
    const isoWeek = 1 + Math.floor(Math.random() * 52);
    const week = await tx.vehicleWeekFuel.upsert({
      where: { vehicleId_isoYear_isoWeek: { vehicleId, isoYear, isoWeek } },
      update: { reservedLiters: { increment: liters } },
      create: { vehicleId, isoYear, isoWeek, quotaLiters: vehicle.weeklyFuelQuotaLiters, reservedLiters: liters },
    });
    await tx.tripFuelReservation.create({ data: { tripId: trip.id, fuelWeekId: week.id, liters } });
    return { trip, stops, orders };
  });
}
