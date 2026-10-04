import { describe, expect, it } from "vitest";
import { projectTrip, returnDependencies, stopDependencies } from "@/features/driver/projection";
import type { DriverTripSnapshotDto } from "@/features/driver/types";
import type { PendingEvent } from "@/lib/offline/types";

function stop(id: string, sequence: number, state: "PENDING" | "ARRIVED" | "DELIVERED" = "PENDING") {
  return {
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
    state,
    version: 1,
    orders: [],
  };
}

const snapshot = {
  id: "t1",
  state: "IN_TRANSIT",
  version: 4,
  planRevision: 1,
  stops: [stop("s1", 1), stop("s2", 2)],
  issues: [],
  stopEvents: {},
} as unknown as DriverTripSnapshotDto;

let seq = 0;
function ev(over: Partial<PendingEvent>): PendingEvent {
  seq++;
  return {
    eventId: `e${seq}`,
    scopeKey: "k",
    seq,
    userId: "u",
    role: "DRIVER",
    entityType: "Stop",
    entityId: "s1",
    endpoint: "/x",
    method: "POST",
    payload: {},
    baseVersion: 1,
    planRevision: 1,
    dependsOnEventIds: [],
    clientAt: "2026-09-26T00:00:00.000Z",
    status: "pending",
    retryCount: 0,
    label: "",
    kind: "stop.arrive",
    meta: { tripId: "t1" },
    fileRefs: [],
    createdAt: "",
    ...over,
  };
}

describe("projectTrip", () => {
  const savedAt = "2026-09-26T00:00:00.000Z";

  it("keeps confirmed state and local state apart", () => {
    const arrive = ev({ kind: "stop.arrive" });
    const p = projectTrip(snapshot, savedAt, [arrive]);
    expect(p.stops[0].confirmedState).toBe("PENDING");
    expect(p.stops[0].state).toBe("ARRIVED");
    expect(p.stops[0].projectedVersion).toBe(2);
    expect(p.stops[0].localEvents).toHaveLength(1);
  });

  it("chains outcome on top of a queued arrival", () => {
    const arrive = ev({ kind: "stop.arrive" });
    const outcome = ev({ kind: "stop.outcome", payload: { outcome: "DELIVERED", lines: [] } });
    const p = projectTrip(snapshot, savedAt, [arrive, outcome]);
    expect(p.stops[0].state).toBe("DELIVERED");
    expect(p.stops[0].projectedVersion).toBe(3);
    expect(p.currentStopIndex).toBe(1);
  });

  it("uses the server version from an acknowledgement newer than the snapshot", () => {
    const acked = ev({ kind: "stop.arrive", status: "acknowledged", ackAt: "2026-09-26T00:05:00.000Z", result: { version: 2 } });
    const p = projectTrip(snapshot, savedAt, [acked]);
    expect(p.stops[0].state).toBe("ARRIVED");
    expect(p.stops[0].localEvents).toHaveLength(0);
    const fresh = projectTrip(snapshot, "2026-09-26T00:10:00.000Z", [acked]);
    expect(fresh.stops[0].state).toBe("PENDING"); // snapshot already reflects it
  });

  it("ignores other trips' events and flags conflicts", () => {
    const other = ev({ meta: { tripId: "t2" } });
    const conflicted = ev({ status: "conflict" });
    const p = projectTrip(snapshot, savedAt, [other, conflicted]);
    expect(p.stops[0].localEvents.map((e) => e.eventId)).toEqual([conflicted.eventId]);
    expect(p.stops[0].attention).toBe(true);
  });

  it("projects a queued return", () => {
    const ret = ev({ entityType: "Trip", entityId: "t1", kind: "trip.return" });
    const p = projectTrip(snapshot, savedAt, [ret]);
    expect(p.state).toBe("COMPLETED");
    expect(p.confirmedState).toBe("IN_TRANSIT");
  });
});

describe("dependencies", () => {
  it("arrival at stop 2 waits for stop 1's queued work; issues only for their own stop", () => {
    const a1 = ev({ kind: "stop.arrive" });
    const o1 = ev({ kind: "stop.outcome", payload: { outcome: "DELIVERED", lines: [] } });
    const p = projectTrip(snapshot, "2026-09-26T00:00:00.000Z", [a1, o1]);
    expect(stopDependencies(p, "s2", "stop.arrive").sort()).toEqual([a1.eventId, o1.eventId].sort());
    expect(stopDependencies(p, "s2", "stop.issue")).toEqual([]);
    expect(returnDependencies(p).sort()).toEqual([a1.eventId, o1.eventId].sort());
  });
});
