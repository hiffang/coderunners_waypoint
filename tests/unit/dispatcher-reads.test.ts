import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/auth", () => ({ auth: async () => null }));
import type { Tx } from "@/server/db";
import type { SessionUser } from "@/server/auth/guards";
import { planDetail, queue } from "@/features/dispatcher/server/service";

const actor: SessionUser = {
  id: "dispatcher", username: "dispatcher", name: "Dispatcher", role: "DISPATCHER",
  depotId: "depot-peliyagoda", outletId: null, vehicleId: null,
};

describe("dispatcher planning reads", () => {
  it("loads planning data once without overlapping queries on the connection", async () => {
    let busy = false;
    const read = <T>(result: T) => vi.fn(async () => {
      if (busy) throw new Error("Concurrent query on the transaction connection");
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 1));
      busy = false;
      return result;
    });
    const tx = {
      plan: { findUnique: read({
        id: "plan", depotId: actor.depotId, depot: { name: "Peliyagoda" },
        serviceDate: "2026-09-26", status: "DRAFT", revision: 1, version: 1,
        publishedAt: null, decisions: [], trips: [],
      }) },
      calendarDay: { findMany: read([]) },
      order: { findMany: read([]) },
      vehicle: { findMany: read([]) },
    };
    const result = await planDetail(tx as unknown as Tx, actor, "plan");
    expect(result.id).toBe("plan");
    expect(result.orders).toEqual([]);
    expect(result.counts.orders).toBe(0);
    expect(tx.calendarDay.findMany).toHaveBeenCalledTimes(1);
    expect(tx.order.findMany).toHaveBeenCalledTimes(1);
    expect(tx.vehicle.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(["2026-02-30", "bad-date"])("rejects invalid queue date %s before querying", async (date) => {
    const findMany = vi.fn();
    await expect(queue({ order: { findMany } } as unknown as Tx, actor, date))
      .rejects.toThrow("Choose a valid calendar date");
    expect(findMany).not.toHaveBeenCalled();
  });
});
