import type { OrderDto } from "@/shared/dto/order";
import type { OutletDto, VehicleDto } from "@/shared/dto/reference";
import type {
  ConstraintViolation,
  PlanDecisionsInput,
} from "@/shared/dto/plan";

export type Decision = PlanDecisionsInput["decisions"][number];
export type PlanningOrder = OrderDto & {
  outlet: OutletDto;
  alreadyServed?: boolean;
};
export type PlanningVehicle = VehicleDto & {
  usedFuel: number;
  fuelQuota: number;
  occupiedTrips: number[];
};
export type PlanningInput = {
  depotId: string;
  depotName: string;
  serviceDate: string;
  operating: boolean;
  orders: PlanningOrder[];
  vehicles: PlanningVehicle[];
};
export type ScheduledTrip = {
  key: string;
  vehicleId: string;
  tripNumber: number;
  orders: PlanningOrder[];
  departure: number;
  returned: number;
  distance: number;
  fuel: number;
  weight: number;
  volume: number;
  stops: {
    outletId: string;
    sequence: number;
    arrival: number;
    orderIds: string[];
  }[];
};
export const ESTIMATE_NOTE =
  "Estimated travel: district round trips, 30 km/h, 5 km between outlets, 15 minutes per stop and 30 minutes reload. Departures start at 04:00. Whole-order, single-brand and single-district trips are MVP planning policies.";
// Explicit planning estimates, not measured routes or Datathon predictions.
const DISTANCE: Record<string, Record<string, number>> = {
  Peliyagoda: {
    Colombo: 15,
    Gampaha: 30,
    Kalutara: 55,
    Galle: 120,
    Matara: 160,
    Kurunegala: 85,
    Puttalam: 130,
  },
  Kandy: {
    Kandy: 15,
    Matale: 30,
    "Nuwara Eliya": 75,
    Badulla: 115,
    Kegalle: 45,
  },
};
const minute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const EPS = 0.000001;
export function priority(o: PlanningOrder) {
  return o.temp !== "AMBIENT" && o.outlet.parkingConstraint === "VAN_ONLY"
    ? 0
    : o.temp !== "AMBIENT"
      ? 1
      : o.outlet.parkingConstraint === "VAN_ONLY"
        ? 2
        : o.brand === "FRESH"
          ? 3
          : 4;
}
export function priorityNote(o: PlanningOrder) {
  return `Capability tier ${priority(o) + 1}; ${o.priorDeferrals.length} prior missed service days; window closes ${o.outlet.windowClose}`;
}

export function validatePlan(
  input: PlanningInput,
  decisions: Decision[],
  complete = true,
) {
  const violations: ConstraintViolation[] = [];
  const fail = (
    code: ConstraintViolation["code"],
    message: string,
    extra: Partial<ConstraintViolation> = {},
  ) => violations.push({ code, message, ...extra });
  if (!input.operating)
    fail("NOT_ELIGIBLE", "The service date is not an operating day.");
  const seen = new Set<string>();
  const groups = new Map<
    string,
    {
      vehicleId: string;
      tripNumber: number;
      entries: { order: PlanningOrder; sequence: number }[];
    }
  >();
  for (const d of decisions) {
    const o = input.orders.find((x) => x.id === d.orderId);
    if (seen.has(d.orderId))
      fail("MISSING_DECISION", "An order must have exactly one decision.", {
        orderId: d.orderId,
      });
    seen.add(d.orderId);
    if (!o) {
      fail("NOT_ELIGIBLE", "Order is outside this plan's eligible queue.", {
        orderId: d.orderId,
      });
      continue;
    }
    if (o.depotId !== input.depotId)
      fail("WRONG_DEPOT", "Order belongs to another depot.", { orderId: o.id });
    if (
      o.eligibleServiceDate > input.serviceDate ||
      !["CONFIRMED", "DEFERRED", "ALLOCATED"].includes(o.status)
    )
      fail("NOT_ELIGIBLE", "Order is not eligible for this run.", {
        orderId: o.id,
      });
    if (o.alreadyServed)
      fail("ALREADY_SERVED", "Order already has an active served allocation.", {
        orderId: o.id,
      });
    if (d.decision === "DEFERRED") {
      if (!d.reasonCode || !d.reasonText?.trim())
        fail("DEFERRAL_REASON", "Choose a reason and explain the deferral.", {
          orderId: o.id,
        });
      continue;
    }
    if (!d.vehicleId || !d.tripNumber || !d.stopSequence) {
      fail("MISSING_INPUT", "Select a vehicle, trip and stop position.", {
        orderId: o.id,
      });
      continue;
    }
    const key = `${d.vehicleId}/${d.tripNumber}`;
    if (!groups.has(key))
      groups.set(key, {
        vehicleId: d.vehicleId,
        tripNumber: d.tripNumber,
        entries: [],
      });
    groups.get(key)!.entries.push({ order: o, sequence: d.stopSequence });
  }
  if (complete)
    for (const o of input.orders)
      if (!seen.has(o.id))
        fail(
          "MISSING_DECISION",
          `${o.orderRef} needs an assignment or deferral.`,
          { orderId: o.id },
        );
  const trips: ScheduledTrip[] = [];
  const returnByVehicle = new Map<string, number>();
  const fuelByVehicle = new Map<string, number>();
  for (const [key, group] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const v = input.vehicles.find((x) => x.id === group.vehicleId);
    if (!v) {
      fail("WRONG_DEPOT", "Vehicle is outside this depot.", {
        vehicleId: group.vehicleId,
      });
      continue;
    }
    const extra = { vehicleId: v.id, tripId: key };
    if (v.depotId !== input.depotId)
      fail("WRONG_DEPOT", "Vehicle belongs to another depot.", extra);
    if (v.status !== "AVAILABLE")
      fail("VEHICLE_UNAVAILABLE", `${v.id} is in the workshop.`, extra);
    if (!v.driver)
      fail("NO_DRIVER", `${v.id} has no active assigned driver.`, extra);
    if (
      ![1, 2].includes(group.tripNumber) ||
      v.occupiedTrips.includes(group.tripNumber)
    )
      fail(
        "TRIP_LIMIT",
        `${v.id} trip ${group.tripNumber} is unavailable.`,
        extra,
      );
    if (group.tripNumber === 2 && !returnByVehicle.has(v.id))
      fail(
        "SEQUENTIAL_TRIP",
        "Plan trip 1 before trip 2; existing external trips cannot be rescheduled here.",
        extra,
      );
    const entries = group.entries.sort(
      (a, b) => a.sequence - b.sequence || a.order.id.localeCompare(b.order.id),
    );
    const orders = entries.map((e) => e.order);
    const first = orders[0];
    if (
      orders.some(
        (o) => o.brand !== first.brand || o.district !== first.district,
      )
    )
      fail(
        "MISSING_INPUT",
        "MVP policy: each trip must have one brand and one district.",
        extra,
      );
    const distance = DISTANCE[input.depotName]?.[first.district];
    if (!distance) {
      fail(
        "MISSING_INPUT",
        `No travel estimate configured for ${input.depotName} to ${first.district}.`,
        extra,
      );
      continue;
    }
    const weight = orders.reduce((sum, o) => sum + o.totals.weightKg, 0);
    const volume = orders.reduce((sum, o) => sum + o.totals.volumeM3, 0);
    if (weight > v.weightCapKg + EPS)
      fail(
        "WEIGHT",
        `${v.id} exceeds weight by ${(weight - v.weightCapKg).toFixed(2)} kg.`,
        {
          ...extra,
          amount: { value: weight, limit: v.weightCapKg, unit: "kg" },
        },
      );
    if (volume > v.volumeCapM3 + EPS)
      fail(
        "VOLUME",
        `${v.id} exceeds volume by ${(volume - v.volumeCapM3).toFixed(3)} m³.`,
        {
          ...extra,
          amount: { value: volume, limit: v.volumeCapM3, unit: "m3" },
        },
      );
    const departure = Math.max(240, (returnByVehicle.get(v.id) ?? 210) + 30);
    let at = departure;
    const stops: ScheduledTrip["stops"] = [];
    const sequenceOutlets = new Map<number, string>();
    for (const { order: o, sequence } of entries) {
      if (o.temp !== "AMBIENT" && !v.refrigerated)
        fail("REFRIGERATION", `${o.orderRef} needs refrigeration.`, {
          ...extra,
          orderId: o.id,
        });
      if (o.outlet.parkingConstraint === "VAN_ONLY" && v.type !== "VAN")
        fail("VAN_ONLY", `${o.outletId} permits vans only.`, {
          ...extra,
          orderId: o.id,
        });
      if (
        sequenceOutlets.has(sequence) &&
        sequenceOutlets.get(sequence) !== o.outletId
      )
        fail(
          "MISSING_INPUT",
          "Different outlets cannot share a stop position.",
          extra,
        );
      sequenceOutlets.set(sequence, o.outletId);
      const previous = stops.at(-1);
      if (
        previous?.outletId === o.outletId &&
        entries.find((e) => e.order.id === previous.orderIds[0])?.sequence ===
          sequence
      ) {
        previous.orderIds.push(o.id);
        continue;
      }
      at += stops.length ? 10 : distance * 2;
      at = Math.max(
        at,
        minute(o.outlet.windowOpen),
        o.outlet.mallWindowOpen ? minute(o.outlet.mallWindowOpen) : 0,
      );
      const close = Math.min(
        minute(o.outlet.windowClose),
        o.brand === "FRESH" ? 479 : 1440,
      );
      if (at > close)
        fail(
          "WINDOW",
          `${o.orderRef} arrives after its delivery window (estimated ${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}).`,
          {
            ...extra,
            orderId: o.id,
            amount: { value: at, limit: close, unit: "min" },
          },
        );
      if (o.outlet.mallWindowClose && at > minute(o.outlet.mallWindowClose))
        fail("MALL_WINDOW", `${o.outletId} misses mall access.`, {
          ...extra,
          orderId: o.id,
        });
      stops.push({
        outletId: o.outletId,
        sequence: stops.length + 1,
        arrival: at,
        orderIds: [o.id],
      });
      at += 15;
    }
    const returned = at + distance * 2;
    const roundTrip = distance * 2 + Math.max(0, stops.length - 1) * 5;
    const fuel = Math.ceil(roundTrip * v.fuelLitersPerKm * 100) / 100;
    const used = (fuelByVehicle.get(v.id) ?? 0) + fuel;
    fuelByVehicle.set(v.id, used);
    if (used + v.usedFuel > v.fuelQuota + EPS)
      fail(
        "FUEL_QUOTA",
        `${v.id} exceeds its weekly fuel quota by ${(used + v.usedFuel - v.fuelQuota).toFixed(2)} L.`,
        {
          ...extra,
          amount: { value: used + v.usedFuel, limit: v.fuelQuota, unit: "L" },
        },
      );
    if (returned >= 1440)
      fail(
        "SEQUENTIAL_TRIP",
        "Trip must return within the service day.",
        extra,
      );
    returnByVehicle.set(v.id, returned);
    trips.push({
      key,
      vehicleId: v.id,
      tripNumber: group.tripNumber,
      orders,
      departure,
      returned,
      distance: roundTrip,
      fuel,
      weight,
      volume,
      stops,
    });
  }
  return { valid: violations.length === 0, violations, trips };
}

export function allocate(input: PlanningInput): Decision[] {
  const decisions: Decision[] = [];
  const orders = [...input.orders].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      b.priorDeferrals.length - a.priorDeferrals.length ||
      a.outlet.windowClose.localeCompare(b.outlet.windowClose) ||
      a.id.localeCompare(b.id),
  );
  for (const o of orders) {
    let chosen: Decision | undefined;
    let failures: ConstraintViolation[] = [];
    const compatibleFailures: ConstraintViolation[] = [];
    const vehicles = [...input.vehicles].sort(
      (a, b) =>
        Number(a.refrigerated) - Number(b.refrigerated) ||
        Number(a.type === "VAN") - Number(b.type === "VAN") ||
        a.weightCapKg - b.weightCapKg ||
        a.id.localeCompare(b.id),
    );
    for (const tripNumber of [1, 2] as const) {
      for (const v of vehicles) {
        const existing = decisions.filter(
          (d) => d.vehicleId === v.id && d.tripNumber === tripNumber,
        );
        const atOutlet = existing.find(
          (d) =>
            input.orders.find((x) => x.id === d.orderId)?.outletId ===
            o.outletId,
        );
        const candidate: Decision = {
          orderId: o.id,
          decision: "SERVED",
          vehicleId: v.id,
          tripNumber,
          stopSequence:
            atOutlet?.stopSequence ??
            Math.max(0, ...existing.map((d) => d.stopSequence ?? 0)) + 1,
        };
        const validation = validatePlan(
          input,
          [...decisions, candidate],
          false,
        );
        if (validation.valid) {
          chosen = candidate;
          break;
        }
        failures.push(...validation.violations);
        if (
          (o.temp === "AMBIENT" || v.refrigerated) &&
          (o.outlet.parkingConstraint !== "VAN_ONLY" || v.type === "VAN") &&
          v.status === "AVAILABLE" &&
          v.driver
        ) {
          compatibleFailures.push(...validation.violations);
        }
      }
      if (chosen) break;
    }
    const codes: Partial<
      Record<ConstraintViolation["code"], NonNullable<Decision["reasonCode"]>>
    > = {
      WEIGHT: "CAPACITY_WEIGHT",
      VOLUME: "CAPACITY_VOLUME",
      FUEL_QUOTA: "FUEL_QUOTA",
      WINDOW: "DELIVERY_WINDOW",
      MALL_WINDOW: "ACCESS_MALL_WINDOW",
      REFRIGERATION: "NO_REFRIGERATED_VEHICLE",
      VAN_ONLY: "ACCESS_VAN_ONLY",
      TRIP_LIMIT: "TRIP_LIMIT",
      VEHICLE_UNAVAILABLE: "VEHICLE_UNAVAILABLE",
    };
    if (compatibleFailures.length) failures = compatibleFailures;
    failures = [...new Map(failures.map((f) => [f.message, f])).values()];
    decisions.push(
      chosen ?? {
        orderId: o.id,
        decision: "DEFERRED",
        reasonCode: codes[failures[0]?.code] ?? "OTHER",
        reasonText:
          `Assisted allocation found no feasible slot under current assignments. ${failures
            .slice(0, 5)
            .map((f) => f.message)
            .join(" ")} Manual reassignment may help.`.slice(0, 1000),
      },
    );
  }
  return decisions;
}
