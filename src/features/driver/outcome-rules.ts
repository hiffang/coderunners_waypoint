// Pure proof-of-delivery quantity rules. The outcome endpoint runs these inside
// its transaction; the outcome form runs them for early feedback only.
import type { DeliveryOutcome, OrderStatus } from "@/shared/dto/enums";

export type OutcomeLineContext = {
  orderLineId: string;
  orderId: string;
  orderedUnits: number;
  /** Loader's checked quantity for this trip; null = never checked. */
  loadedUnits: number | null;
};

export type OutcomeLineInput = { orderLineId: string; deliveredUnits: number; damagedUnits: number };

export type NormalizedLine = OutcomeLineInput & { orderId: string; orderedUnits: number; loadedUnitsSnapshot: number };

export type OutcomeCheck =
  | { ok: true; lines: NormalizedLine[] }
  | { ok: false; message: string; fieldErrors: Record<string, string[]> };

export function checkOutcome(
  input: { outcome: DeliveryOutcome; lines: OutcomeLineInput[]; failureReason?: string; note?: string },
  context: OutcomeLineContext[],
): OutcomeCheck {
  const errors: Record<string, string[]> = {};
  const add = (key: string, msg: string) => (errors[key] ??= []).push(msg);
  const byId = new Map(context.map((c) => [c.orderLineId, c]));
  const submitted = new Map<string, OutcomeLineInput>();

  input.lines.forEach((l, i) => {
    if (!byId.has(l.orderLineId)) add(`lines.${i}.orderLineId`, "Line is not part of this stop");
    else if (submitted.has(l.orderLineId)) add(`lines.${i}.orderLineId`, "Line submitted twice");
    else submitted.set(l.orderLineId, l);
  });

  const lines: NormalizedLine[] = [];
  context.forEach((c) => {
    const i = input.lines.findIndex((l) => l.orderLineId === c.orderLineId);
    const key = i >= 0 ? `lines.${i}` : `lines.${c.orderLineId}`;
    const given = submitted.get(c.orderLineId);
    if (c.loadedUnits === null) {
      add(key, "Loader never checked this line; it cannot be delivered");
      return;
    }
    if (!given && input.outcome !== "FAILED") {
      add(key, "Every line needs a delivered quantity");
      return;
    }
    const delivered = given?.deliveredUnits ?? 0;
    const damaged = given?.damagedUnits ?? 0;
    if (delivered > c.loadedUnits) add(`${key}.deliveredUnits`, `Only ${c.loadedUnits} were loaded`);
    if (damaged > delivered) add(`${key}.damagedUnits`, "Damaged cannot exceed delivered");
    lines.push({
      orderLineId: c.orderLineId,
      orderId: c.orderId,
      orderedUnits: c.orderedUnits,
      loadedUnitsSnapshot: c.loadedUnits,
      deliveredUnits: delivered,
      damagedUnits: damaged,
    });
  });

  if (Object.keys(errors).length === 0) {
    const anyDelivered = lines.some((l) => l.deliveredUnits > 0);
    const complete = lines.every(
      (l) => l.deliveredUnits === l.orderedUnits && l.loadedUnitsSnapshot === l.orderedUnits && l.damagedUnits === 0,
    );
    const cause = Boolean(input.failureReason?.trim() || input.note?.trim());
    if (input.outcome === "DELIVERED" && !complete) {
      add("outcome", "Delivered means every ordered unit arrived undamaged; record this as partial with a reason");
    }
    if (input.outcome === "PARTIAL") {
      if (!anyDelivered) add("outcome", "Nothing was delivered; record this as failed");
      else if (complete) add("outcome", "Everything was delivered; record this as delivered");
      if (!cause) add("failureReason", "Say why the delivery was partial");
    }
    if (input.outcome === "FAILED" && anyDelivered) add("outcome", "A failed delivery cannot hand over goods");
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Delivered quantities do not match the outcome", fieldErrors: errors };
  }
  return { ok: true, lines };
}

/** Order status derived from its delivered lines, never from the client. */
export function derivedOrderStatus(lines: Array<{ orderedUnits: number; deliveredUnits: number; damagedUnits: number }>): OrderStatus {
  if (lines.length > 0 && lines.every((l) => l.deliveredUnits - l.damagedUnits >= l.orderedUnits)) return "DELIVERED";
  if (lines.some((l) => l.deliveredUnits > 0)) return "PARTIALLY_DELIVERED";
  // Driver failure leaves the order allocated; the dispatcher defers it explicitly.
  return "ALLOCATED";
}
