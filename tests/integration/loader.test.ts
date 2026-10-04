import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The session layer (next-auth) is not under test; actions receive the actor explicitly.
vi.mock("@/auth", () => ({ auth: async () => null }));
import { db } from "@/server/db";
import { runMutation } from "@/server/mutation";
import type { SessionUser } from "@/server/auth/guards";
import { recordChecks, releaseTrip, reportIssue, resolveIssue, startLoading } from "@/features/loader/server/actions";
import { loadLoaderTrip, toLoaderManifestDto } from "@/features/loader/server/manifest";
import { loadingChecksSchema } from "@/shared/dto/manifest";
import { createTrip, freshServiceDate, mutationRequest, sessionUser } from "./driver-fixtures";

type Fn<B> = (ctx: Parameters<typeof startLoading>[0], id: string, body: B) => Promise<unknown>;

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

function resolve(actor: SessionUser, tripId: string, issueId: string, body: Parameters<typeof resolveIssue>[3]) {
  return runMutation({
    req: mutationRequest(randomUUID()),
    actor,
    route: `POST /test/resolve/${issueId}`,
    body,
    requireIdempotencyKey: true,
    fn: (ctx) => resolveIssue(ctx, tripId, issueId, body),
  });
}

let loader: SessionUser;
let kandy: SessionUser;
let driver: SessionUser;

beforeEach(async () => {
  loader = await sessionUser("loader");
  kandy = await sessionUser("loader-kandy");
  driver = await sessionUser("driver");
});

afterAll(async () => {
  await db.$disconnect();
});

async function plannedTrip(state: "PLANNED" | "LOADING" = "PLANNED") {
  const f = await createTrip({
    serviceDate: freshServiceDate(),
    vehicleId: "VEH035",
    driverId: driver.id,
    state,
    stops: [
      { outletId: "OUT001", orders: [{ lines: [{ description: "Milk crate", units: 10 }, { description: "Yoghurt case", units: 4 }] }] },
      { outletId: "OUT002", orders: [{ lines: [{ description: "Bread tray", units: 6 }] }] },
    ],
  });
  const lines = f.orders.flatMap((o) => o.lines);
  return { ...f, lines };
}

async function version(tripId: string) {
  return (await db.trip.findUniqueOrThrow({ where: { id: tripId } })).version;
}

const act = (v: number, planRevision = 1) => ({ expectedVersion: v, planRevision });

describe("scope", () => {
  it("rejects a loader from another depot", async () => {
    const { trip } = await plannedTrip();
    await expect(send(kandy, startLoading, trip.id, act(trip.version))).rejects.toMatchObject({ status: 403 });
    await expect(loadLoaderTrip(db, kandy, trip.id)).rejects.toMatchObject({ status: 403 });
  });

  it("hides trips of unpublished plans", async () => {
    const { trip, plan } = await plannedTrip();
    await db.plan.update({ where: { id: plan.id }, data: { status: "DRAFT" } });
    await expect(loadLoaderTrip(db, loader, trip.id)).rejects.toMatchObject({ status: 404 });
  });

  it("builds a manifest with reverse loading order", async () => {
    const { trip } = await plannedTrip();
    const m = toLoaderManifestDto(await loadLoaderTrip(db, loader, trip.id));
    expect(m.stops.map((s) => [s.sequence, s.loadingSequence])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(m.readiness.blockers).toContain("Loading has not started yet");
  });
});

describe("start", () => {
  it("moves planned to loading once", async () => {
    const { trip } = await plannedTrip();
    const r = await send(loader, startLoading, trip.id, act(trip.version));
    expect(r.data).toMatchObject({ state: "LOADING", version: trip.version + 1 });
    await expect(send(loader, startLoading, trip.id, act(trip.version + 1))).rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  });

  it("rejects a stale version or revision", async () => {
    const { trip } = await plannedTrip();
    await expect(send(loader, startLoading, trip.id, act(trip.version + 5))).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(send(loader, startLoading, trip.id, act(trip.version, 2))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
});

describe("checks", () => {
  it("rejects unknown lines, overloads and damage above loaded", async () => {
    const { trip, lines } = await plannedTrip("LOADING");
    const v = trip.version;
    const other = await plannedTrip("LOADING");
    for (const checks of [
      [{ orderLineId: other.lines[0].id, loadedUnits: 1, damageUnits: 0 }],
      [{ orderLineId: lines[0].id, loadedUnits: 11, damageUnits: 0 }],
      [{ orderLineId: lines[0].id, loadedUnits: 3, damageUnits: 4 }],
    ]) {
      await expect(send(loader, recordChecks, trip.id, { ...act(v), checks })).rejects.toMatchObject({ status: 422 });
    }
    expect(await version(trip.id)).toBe(v);
  });

  it("schema rejects negative and fractional units", () => {
    for (const loadedUnits of [-1, 1.5]) {
      expect(loadingChecksSchema.safeParse({ ...act(1), checks: [{ orderLineId: "x", loadedUnits, damageUnits: 0 }] }).success).toBe(false);
    }
  });

  it("needs loading started and refuses edits after departure", async () => {
    const { trip, lines } = await plannedTrip();
    const checks = [{ orderLineId: lines[0].id, loadedUnits: 10, damageUnits: 0 }];
    await expect(send(loader, recordChecks, trip.id, { ...act(trip.version), checks })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await db.trip.update({ where: { id: trip.id }, data: { state: "IN_TRANSIT" } });
    await expect(send(loader, recordChecks, trip.id, { ...act(trip.version), checks })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("applies a batch atomically, bumps the version once and replays idempotently", async () => {
    const { trip, lines } = await plannedTrip("LOADING");
    const body = { ...act(trip.version), checks: lines.map((l) => ({ orderLineId: l.id, loadedUnits: l.orderedUnits, damageUnits: 0 })) };
    const key = randomUUID();
    const first = await send(loader, recordChecks, trip.id, body, key);
    const replay = await send(loader, recordChecks, trip.id, body, key);
    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(first.data);
    expect(await version(trip.id)).toBe(trip.version + 1);
    expect(await db.loadingCheck.count({ where: { tripId: trip.id } })).toBe(lines.length);
    expect(await db.auditLog.count({ where: { entityId: trip.id, action: "trip.loading_checks" } })).toBe(1);
  });
});

describe("shortfall to release", () => {
  it("blocks release until goods are corrected and the issue is resolved; the driver sees READY", async () => {
    const { trip, lines, orders } = await plannedTrip("LOADING");
    let v = trip.version;
    const full = (l: (typeof lines)[number]) => ({ orderLineId: l.id, loadedUnits: l.orderedUnits, damageUnits: 0 });

    await send(loader, recordChecks, trip.id, { ...act(v++), checks: [{ ...full(lines[0]), loadedUnits: 3 }, full(lines[1]), full(lines[2])] });
    const reported = await send(loader, reportIssue, trip.id, {
      ...act(v++),
      type: "SHORTFALL" as const,
      severity: "HIGH" as const,
      orderLineId: lines[0].id,
      text: "7 units missing: cold room empty",
    });
    const issueId = (reported.data as { issueId: string }).issueId;
    const issue = await db.issue.findUniqueOrThrow({ where: { id: issueId } });
    expect(issue).toMatchObject({ blocking: true, status: "OPEN", orderId: orders[0].id, tripId: trip.id, reporterRole: "LOADER" });

    await expect(send(loader, releaseTrip, trip.id, act(v))).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      details: { blockers: expect.arrayContaining(["1 line loaded short", "1 shortfall/damage issue not resolved"]) },
    });
    // Resolution is refused while the goods are still short: no override.
    await expect(resolve(loader, trip.id, issueId, { ...act(v), issueVersion: issue.version, resolution: "fixed" })).rejects.toMatchObject({
      status: 422,
      code: "CONSTRAINT",
    });

    await send(loader, recordChecks, trip.id, { ...act(v++), checks: [full(lines[0])] });
    await expect(send(loader, releaseTrip, trip.id, act(v))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await resolve(loader, trip.id, issueId, { ...act(v++), issueVersion: issue.version, resolution: "7 crates restocked" });
    expect((await db.issue.findUniqueOrThrow({ where: { id: issueId } })).status).toBe("RESOLVED");

    const released = await send(loader, releaseTrip, trip.id, act(v));
    expect(released.data).toMatchObject({ state: "READY", version: v + 1 });
    await expect(send(loader, releaseTrip, trip.id, act(v + 1))).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).state).toBe("READY");
  });

  it("a plan revision invalidates stale checks", async () => {
    const { trip, lines } = await plannedTrip("LOADING");
    const checks = lines.map((l) => ({ orderLineId: l.id, loadedUnits: l.orderedUnits, damageUnits: 0 }));
    await send(loader, recordChecks, trip.id, { ...act(trip.version), checks });
    // Dispatcher republishes: the trip moves to revision 2.
    await db.trip.update({ where: { id: trip.id }, data: { planRevision: 2, version: { increment: 1 } } });
    const v = trip.version + 2;
    await expect(send(loader, releaseTrip, trip.id, act(v, 1))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(send(loader, releaseTrip, trip.id, act(v, 2))).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining([expect.stringMatching(/older plan revision/)]) },
    });
    await send(loader, recordChecks, trip.id, { ...act(v, 2), checks });
    expect((await send(loader, releaseTrip, trip.id, act(v + 1, 2))).data).toMatchObject({ state: "READY" });
  });
});
