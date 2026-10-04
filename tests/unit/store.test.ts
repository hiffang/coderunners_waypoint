import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDto } from "@/shared/dto/order";
import { canReceive, isDisputed, receiptProblem } from "@/features/store/rules";

vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/server/db", () => ({
  db: { calendarDay: { findMany: async () => [] } },
}));
import {
  beforeOrderCutoff,
  validateDate,
  createOrder,
  loadOrder,
  receiveOrder,
} from "@/features/store/server/service";
import { derivedDay } from "@/server/calendar";
import type { SessionUser } from "@/server/auth/guards";

const actor: SessionUser = {
  id: "store",
  username: "store",
  role: "STORE",
  outletId: "OUT001",
  depotId: "depot",
  vehicleId: null,
};
const order = {
  id: "o",
  status: "PARTIALLY_DELIVERED",
  receipt: null,
  delivery: { submittedAt: "2026-09-26T04:00:00Z", outcome: "PARTIAL" },
  lines: [
    { id: "a", orderedUnits: 10, deliveredUnits: 8, deliveryDamagedUnits: 0 },
    { id: "b", orderedUnits: 4, deliveredUnits: 4, deliveryDamagedUnits: 0 },
  ],
} as OrderDto;
const receipt = [
  { orderLineId: "a", receivedUnits: 8, damageUnits: 0 },
  { orderLineId: "b", receivedUnits: 4, damageUnits: 0 },
];

beforeEach(() => {
  vi.stubEnv("APP_TIMEZONE", "Asia/Colombo");
  vi.stubEnv("DEMO_CLOCK", "2026-09-25T10:29:00Z");
});
describe("store receipt safeguards", () => {
  it("waits for synchronized delivery and blocks an existing receipt", () => {
    expect(canReceive(order)).toBe(true);
    expect(canReceive({ ...order, delivery: null })).toBe(false);
    expect(
      canReceive({
        ...order,
        delivery: { ...order.delivery!, submittedAt: null },
      }),
    ).toBe(false);
    expect(canReceive({ ...order, status: "ALLOCATED" })).toBe(false);
    expect(
      canReceive({
        ...order,
        receipt: { status: "DISPUTED" } as OrderDto["receipt"],
      }),
    ).toBe(false);
  });
  it("requires every line once and prevents cross-order, excess and damage quantities", () => {
    expect(receiptProblem(order, receipt)).toBeNull();
    expect(receiptProblem(order, [receipt[0]])).toBeTruthy();
    expect(receiptProblem(order, [receipt[0], receipt[0]])).toBeTruthy();
    expect(
      receiptProblem(order, [
        { ...receipt[0], orderLineId: "foreign" },
        receipt[1],
      ]),
    ).toBeTruthy();
    expect(
      receiptProblem(order, [{ ...receipt[0], receivedUnits: 9 }, receipt[1]]),
    ).toBeTruthy();
    expect(
      receiptProblem(order, [{ ...receipt[0], damageUnits: 9 }, receipt[1]]),
    ).toBeTruthy();
    expect(
      receiptProblem(order, [{ ...receipt[0], receivedUnits: -1 }, receipt[1]]),
    ).toBeTruthy();
  });
  it("preserves shortfall and driver damage as discrepancies even when received matches delivered", () => {
    expect(isDisputed(order, receipt)).toBe(true);
    const full = {
      ...order,
      lines: order.lines.map((l) => ({
        ...l,
        orderedUnits: l.deliveredUnits!,
      })),
    };
    expect(isDisputed(full, receipt)).toBe(false);
    expect(
      isDisputed(
        {
          ...full,
          lines: full.lines.map((l) => ({ ...l, deliveryDamagedUnits: 1 })),
        },
        receipt,
      ),
    ).toBe(true);
    expect(
      isDisputed(full, [{ ...receipt[0], damageUnits: 1 }, receipt[1]]),
    ).toBe(true);
  });
});
describe("store calendar and cutoff", () => {
  it("locks Saturday's run exactly at Friday 16:00 local time", () => {
    expect(beforeOrderCutoff("2026-09-26", derivedDay)).toBe(true);
    vi.stubEnv("DEMO_CLOCK", "2026-09-25T10:30:00Z");
    expect(beforeOrderCutoff("2026-09-26", derivedDay)).toBe(false);
    expect(() => validateDate("2026-09-26", derivedDay)).toThrow(/2026-09-28/);
    expect(() => validateDate("2026-09-28", derivedDay)).not.toThrow();
  });
  it("respects supplied holidays and rejects non-operating and impossible dates", () => {
    const lookup = (d: string) => ({
      ...derivedDay(d),
      ...(d === "2026-09-26" ? { isOperating: false } : {}),
    });
    expect(() => validateDate("2026-09-26", lookup)).toThrow();
    expect(() => validateDate("2026-09-27", derivedDay)).toThrow();
    expect(() => validateDate("2026-02-30", derivedDay)).toThrow(
      /valid calendar/,
    );
    expect(beforeOrderCutoff("2026-09-28", lookup)).toBe(true);
    vi.stubEnv("DEMO_CLOCK", "2026-09-25T10:30:00Z");
    expect(beforeOrderCutoff("2026-09-28", lookup)).toBe(false);
  });
});
describe("store server authorization", () => {
  it("queries order reads by the account outlet and rejects unknown orders", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(
      loadOrder(
        { order: { findFirst } } as unknown as Parameters<typeof loadOrder>[0],
        actor,
        "foreign",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: "foreign",
      outletId: "OUT001",
    });
  });
  it("blocks chilled orders for Tech before writing", async () => {
    const tx = {
      outlet: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "OUT001", brand: "TECH", depotId: "depot" }),
      },
      order: { create: vi.fn() },
    };
    await expect(
      createOrder(
        { tx, actor, audit: vi.fn() } as unknown as Parameters<
          typeof createOrder
        >[0],
        {
          requestedDate: "2026-09-26",
          temp: "CHILLED",
          lines: [
            {
              description: "Goods",
              orderedUnits: 1,
              unitWeightKg: 1,
              unitVolumeM3: 0.1,
            },
          ],
        },
        derivedDay,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(tx.order.create).not.toHaveBeenCalled();
  });
  it("rejects receipt before driver synchronization without creating receipt", async () => {
    const tx = {
      order: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: "o",
            outletId: "OUT001",
            outlet: { id: "OUT001", brand: "FRESH", district: "Colombo" },
            version: 2,
            status: "ALLOCATED",
            decisions: [],
            lines: [],
            totalUnits: 0,
            receipt: null,
          }),
      },
      receipt: { create: vi.fn() },
    };
    await expect(
      receiveOrder(
        { tx, actor, audit: vi.fn() } as unknown as Parameters<
          typeof receiveOrder
        >[0],
        "o",
        { expectedVersion: 2, lines: receipt, attachmentIds: [] },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.receipt.create).not.toHaveBeenCalled();
  });
});

function deliveredRow(partial = false) {
  const units = partial ? 8 : 10;
  const at = new Date("2026-09-26T04:00:00Z");
  return {
    id: "o",
    orderRef: "ORD-TEST",
    outletId: "OUT001",
    depotId: "depot",
    brand: "FRESH",
    temp: "AMBIENT",
    requestedDate: "2026-09-26",
    eligibleServiceDate: "2026-09-26",
    submittedAt: at,
    outlet: { id: "OUT001", brand: "FRESH", district: "Colombo" },
    version: 2,
    status: partial ? "PARTIALLY_DELIVERED" : "DELIVERED",
    totalUnits: 10,
    totalWeightKg: 10,
    totalVolumeM3: 1,
    decisions: [
      {
        decision: "SERVED",
        tripId: "trip",
        plan: { id: "plan", serviceDate: "2026-09-26", revision: 1 },
        trip: { id: "trip", tripNumber: 1, vehicleId: "VEH035" },
        stop: {
          id: "stop",
          sequence: 1,
          state: partial ? "PARTIAL" : "DELIVERED",
          plannedArrivalAt: at,
          etaAt: null,
          actualArrivalAt: at,
          proof: {
            outcome: partial ? "PARTIAL" : "DELIVERED",
            submittedAt: at,
            attachments: [],
          },
        },
      },
    ],
    lines: [
      {
        id: "a",
        lineNo: 1,
        description: "Milk crates",
        orderedUnits: 10,
        unitWeightKg: 1,
        unitVolumeM3: 0.1,
        loadingChecks: [{ tripId: "trip", loadedUnits: 10 }],
        deliveryOutcome: [
          { stopId: "stop", deliveredUnits: units, damagedUnits: 0 },
        ],
        receiptLines: [],
      },
    ],
    receipt: null,
  };
}
describe("receipt transaction effects", () => {
  it.each([false, true])(
    "records receipt with partial=%s and preserves the driver record",
    async (partial) => {
      const row = deliveredRow(partial);
      const tx = {
        order: {
          findFirst: vi.fn().mockResolvedValue(row),
          update: vi.fn().mockResolvedValue(row),
        },
        receipt: {
          create: vi
            .fn()
            .mockResolvedValue({
              id: "receipt",
              status: partial ? "DISPUTED" : "CONFIRMED",
            }),
        },
        issue: { create: vi.fn().mockResolvedValue({ id: "issue" }) },
        attachment: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const audit = vi.fn();
      await receiveOrder(
        { tx, actor, audit } as unknown as Parameters<typeof receiveOrder>[0],
        "o",
        {
          expectedVersion: 2,
          lines: [
            {
              orderLineId: "a",
              receivedUnits: partial ? 8 : 10,
              damageUnits: 0,
            },
          ],
          attachmentIds: [],
        },
      );
      expect(tx.receipt.create.mock.calls[0][0].data.status).toBe(
        partial ? "DISPUTED" : "CONFIRMED",
      );
      expect(tx.issue.create).toHaveBeenCalledTimes(partial ? 1 : 0);
      expect(tx.order.update.mock.calls[0][0].data.status).toBe(
        partial ? undefined : "RECEIVED",
      );
      expect(row.decisions[0].stop.proof.outcome).toBe(
        partial ? "PARTIAL" : "DELIVERED",
      );
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "order.receive" }),
      );
    },
  );
  it("rejects stale receipts before writing", async () => {
    const tx = {
      order: { findFirst: vi.fn().mockResolvedValue(deliveredRow()) },
      receipt: { create: vi.fn() },
    };
    await expect(
      receiveOrder(
        { tx, actor, audit: vi.fn() } as unknown as Parameters<
          typeof receiveOrder
        >[0],
        "o",
        {
          expectedVersion: 1,
          lines: [{ orderLineId: "a", receivedUnits: 10, damageUnits: 0 }],
          attachmentIds: [],
        },
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(tx.receipt.create).not.toHaveBeenCalled();
  });
});
