import { describe, expect, it } from "vitest";
import {
  allocate,
  validatePlan,
  type Decision,
  type PlanningInput,
  type PlanningOrder,
  type PlanningVehicle,
} from "@/features/dispatcher/server/planning/engine";

const vehicle = (patch: Partial<PlanningVehicle> = {}): PlanningVehicle => ({
  id: "VEH001",
  depotId: "depot",
  type: "VAN",
  refrigerated: true,
  weightCapKg: 1000,
  volumeCapM3: 10,
  fuelLitersPerKm: 0.1,
  weeklyFuelQuotaLiters: 100,
  status: "AVAILABLE",
  driver: { id: "driver", name: "Driver" },
  usedFuel: 0,
  fuelQuota: 100,
  occupiedTrips: [],
  ...patch,
});
const order = (patch: Partial<PlanningOrder> = {}): PlanningOrder => ({
  id: "order1",
  orderRef: "ORD-1",
  outletId: "OUT001",
  outletLabel: "OUT001 · Fresh Colombo",
  district: "Colombo",
  depotId: "depot",
  brand: "FRESH",
  temp: "CHILLED",
  requestedDate: "2026-09-26",
  eligibleServiceDate: "2026-09-26",
  submittedAt: "2026-09-25T08:00:00Z",
  status: "CONFIRMED",
  version: 1,
  totals: { units: 10, weightKg: 500, volumeM3: 2 },
  lines: [],
  allocation: null,
  deferral: null,
  priorDeferrals: [],
  delivery: null,
  receipt: null,
  followUpOfId: null,
  outlet: {
    id: "OUT001",
    depotId: "depot",
    depotName: "Peliyagoda",
    brand: "FRESH",
    district: "Colombo",
    dockType: "STREET",
    parkingConstraint: "VAN_ONLY",
    windowOpen: "05:00",
    windowClose: "07:30",
    mallWindowOpen: null,
    mallWindowClose: null,
  },
  ...patch,
});
const input = (orders = [order()], vehicles = [vehicle()]): PlanningInput => ({
  depotId: "depot",
  depotName: "Peliyagoda",
  serviceDate: "2026-09-26",
  operating: true,
  orders,
  vehicles,
});
const assign = (
  orderId = "order1",
  patch: Partial<Decision> = {},
): Decision => ({
  orderId,
  decision: "SERVED",
  vehicleId: "VEH001",
  tripNumber: 1,
  stopSequence: 1,
  ...patch,
});
const codes = (i: PlanningInput, decisions = [assign()]) =>
  validatePlan(i, decisions).violations.map((v) => v.code);

describe("dispatcher shared planning validator", () => {
  it("includes outbound travel, waiting, handling, return travel and rounded fuel", () => {
    const result = validatePlan(input(), [assign()]);
    expect(result.valid).toBe(true);
    expect(result.trips[0]).toMatchObject({
      departure: 240,
      returned: 345,
      distance: 30,
      fuel: 3,
      stops: [{ arrival: 300 }],
    });
  });
  it("keeps dry and chilled orders at one outlet distinct, with one shared stop", () => {
    const result = validatePlan(
      input([order(), order({ id: "dry", temp: "AMBIENT" })]),
      [assign(), assign("dry")],
    );
    expect(result.valid).toBe(true);
    expect(result.trips[0].stops[0].orderIds).toEqual(["dry", "order1"]);
    expect(result.trips[0].weight).toBe(1000);
  });
  it.each([
    ["REFRIGERATION", { refrigerated: false }],
    ["VAN_ONLY", { type: "TRUCK" }],
    ["WRONG_DEPOT", { depotId: "other" }],
    ["WEIGHT", { weightCapKg: 499 }],
    ["VOLUME", { volumeCapM3: 1.9 }],
    ["NO_DRIVER", { driver: null }],
    ["VEHICLE_UNAVAILABLE", { status: "IN_WORKSHOP" }],
    ["FUEL_QUOTA", { usedFuel: 98 }],
    ["TRIP_LIMIT", { occupiedTrips: [1] }],
  ] as Array<[string, Partial<PlanningVehicle>]>)("rejects %s", (code, patch) =>
    expect(codes(input([order()], [vehicle(patch)]))).toContain(code),
  );
  it("enforces both capacity dimensions across whole orders", () => {
    const result = codes(
      input([
        order(),
        order({ id: "extra", totals: { units: 1, weightKg: 1, volumeM3: 9 } }),
      ]),
      [assign(), assign("extra")],
    );
    expect(result).toContain("VOLUME");
    expect(result).not.toContain("WEIGHT");
  });
  it("requires one decision per eligible order and a reason for each deferral", () => {
    expect(codes(input(), [])).toContain("MISSING_DECISION");
    expect(codes(input(), [assign(), assign()])).toContain("MISSING_DECISION");
    expect(
      codes(input(), [{ orderId: "order1", decision: "DEFERRED" }]),
    ).toContain("DEFERRAL_REASON");
    expect(validatePlan(input(), [], false).valid).toBe(true);
  });
  it.each([
    { status: "CANCELLED" },
    { eligibleServiceDate: "2026-09-28" },
  ] as Partial<PlanningOrder>[])("rejects ineligible order %o", (patch) =>
    expect(codes(input([order(patch)]))).toContain("NOT_ELIGIBLE"),
  );
  it("rejects another active allocation, wrong depot and nonoperating date", () => {
    expect(codes(input([order({ alreadyServed: true })]))).toContain(
      "ALREADY_SERVED",
    );
    expect(codes(input([order({ depotId: "other" })]))).toContain(
      "WRONG_DEPOT",
    );
    expect(codes({ ...input(), operating: false })).toContain("NOT_ELIGIBLE");
  });
  it("enforces the stricter outlet window and Fresh strictly before 08:00", () => {
    const o = order();
    expect(
      codes(
        input([
          {
            ...o,
            outlet: { ...o.outlet, windowOpen: "04:00", windowClose: "04:20" },
          },
        ]),
      ),
    ).toContain("WINDOW");
    expect(
      codes(
        input([
          {
            ...o,
            outlet: { ...o.outlet, windowOpen: "08:00", windowClose: "09:00" },
          },
        ]),
      ),
    ).toContain("WINDOW");
  });
  it("enforces mall access windows", () => {
    const o = order({ brand: "STYLE", temp: "AMBIENT" });
    expect(
      codes(
        input([
          {
            ...o,
            outlet: {
              ...o.outlet,
              windowOpen: "09:00",
              windowClose: "18:00",
              mallWindowOpen: "04:00",
              mallWindowClose: "08:00",
            },
          },
        ]),
      ),
    ).toContain("MALL_WINDOW");
  });
  it("waits for return and reload before the second trip and sums weekly fuel", () => {
    const i = input(
      [order(), order({ id: "second" })],
      [vehicle({ usedFuel: 95 })],
    );
    const result = validatePlan(i, [
      assign(),
      assign("second", { tripNumber: 2 }),
    ]);
    expect(result.trips[1].departure).toBe(result.trips[0].returned + 30);
    expect(result.violations.map((v) => v.code)).toContain("FUEL_QUOTA");
    expect(codes(input(), [assign("order1", { tripNumber: 2 })])).toContain(
      "SEQUENTIAL_TRIP",
    );
    expect(
      codes(input(), [assign("order1", { tripNumber: 3 as 1 })]),
    ).toContain("TRIP_LIMIT");
  });
  it("fails visibly when no travel estimate is configured", () =>
    expect(codes({ ...input(), depotName: "Unknown" })).toContain(
      "MISSING_INPUT",
    ));
  it("rejects mixed brand/district trips and conflicting stop positions", () => {
    const other = order({
      id: "second",
      brand: "TECH",
      district: "Gampaha",
      outletId: "OUT002",
    });
    expect(
      codes(input([order(), other]), [assign(), assign("second")]),
    ).toContain("MISSING_INPUT");
  });
});
describe("deterministic assisted allocation", () => {
  it("preserves refrigerated vans for capability-constrained orders", () => {
    const dry = order({
      id: "dry",
      temp: "AMBIENT",
      outlet: { ...order().outlet, parkingConstraint: "NORMAL" },
    });
    const i = input(
      [dry, order()],
      [vehicle(), vehicle({ id: "DRY", refrigerated: false, type: "TRUCK" })],
    );
    const decisions = allocate(i);
    expect(decisions.find((d) => d.orderId === "dry")?.vehicleId).toBe("DRY");
    expect(validatePlan(i, decisions).valid).toBe(true);
    expect(
      allocate({
        ...i,
        orders: [...i.orders].reverse(),
        vehicles: [...i.vehicles].reverse(),
      }),
    ).toEqual(decisions);
  });
  it("prioritizes previously missed runs within capability tiers and explains deferrals", () => {
    const older = order({
      id: "older",
      priorDeferrals: [
        { serviceDate: "2026-09-25", reasonCode: "CAPACITY_WEIGHT" },
      ],
    });
    const i = input(
      [order(), older],
      [vehicle({ weightCapKg: 500, fuelQuota: 3 })],
    );
    const decisions = allocate(i);
    expect(decisions[0]).toMatchObject({
      orderId: "older",
      decision: "SERVED",
    });
    expect(decisions[1]).toMatchObject({
      orderId: "order1",
      decision: "DEFERRED",
    });
    expect(decisions[1].reasonText).toContain("Manual reassignment may help");
    expect(validatePlan(i, decisions).valid).toBe(true);
  });
});
