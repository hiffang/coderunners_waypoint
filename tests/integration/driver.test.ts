import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The session layer (next-auth) is not under test; actions receive the actor explicitly.
vi.mock("@/auth", () => ({ auth: async () => null }));
import { db } from "@/server/db";
import { runMutation } from "@/server/mutation";
import { orderInclude, toOrderDto } from "@/server/dto";
import type { SessionUser } from "@/server/auth/guards";
import { arriveAtStop, departTrip, recordOutcome, reportStopIssue, returnTrip } from "@/features/driver/server/actions";
import { driverTripInclude, loadDepartureContext, readinessFor, toDriverSnapshotDto } from "@/features/driver/server/snapshot";
import { stopOutcomeSchema } from "@/shared/dto/manifest";
import { createTrip, freshServiceDate, mutationRequest, provisionalAttachment, sessionUser } from "./driver-fixtures";

type Fn<B> = (ctx: Parameters<typeof departTrip>[0], id: string, body: B) => Promise<unknown>;

function send<B>(actor: SessionUser, fn: Fn<B>, id: string, body: B, key = randomUUID()) {
  return runMutation({
    req: mutationRequest(key),
    actor,
    route: `POST /test/${fn.name}/${id}`,
    body,
    requireIdempotencyKey: true,
    fn: (ctx) => fn(ctx, id, body),
  });
}

const clientAt = "2030-01-01T00:00:00.000Z";
let driver: SessionUser;
let other: SessionUser;

beforeEach(async () => {
  driver = await sessionUser("driver");
  other = await sessionUser("driver-veh036");
  // Earlier runs may have left test trips on the road; they would block departure.
  await db.trip.updateMany({
    where: { vehicleId: { in: ["VEH035", "VEH036"] }, serviceDate: { gte: "2030-01-01" }, state: "IN_TRANSIT" },
    data: { state: "COMPLETED", returnedAt: new Date() },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

async function readyTrip(stops = 2) {
  return createTrip({
    serviceDate: freshServiceDate(),
    vehicleId: "VEH035",
    driverId: driver.id,
    stops: Array.from({ length: stops }, (_, i) => ({
      outletId: i === 0 ? "OUT001" : "OUT002",
      orders: [{ lines: [{ description: "Milk crate", units: 10 }, { description: "Yoghurt case", units: 4 }] }],
    })),
  });
}

const action = (t: { version: number; planRevision: number }) => ({ expectedVersion: t.version, planRevision: t.planRevision, clientAt });

describe("depart", () => {
  it("rejects another driver's trip", async () => {
    const { trip } = await readyTrip();
    await expect(send(other, departTrip, trip.id, action(trip))).rejects.toMatchObject({ status: 403 });
  });

  it("rejects an unready trip and explains why", async () => {
    const { trip } = await createTrip({
      serviceDate: freshServiceDate(),
      vehicleId: "VEH035",
      driverId: driver.id,
      state: "LOADING",
      stops: [{ outletId: "OUT001", orders: [{ lines: [{ description: "Milk", units: 1 }] }] }],
    });
    await expect(send(driver, departTrip, trip.id, action(trip))).rejects.toMatchObject({
      status: 409,
      code: "INVALID_TRANSITION",
      details: { blockers: expect.arrayContaining([expect.stringMatching(/Loading is still in progress/)]) },
    });
  });

  it("rejects a stale plan revision before anything else", async () => {
    const { trip } = await readyTrip();
    await expect(send(driver, departTrip, trip.id, { ...action(trip), planRevision: 2 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("departs once; a lost-response retry replays, a new attempt conflicts", async () => {
    const { trip } = await readyTrip();
    const key = randomUUID();
    const first = await send(driver, departTrip, trip.id, action(trip), key);
    expect(first.data).toMatchObject({ state: "IN_TRANSIT", version: trip.version + 1 });
    const audits = await db.auditLog.count({ where: { entityId: trip.id, action: "trip.depart" } });

    const replay = await send(driver, departTrip, trip.id, action(trip), key);
    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(first.data);
    expect(await db.auditLog.count({ where: { entityId: trip.id, action: "trip.depart" } })).toBe(audits);

    await expect(send(driver, departTrip, trip.id, action(trip))).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("trip 2 cannot depart until trip 1 has returned", async () => {
    const serviceDate = freshServiceDate();
    const t1 = await createTrip({ serviceDate, vehicleId: "VEH035", driverId: driver.id, stops: [{ outletId: "OUT001", orders: [{ lines: [{ description: "Milk", units: 1 }] }] }] });
    const t2 = await createTrip({
      serviceDate,
      planId: t1.plan.id,
      tripNumber: 2,
      vehicleId: "VEH035",
      driverId: driver.id,
      stops: [{ outletId: "OUT002", orders: [{ lines: [{ description: "Milk", units: 1 }] }] }],
    });
    await expect(send(driver, departTrip, t2.trip.id, action(t2.trip))).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining(["Trip 1 has not returned to the depot yet"]) },
    });
  });
});

describe("stops and proof", () => {
  async function onTheRoad(stops = 2) {
    const f = await readyTrip(stops);
    await send(driver, departTrip, f.trip.id, action(f.trip));
    return f;
  }

  it("enforces stop order and the pending -> arrived -> outcome machine", async () => {
    const { stops } = await onTheRoad();
    await expect(send(driver, arriveAtStop, stops[1].id, action({ version: 1, planRevision: 1 }))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const lines = [] as never[];
    await expect(
      send(driver, recordOutcome, stops[0].id, stopOutcomeSchema.parse({ ...action({ version: 1, planRevision: 1 }), outcome: "FAILED", failureReason: "x", lines })),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("records a photo-backed outcome exactly once and derives order status from lines", async () => {
    const { stops, orders } = await onTheRoad(1);
    const arrived = await send(driver, arriveAtStop, stops[0].id, action({ version: 1, planRevision: 1 }));
    expect(arrived.data).toMatchObject({ state: "ARRIVED", version: 2 });

    const photo = await provisionalAttachment(driver.id);
    const body = stopOutcomeSchema.parse({
      expectedVersion: 2,
      planRevision: 1,
      outcome: "DELIVERED",
      evidenceFileIds: [photo.id],
      lines: orders[0].lines.map((l) => ({ orderLineId: l.id, deliveredUnits: l.orderedUnits, damagedUnits: 0 })),
      clientAt,
    });
    const key = randomUUID();
    const first = await send(driver, recordOutcome, stops[0].id, body, key);
    expect(first.data).toMatchObject({ state: "DELIVERED", version: 3, attachmentIds: [photo.id] });

    // Server committed, response lost: the outbox resends the same frozen body with the same key.
    const again = await send(driver, recordOutcome, stops[0].id, body, key);
    expect(again.replayed).toBe(true);
    expect(again.data).toEqual(first.data);
    expect(await db.proofOfDelivery.count({ where: { stopId: stops[0].id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: stops[0].id, action: "stop.outcome" } })).toBe(1);
    expect((await db.attachment.findUniqueOrThrow({ where: { id: photo.id } })).linkedAt).not.toBeNull();

    // The store reads actual quantities and proof through the shared order DTO.
    const order = toOrderDto(await db.order.findUniqueOrThrow({ where: { id: orders[0].id }, include: orderInclude }));
    expect(order.status).toBe("DELIVERED");
    expect(order.lines.every((l) => l.deliveredUnits === l.orderedUnits)).toBe(true);
    expect(order.delivery).toMatchObject({ stopState: "DELIVERED", outcome: "DELIVERED" });
    expect(order.delivery?.evidence.map((e) => e.id)).toEqual([photo.id]);
  });

  it("rejects over-delivery, someone else's photo and quantities the loader never loaded", async () => {
    const f = await createTrip({
      serviceDate: freshServiceDate(),
      vehicleId: "VEH035",
      driverId: driver.id,
      stops: [{ outletId: "OUT001", orders: [{ lines: [{ description: "Milk", units: 10, loaded: 7 }] }] }],
    });
    await send(driver, departTrip, f.trip.id, action(f.trip));
    await send(driver, arriveAtStop, f.stops[0].id, action({ version: 1, planRevision: 1 }));
    const line = f.orders[0].lines[0];
    const base = { expectedVersion: 2, planRevision: 1, clientAt, recipientName: "Nimal" };

    await expect(
      send(driver, recordOutcome, f.stops[0].id, stopOutcomeSchema.parse({ ...base, outcome: "DELIVERED", lines: [{ orderLineId: line.id, deliveredUnits: 10, damagedUnits: 0 }] })),
    ).rejects.toMatchObject({ status: 422, code: "CONSTRAINT" });

    const foreign = await provisionalAttachment(other.id);
    await expect(
      send(
        driver,
        recordOutcome,
        f.stops[0].id,
        stopOutcomeSchema.parse({ ...base, outcome: "PARTIAL", failureReason: "3 short at depot", evidenceFileIds: [foreign.id], lines: [{ orderLineId: line.id, deliveredUnits: 7, damagedUnits: 0 }] }),
      ),
    ).rejects.toMatchObject({ status: 422 });

    const ok = await send(
      driver,
      recordOutcome,
      f.stops[0].id,
      stopOutcomeSchema.parse({ ...base, outcome: "PARTIAL", failureReason: "3 short at depot", lines: [{ orderLineId: line.id, deliveredUnits: 7, damagedUnits: 1 }] }),
    );
    expect(ok.data).toMatchObject({ state: "PARTIAL" });
    expect((await db.order.findUniqueOrThrow({ where: { id: f.orders[0].id } })).status).toBe("PARTIALLY_DELIVERED");
  });

  it("issues bump the stop version and reach the dispatcher's trip issues", async () => {
    const { stops, trip } = await onTheRoad(1);
    const r = await send(driver, reportStopIssue, stops[0].id, { ...action({ version: 1, planRevision: 1 }), type: "DELAY" as const, severity: "MEDIUM" as const, text: "Road closed" });
    expect(r.data).toMatchObject({ version: 2 });
    const issue = await db.issue.findFirstOrThrow({ where: { stopId: stops[0].id } });
    expect(issue).toMatchObject({ tripId: trip.id, reporterRole: "DRIVER", blocking: false });
  });
});

describe("return", () => {
  it("needs every stop terminal, then consumes the fuel reservation exactly once", async () => {
    const f = await readyTrip(1);
    await send(driver, departTrip, f.trip.id, action(f.trip));
    const v = f.trip.version + 1;
    await expect(send(driver, returnTrip, f.trip.id, action({ version: v, planRevision: 1 }))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    await send(driver, arriveAtStop, f.stops[0].id, action({ version: 1, planRevision: 1 }));
    await send(driver, recordOutcome, f.stops[0].id, stopOutcomeSchema.parse({ expectedVersion: 2, planRevision: 1, outcome: "FAILED", failureReason: "Shop closed", lines: [], clientAt }));

    const before = await db.vehicleWeekFuel.findUniqueOrThrow({ where: { id: f.fuelWeekId } });
    const key = randomUUID();
    const done = await send(driver, returnTrip, f.trip.id, action({ version: v, planRevision: 1 }), key);
    expect(done.data).toMatchObject({ state: "COMPLETED", fuel: { estimated: true, state: "CONSUMED" } });
    await send(driver, returnTrip, f.trip.id, action({ version: v, planRevision: 1 }), key); // lost response, replay

    const after = await db.vehicleWeekFuel.findUniqueOrThrow({ where: { id: f.fuelWeekId } });
    expect(after.consumedLiters.minus(before.consumedLiters).toNumber()).toBe(f.liters.toNumber());
    expect(before.reservedLiters.minus(after.reservedLiters).toNumber()).toBe(f.liters.toNumber());
    expect((await db.tripFuelReservation.findUniqueOrThrow({ where: { tripId: f.trip.id } })).state).toBe("CONSUMED");
    expect(await db.auditLog.count({ where: { entityId: f.trip.id, action: "trip.return" } })).toBe(1);
    // Failed delivery leaves the order allocated for the dispatcher to defer explicitly.
    expect((await db.order.findUniqueOrThrow({ where: { id: f.orders[0].id } })).status).toBe("ALLOCATED");
  });
});

describe("snapshot", () => {
  it("includes readiness, actual events and only what the driver needs", async () => {
    const f = await readyTrip(1);
    const row = await db.trip.findUniqueOrThrow({ where: { id: f.trip.id }, include: driverTripInclude });
    const snap = toDriverSnapshotDto(row, readinessFor(row, driver, await loadDepartureContext(db, row)));
    expect(snap.departure).toEqual({ canDepart: true, blockers: [] });
    expect(snap.stops[0].orders[0].lines[0].check?.loadedUnits).toBe(10);
    expect(snap.stopEvents[f.stops[0].id]).toMatchObject({ proof: null, lineOutcomes: [] });
    const asOther = readinessFor(row, other, await loadDepartureContext(db, row));
    expect(asOther.blockers).toContain("Trip is not assigned to you");
  });
});
