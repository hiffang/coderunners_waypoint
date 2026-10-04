import { describe, expect, it } from "vitest";
import { loadingOrder, projectManifest } from "@/features/loader/projection";
import { lineStatus, loadingReadiness } from "@/features/loader/readiness";
import type { LoaderManifestDto } from "@/features/loader/types";
import type { PendingEvent } from "@/lib/offline/types";
import type { LoadingCheckDto } from "@/shared/dto/manifest";

function check(loaded: number, damage = 0, planRevision = 1): LoadingCheckDto {
  return {
    orderLineId: "x",
    expectedUnits: 10,
    loadedUnits: loaded,
    damageUnits: damage,
    note: null,
    planRevision,
    checkedAt: "2026-09-25T22:00:00.000Z",
    checkedBy: { id: "u", name: "Loader" },
  };
}

function manifest(over: Partial<LoaderManifestDto> = {}, checks: Array<LoadingCheckDto | null> = [null, null]): LoaderManifestDto {
  const line = (id: string, n: number) => ({
    orderLineId: id,
    lineNo: n,
    description: `Line ${n}`,
    expectedUnits: 10,
    unitWeightKg: 1,
    unitVolumeM3: 0.01,
    check: checks[n - 1] ? { ...checks[n - 1]!, orderLineId: id } : null,
  });
  const stop = (id: string, sequence: number, lines: ReturnType<typeof line>[]) => ({
    stopId: id,
    sequence,
    loadingSequence: 3 - sequence,
    outletId: `OUT00${sequence}`,
    outletLabel: `OUT00${sequence} · Fresh Colombo`,
    district: "Colombo",
    parkingConstraint: "NORMAL" as const,
    windowOpen: "05:00",
    windowClose: "07:30",
    mallWindowOpen: null,
    mallWindowClose: null,
    plannedArrivalAt: "2026-09-25T23:30:00.000Z",
    etaAt: null,
    plannedServiceMin: 20,
    state: "PENDING" as const,
    version: 1,
    orders: [{ orderId: `o${sequence}`, orderRef: `ORD-${sequence}`, temp: "AMBIENT" as const, totals: { units: 10, weightKg: 10, volumeM3: 0.1 }, lines }],
  });
  return {
    id: "t1",
    state: "LOADING",
    version: 3,
    planRevision: 1,
    refrigerated: false,
    stops: [stop("s1", 1, [line("l1", 1)]), stop("s2", 2, [line("l2", 2)])],
    issues: [],
    ...over,
  } as unknown as LoaderManifestDto;
}

let seq = 0;
function ev(over: Partial<PendingEvent>): PendingEvent {
  seq++;
  return {
    eventId: `e${seq}`,
    scopeKey: "LOADER:u:D1",
    seq,
    userId: "u",
    role: "LOADER",
    entityType: "Trip",
    entityId: "t1",
    endpoint: "/api/loader/trips/t1/checks",
    method: "PUT",
    payload: {},
    baseVersion: 3,
    planRevision: 1,
    dependsOnEventIds: [],
    clientAt: "2026-09-25T22:10:00.000Z",
    status: "pending",
    retryCount: 0,
    label: "",
    kind: "loader.checks",
    meta: { tripId: "t1" },
    fileRefs: [],
    createdAt: "2026-09-25T22:10:00.000Z",
    ...over,
  };
}

describe("lineStatus", () => {
  it("separates unchecked from a deliberate zero", () => {
    expect(lineStatus({ expectedUnits: 10, check: null }, 1)).toBe("unchecked");
    expect(lineStatus({ expectedUnits: 10, check: check(0) }, 1)).toBe("short");
  });
  it("flags checks against an older revision", () => {
    expect(lineStatus({ expectedUnits: 10, check: check(10, 0, 1) }, 2)).toBe("stale");
  });
  it("needs every unit loaded undamaged", () => {
    expect(lineStatus({ expectedUnits: 10, check: check(10, 1) }, 1)).toBe("damaged");
    expect(lineStatus({ expectedUnits: 10, check: check(10) }, 1)).toBe("ok");
  });
});

describe("loadingReadiness", () => {
  it("releases only a fully verified loading trip without blocking issues", () => {
    expect(loadingReadiness(manifest({}, [check(10), check(10)])).canRelease).toBe(true);
  });

  it("explains each blocker", () => {
    const r = loadingReadiness(
      manifest(
        {
          issues: [{ blocking: true, status: "OPEN" }, { blocking: false, status: "OPEN" }, { blocking: true, status: "RESOLVED" }] as never,
        },
        [check(3), null],
      ),
    );
    expect(r.canRelease).toBe(false);
    expect(r.blockers).toEqual(["1 line not checked yet", "1 line loaded short", "1 shortfall/damage issue not resolved"]);
    expect(r).toMatchObject({ totalLines: 2, checkedLines: 1, shortLines: 1, openBlockingIssues: 1 });
  });

  it("refuses planned or already released trips", () => {
    expect(loadingReadiness(manifest({ state: "PLANNED" }, [check(10), check(10)])).canRelease).toBe(false);
    expect(loadingReadiness(manifest({ state: "READY" }, [check(10), check(10)])).canRelease).toBe(false);
  });

  it("invalidates checks after a plan revision", () => {
    const r = loadingReadiness(manifest({ planRevision: 2 }, [check(10, 0, 1), check(10, 0, 2)]));
    expect(r.staleLines).toBe(1);
    expect(r.canRelease).toBe(false);
  });

  it("blocks chilled goods on a vehicle without refrigeration", () => {
    const m = manifest({}, [check(10), check(10)]);
    (m.stops[0].orders[0] as { temp: string }).temp = "CHILLED";
    expect(loadingReadiness(m).blockers).toContain("Chilled goods are planned on a vehicle without refrigeration");
  });
});

describe("loadingOrder", () => {
  it("loads the last delivery first", () => {
    expect(loadingOrder(manifest().stops).map((s) => s.sequence)).toEqual([2, 1]);
  });
});

describe("projectManifest", () => {
  const saved = "2026-09-25T22:00:00.000Z";

  it("shows queued checks apart from server checks and chains the version", () => {
    const e = ev({ payload: { expectedVersion: 3, planRevision: 1, checks: [{ orderLineId: "l1", loadedUnits: 7, damageUnits: 0 }] } });
    const p = projectManifest(manifest(), saved, [e]);
    const l1 = p.stops[0].orders[0].lines[0];
    expect(l1.local).toMatchObject({ loadedUnits: 7, status: "pending" });
    expect(l1.check).toBeNull(); // the server copy stays as it was
    expect(l1.status).toBe("short");
    expect(p.projectedVersion).toBe(4);
    expect(p.localEvents).toHaveLength(1);
    expect(p.localReadiness.shortLines).toBe(1);
  });

  it("projects a queued start and counts queued shortfall reports as blocking", () => {
    const start = ev({ kind: "loader.start", payload: { expectedVersion: 3, planRevision: 1 } });
    const issue = ev({ kind: "loader.issue", payload: { expectedVersion: 4, planRevision: 1, type: "SHORTFALL", severity: "HIGH", orderId: "o1", text: "7 missing" } });
    const p = projectManifest(manifest({ state: "PLANNED" }), saved, [start, issue]);
    expect(p.state).toBe("LOADING");
    expect(p.confirmedState).toBe("PLANNED");
    expect(p.projectedVersion).toBe(5);
    expect(p.localIssues).toHaveLength(1);
    expect(p.localReadiness.openBlockingIssues).toBe(1);
  });

  it("uses the acknowledged version and drops events older than the snapshot", () => {
    const old = ev({ status: "acknowledged", ackAt: "2026-09-25T21:00:00.000Z", result: { version: 3 } });
    const fresh = ev({
      status: "acknowledged",
      ackAt: "2026-09-25T22:30:00.000Z",
      result: { version: 9 },
      payload: { expectedVersion: 3, planRevision: 1, checks: [{ orderLineId: "l2", loadedUnits: 10, damageUnits: 0 }] },
    });
    const p = projectManifest(manifest(), saved, [old, fresh]);
    expect(p.projectedVersion).toBe(9);
    expect(p.localEvents).toHaveLength(0);
    expect(p.stops[1].orders[0].lines[0]).toMatchObject({ local: null, status: "ok" });
  });

  it("flags queued work from another plan revision", () => {
    const e = ev({ planRevision: 1, status: "conflict", payload: { expectedVersion: 3, planRevision: 1, checks: [] } });
    const p = projectManifest(manifest({ planRevision: 2 }), saved, [e]);
    expect(p.revisionMismatch).toBe(true);
    expect(p.attention).toBe(true);
  });
});
