import { describe, expect, it } from "vitest";
import * as Prisma from "@/generated/prisma/enums";
import * as Shared from "@/shared/dto/enums";
import { stopOutcomeSchema } from "@/shared/dto/manifest";
import { createOrderSchema } from "@/shared/dto/order";

describe("shared enums mirror the Prisma schema", () => {
  it.each([
    [Shared.BRANDS, Prisma.Brand],
    [Shared.TEMPS, Prisma.Temp],
    [Shared.VEHICLE_TYPES, Prisma.VehicleType],
    [Shared.VEHICLE_STATUSES, Prisma.VehicleStatus],
    [Shared.DOCK_TYPES, Prisma.DockType],
    [Shared.PARKING_CONSTRAINTS, Prisma.ParkingConstraint],
    [Shared.ORDER_STATUSES, Prisma.OrderStatus],
    [Shared.PLAN_STATUSES, Prisma.PlanStatus],
    [Shared.DECISION_TYPES, Prisma.DecisionType],
    [Shared.DEFERRAL_REASONS, Prisma.DeferralReason],
    [Shared.TRIP_STATES, Prisma.TripState],
    [Shared.STOP_STATES, Prisma.StopState],
    [Shared.ISSUE_TYPES, Prisma.IssueType],
    [Shared.ISSUE_SEVERITIES, Prisma.IssueSeverity],
    [Shared.ISSUE_STATUSES, Prisma.IssueStatus],
    [Shared.DELIVERY_OUTCOMES, Prisma.DeliveryOutcome],
    [Shared.RECEIPT_STATUSES, Prisma.ReceiptStatus],
    [Shared.FUEL_RESERVATION_STATES, Prisma.FuelReservationState],
  ])("%j", (shared, prisma) => {
    expect([...shared].sort()).toEqual(Object.values(prisma).sort());
  });
});

describe("shared input schemas", () => {
  const base = { expectedVersion: 1, planRevision: 1, lines: [], clientAt: "2026-09-26T00:30:00.000Z" };

  it("requires a failure reason for FAILED and evidence for delivered", () => {
    expect(stopOutcomeSchema.safeParse({ ...base, outcome: "FAILED" }).success).toBe(false);
    expect(stopOutcomeSchema.safeParse({ ...base, outcome: "FAILED", failureReason: "Shop closed" }).success).toBe(true);
    expect(stopOutcomeSchema.safeParse({ ...base, outcome: "DELIVERED" }).success).toBe(false);
    expect(stopOutcomeSchema.safeParse({ ...base, outcome: "DELIVERED", recipientName: "Nimal" }).success).toBe(true);
  });

  it("rejects damaged > delivered", () => {
    const r = stopOutcomeSchema.safeParse({
      ...base,
      outcome: "PARTIAL",
      recipientName: "Nimal",
      lines: [{ orderLineId: "x", deliveredUnits: 2, damagedUnits: 3 }],
    });
    expect(r.success).toBe(false);
  });

  it("orders need at least one positive line and never accept an outlet from the client", () => {
    expect(createOrderSchema.safeParse({ requestedDate: "2026-09-26", temp: "CHILLED", lines: [] }).success).toBe(false);
    const parsed = createOrderSchema.parse({
      requestedDate: "2026-09-26",
      temp: "CHILLED",
      outletId: "OUT099",
      lines: [{ description: "Milk", orderedUnits: 1, unitWeightKg: 1, unitVolumeM3: 0.01 }],
    });
    expect(parsed).not.toHaveProperty("outletId");
  });
});
