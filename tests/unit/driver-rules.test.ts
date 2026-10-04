import { describe, expect, it } from "vitest";
import { checkOutcome, derivedOrderStatus, type OutcomeLineContext } from "@/features/driver/outcome-rules";
import { departureReadiness, type ReadinessInput } from "@/features/driver/readiness";

const ctx: OutcomeLineContext[] = [
  { orderLineId: "milk", orderId: "o1", orderedUnits: 18, loadedUnits: 18 },
  { orderLineId: "yog", orderId: "o1", orderedUnits: 10, loadedUnits: 10 },
];
const full = [
  { orderLineId: "milk", deliveredUnits: 18, damagedUnits: 0 },
  { orderLineId: "yog", deliveredUnits: 10, damagedUnits: 0 },
];

describe("checkOutcome", () => {
  it("accepts a complete delivery", () => {
    const r = checkOutcome({ outcome: "DELIVERED", lines: full }, ctx);
    expect(r.ok).toBe(true);
  });
  it("rejects lines that are not on the stop, duplicates and over-delivery", () => {
    expect(checkOutcome({ outcome: "DELIVERED", lines: [...full, { orderLineId: "zzz", deliveredUnits: 1, damagedUnits: 0 }] }, ctx).ok).toBe(false);
    expect(checkOutcome({ outcome: "DELIVERED", lines: [...full, full[0]] }, ctx).ok).toBe(false);
    const over = checkOutcome({ outcome: "PARTIAL", note: "x", lines: [{ ...full[0], deliveredUnits: 19 }, full[1]] }, ctx);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.fieldErrors["lines.0.deliveredUnits"]).toBeTruthy();
  });
  it("does not let 'delivered' hide units the loader said were missing", () => {
    const short = ctx.map((c) => (c.orderLineId === "milk" ? { ...c, loadedUnits: 11 } : c));
    const lines = [{ orderLineId: "milk", deliveredUnits: 11, damagedUnits: 0 }, full[1]];
    expect(checkOutcome({ outcome: "DELIVERED", lines }, short).ok).toBe(false);
    expect(checkOutcome({ outcome: "PARTIAL", lines }, short).ok).toBe(false); // needs a cause
    expect(checkOutcome({ outcome: "PARTIAL", failureReason: "7 crates short at depot", lines }, short).ok).toBe(true);
  });
  it("requires every line for delivered/partial and none handed over for failed", () => {
    expect(checkOutcome({ outcome: "DELIVERED", lines: [full[0]] }, ctx).ok).toBe(false);
    expect(checkOutcome({ outcome: "FAILED", failureReason: "Closed", lines: [] }, ctx).ok).toBe(true);
    expect(checkOutcome({ outcome: "FAILED", failureReason: "Closed", lines: [full[0]] }, ctx).ok).toBe(false);
  });
  it("damaged units make it partial", () => {
    const lines = [{ orderLineId: "milk", deliveredUnits: 18, damagedUnits: 2 }, full[1]];
    expect(checkOutcome({ outcome: "DELIVERED", lines }, ctx).ok).toBe(false);
    expect(checkOutcome({ outcome: "PARTIAL", note: "2 crates crushed", lines }, ctx).ok).toBe(true);
  });
  it("rejects lines the loader never checked", () => {
    const unchecked = [{ ...ctx[0], loadedUnits: null }, ctx[1]];
    expect(checkOutcome({ outcome: "FAILED", failureReason: "x", lines: [] }, unchecked).ok).toBe(false);
  });
});

describe("derivedOrderStatus", () => {
  it("follows delivered quantities, not the stop outcome", () => {
    expect(derivedOrderStatus([{ orderedUnits: 5, deliveredUnits: 5, damagedUnits: 0 }])).toBe("DELIVERED");
    expect(derivedOrderStatus([{ orderedUnits: 5, deliveredUnits: 5, damagedUnits: 1 }])).toBe("PARTIALLY_DELIVERED");
    expect(derivedOrderStatus([{ orderedUnits: 5, deliveredUnits: 0, damagedUnits: 0 }])).toBe("ALLOCATED");
  });
});

describe("departureReadiness", () => {
  const base: ReadinessInput = {
    state: "READY",
    tripNumber: 1,
    planStatus: "PUBLISHED",
    vehicleStatus: "AVAILABLE",
    assignedToActor: true,
    openBlockingIssues: 0,
    planRevision: 2,
    lineIds: ["l1", "l2"],
    checks: [
      { orderLineId: "l1", planRevision: 2 },
      { orderLineId: "l2", planRevision: 2 },
    ],
    earlierTrips: [],
    vehicleBusyElsewhere: false,
  };
  it("allows a released, fully checked trip", () => {
    expect(departureReadiness(base)).toEqual({ canDepart: true, blockers: [] });
  });
  it.each<[string, Partial<ReadinessInput>, RegExp]>([
    ["unready", { state: "LOADING" }, /Loading is still in progress/],
    ["wrong driver", { assignedToActor: false }, /not assigned/],
    ["third route", { tripNumber: 3 }, /at most two trips/],
    ["blocking issue", { openBlockingIssues: 1 }, /issue not resolved/],
    ["workshop", { vehicleStatus: "IN_WORKSHOP" }, /workshop/],
    ["old revision checks", { checks: [{ orderLineId: "l1", planRevision: 1 }, { orderLineId: "l2", planRevision: 2 }] }, /revision 2/],
    ["trip 1 not back", { tripNumber: 2, earlierTrips: [{ tripNumber: 1, state: "IN_TRANSIT", returnedAt: null }] }, /Trip 1 has not returned/],
    ["vehicle busy", { vehicleBusyElsewhere: true }, /another trip/],
  ])("blocks: %s", (_name, patch, msg) => {
    const r = departureReadiness({ ...base, ...patch });
    expect(r.canDepart).toBe(false);
    expect(r.blockers.join(" | ")).toMatch(msg);
  });
});
