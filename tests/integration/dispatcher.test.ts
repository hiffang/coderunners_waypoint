import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: async () => null }));
import { db } from "@/server/db";
import { runMutation } from "@/server/mutation";
import { derivedDay } from "@/server/calendar";
import { addDays } from "@/server/time";
import {
  createPlan,
  loadPlan,
  planDetail,
  publishPlan,
  resolveIssue,
  saveDecisions,
  validateStored,
} from "@/features/dispatcher/server/service";
import type { SessionUser } from "@/server/auth/guards";
import type { Decision } from "@/features/dispatcher/server/planning/engine";
import { mutationRequest, sessionUser } from "./driver-fixtures";

type Context = Parameters<typeof createPlan>[0];
let dispatcher: SessionUser;
let kandy: SessionUser;
let store: SessionUser;
const plans: string[] = [];
const orders: string[] = [];
const keys: string[] = [];
const fuelWeeks: string[] = [];
const issueIds: string[] = [];
const prefix = `DSP-${randomUUID().slice(0, 8)}`;
let day = `19${String(10 + Math.floor(Math.random() * 70))}-01-01`;

beforeAll(async () => {
  dispatcher = await sessionUser("dispatcher");
  kandy = await sessionUser("dispatcher-kandy");
  store = await sessionUser("store");
});
afterAll(async () => {
  // Delete only records created by this test run, preserving seeded/demo data.
  await db.idempotencyKey.deleteMany({ where: { key: { in: keys } } });
  await db.issue.deleteMany({ where: { id: { in: issueIds } } });
  await db.allocationDecision.deleteMany({ where: { planId: { in: plans } } });
  const trips = await db.trip.findMany({
    where: { planId: { in: plans } },
    select: { id: true },
  });
  await db.tripFuelReservation.deleteMany({
    where: { tripId: { in: trips.map((t) => t.id) } },
  });
  await db.plan.deleteMany({ where: { id: { in: plans } } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.vehicleWeekFuel.deleteMany({ where: { id: { in: fuelWeeks } } });
  await db.auditLog.deleteMany({
    where: { entityId: { in: [...plans, ...orders, ...issueIds] } },
  });
  await db.$disconnect();
});

async function mutate<T>(
  route: string,
  body: unknown,
  fn: (ctx: Context) => Promise<T>,
  key = randomUUID(),
  actor = dispatcher,
) {
  keys.push(key);
  return runMutation({
    req: mutationRequest(key),
    actor,
    route,
    body,
    requireIdempotencyKey: true,
    fn,
  });
}
async function fixture() {
  day = addDays(day, 8);
  while (!derivedDay(day).isOperating) day = addDays(day, 1);
  const p = (
    await mutate(`create/${day}`, { day }, (ctx) =>
      createPlan(ctx, dispatcher.depotId!, day),
    )
  ).data;
  plans.push(p.id);
  const order = await db.order.create({
    data: {
      orderRef: `${prefix}-${orders.length}`,
      outletId: "OUT001",
      depotId: dispatcher.depotId!,
      createdById: store.id,
      brand: "FRESH",
      temp: "CHILLED",
      requestedDate: day,
      eligibleServiceDate: day,
      submittedAt: new Date(`${day}T00:00:00Z`),
      totalUnits: 10,
      totalWeightKg: 100,
      totalVolumeM3: 1,
      status: "CONFIRMED",
      lines: {
        create: {
          lineNo: 1,
          description: "Dispatcher test",
          orderedUnits: 10,
          unitWeightKg: 10,
          unitVolumeM3: 0.1,
        },
      },
    },
  });
  orders.push(order.id);
  const decisions: Decision[] = [
    {
      orderId: order.id,
      decision: "SERVED",
      vehicleId: "VEH035",
      tripNumber: 1,
      stopSequence: 1,
    },
  ];
  // Older test orders remain allocated (or are cleaned before the next fixture).
  for (const old of orders.filter((id) => id !== order.id))
    await db.order.update({
      where: { id: old },
      data: { status: "CANCELLED" },
    });
  const saved = (
    await mutate(`save/${p.id}`, decisions, (ctx) =>
      saveDecisions(ctx, p.id, 1, decisions),
    )
  ).data;
  return { plan: saved, order, decisions };
}
async function publish(id: string, version: number, key = randomUUID()) {
  const result = await mutate(
    `publish/${id}`,
    { expectedVersion: version },
    (ctx) => publishPlan(ctx, id, version),
    key,
  );
  const reservations = await db.tripFuelReservation.findMany({
    where: { trip: { planId: id } },
  });
  fuelWeeks.push(...reservations.map((r) => r.fuelWeekId));
  return result;
}

describe("dispatcher publication and revisions", { timeout: 30000 }, () => {
  it("publishes loader-visible manifests and replays without duplicate fuel or stops", async () => {
    const { plan, order } = await fixture();
    expect(
      await validateStored(db, dispatcher, plan.id, plan.version),
    ).toMatchObject({ valid: true });
    expect(
      await db.tripFuelReservation.count({
        where: { trip: { planId: plan.id } },
      }),
    ).toBe(0);
    const key = randomUUID();
    const first = await publish(plan.id, plan.version, key);
    const retry = await publish(plan.id, plan.version, key);
    expect(retry.replayed).toBe(true);
    expect(retry.data).toEqual(first.data);
    expect(first.data.status).toBe("PUBLISHED");
    expect(first.data.manifests[0].stops[0].orders[0].orderId).toBe(order.id);
    expect(
      await db.tripFuelReservation.count({
        where: { trip: { planId: plan.id } },
      }),
    ).toBe(1);
    expect(await db.stop.count({ where: { trip: { planId: plan.id } } })).toBe(
      1,
    );
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    ).toBe("ALLOCATED");
  });
  it("rejects stale versions and wrong-depot access", async () => {
    const { plan, decisions } = await fixture();
    await expect(loadPlan(db, kandy, plan.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      mutate(
        `wrong/${plan.id}`,
        {},
        (ctx) => saveDecisions(ctx, plan.id, plan.version, decisions),
        randomUUID(),
        kandy,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(publish(plan.id, 1)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });
  it("rolls back infeasible assignment edits without deleting a valid draft", async () => {
    const { plan, decisions } = await fixture();
    await expect(
      mutate(`bad/${plan.id}`, {}, (ctx) =>
        saveDecisions(ctx, plan.id, plan.version, [
          { ...decisions[0], vehicleId: "VEH001" },
        ]),
      ),
    ).rejects.toMatchObject({ code: "CONSTRAINT" });
    const after = await planDetail(db, dispatcher, plan.id);
    expect(after.version).toBe(plan.version);
    expect(after.manifests[0].id).toBe(plan.manifests[0].id);
  });
  it("revalidates fuel on publish and rolls back all changes when quota is exhausted", async () => {
    const { plan } = await fixture();
    const { isoYear, isoWeek } = derivedDay(plan.serviceDate);
    const ledger = await db.vehicleWeekFuel.create({
      data: { vehicleId: "VEH035", isoYear, isoWeek, quotaLiters: 1 },
    });
    fuelWeeks.push(ledger.id);
    await expect(publish(plan.id, plan.version)).rejects.toMatchObject({
      code: "CONSTRAINT",
    });
    expect((await loadPlan(db, dispatcher, plan.id)).status).toBe("DRAFT");
    expect(
      await db.tripFuelReservation.count({
        where: { trip: { planId: plan.id } },
      }),
    ).toBe(0);
    expect(
      Number(
        (
          await db.vehicleWeekFuel.findUniqueOrThrow({
            where: { id: ledger.id },
          })
        ).reservedLiters,
      ),
    ).toBe(0);
  });
  it("replaces reservations once, increments revision and invalidates loading readiness", async () => {
    const f = await fixture();
    const published = (await publish(f.plan.id, f.plan.version)).data;
    const trip = published.manifests[0];
    await db.trip.update({ where: { id: trip.id }, data: { state: "READY" } });
    const line = trip.stops[0].orders[0].lines[0];
    await db.loadingCheck.create({
      data: {
        tripId: trip.id,
        orderLineId: line.orderLineId,
        expectedUnits: 10,
        loadedUnits: 10,
        damageUnits: 0,
        planRevision: 1,
        checkedById: dispatcher.id,
      },
    });
    const before = await db.tripFuelReservation.findUniqueOrThrow({
      where: { tripId: trip.id },
    });
    const revised = (
      await mutate(`revise/${f.plan.id}`, f.decisions, (ctx) =>
        saveDecisions(ctx, f.plan.id, published.version, f.decisions),
      )
    ).data;
    expect(revised.revision).toBe(2);
    expect(revised.manifests[0]).toMatchObject({
      id: trip.id,
      state: "PLANNED",
      planRevision: 2,
    });
    expect(await db.loadingCheck.count({ where: { tripId: trip.id } })).toBe(0);
    const ledger = await db.vehicleWeekFuel.findUniqueOrThrow({
      where: { id: before.fuelWeekId },
    });
    expect(Number(ledger.reservedLiters)).toBe(Number(before.liters));
    await db.trip.update({
      where: { id: trip.id },
      data: { state: "IN_TRANSIT", departedAt: new Date() },
    });
    await expect(
      mutate(`locked/${f.plan.id}`, {}, (ctx) =>
        saveDecisions(ctx, f.plan.id, revised.version, f.decisions),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
  it("does not waive missing stock when resolving a blocking issue", async () => {
    const f = await fixture();
    const p = (await publish(f.plan.id, f.plan.version)).data;
    const issue = await db.issue.create({
      data: {
        tripId: p.trips[0].id,
        orderId: f.order.id,
        reporterId: dispatcher.id,
        reporterRole: "DISPATCHER",
        type: "SHORTFALL",
        severity: "HIGH",
        blocking: true,
        text: "Missing stock",
      },
    });
    issueIds.push(issue.id);
    await expect(
      mutate(`resolve/${issue.id}`, {}, (ctx) =>
        resolveIssue(ctx, issue.id, {
          expectedVersion: 1,
          action: "RESOLVE",
          resolution: "Ignore",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONSTRAINT" });
    const ack = await mutate(`ack/${issue.id}`, {}, (ctx) =>
      resolveIssue(ctx, issue.id, {
        expectedVersion: 1,
        action: "ACKNOWLEDGE",
        resolution: "Warehouse is checking",
      }),
    );
    expect(ack.data.status).toBe("ACKNOWLEDGED");
    expect(ack.data.blocking).toBe(true);
  });
  it("serializes simultaneous publication attempts without overspending", async () => {
    const { plan } = await fixture();
    const results = await Promise.allSettled([
      publish(plan.id, plan.version),
      publish(plan.id, plan.version),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.tripFuelReservation.count({
        where: { trip: { planId: plan.id } },
      }),
    ).toBe(1);
  });
  it("publishes explained deferrals to the shared store order DTO", async () => {
    const f = await fixture();
    const decisions: Decision[] = [
      {
        orderId: f.order.id,
        decision: "DEFERRED",
        reasonCode: "CAPACITY_WEIGHT",
        reasonText: "All compatible vans are full on this run.",
      },
    ];
    const saved = (
      await mutate(`defer/${f.plan.id}`, decisions, (ctx) =>
        saveDecisions(ctx, f.plan.id, f.plan.version, decisions),
      )
    ).data;
    const p = (await publish(f.plan.id, saved.version)).data;
    expect(p.orders[0].deferral).toMatchObject({
      reasonCode: "CAPACITY_WEIGHT",
      reasonText: decisions[0].reasonText,
    });
    expect(p.orders[0].priorDeferrals).toHaveLength(1);
    expect(p.orders[0].eligibleServiceDate > p.serviceDate).toBe(true);
    expect(p.trips).toHaveLength(0);
  });
});
