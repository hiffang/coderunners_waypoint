import type {
  OrderDto,
  OrderLineInput,
  ReceiptInput,
} from "@/shared/dto/order";

export function orderTotals(lines: OrderLineInput[]) {
  return lines.reduce(
    (t, l) => ({
      units: t.units + l.orderedUnits,
      weightKg: t.weightKg + l.orderedUnits * l.unitWeightKg,
      volumeM3: t.volumeM3 + l.orderedUnits * l.unitVolumeM3,
    }),
    { units: 0, weightKg: 0, volumeM3: 0 },
  );
}

export function canReceive(order: OrderDto) {
  return (
    !order.receipt &&
    ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status) &&
    Boolean(order.delivery?.submittedAt) &&
    ["DELIVERED", "PARTIAL"].includes(order.delivery?.outcome ?? "") &&
    order.lines.every((l) => l.deliveredUnits !== null)
  );
}

/** Require exactly one entry for every order line, bounded by the actual delivery. */
export function receiptProblem(
  order: OrderDto,
  lines: ReceiptInput["lines"],
): string | null {
  if (
    lines.length !== order.lines.length ||
    new Set(lines.map((l) => l.orderLineId)).size !== lines.length
  )
    return "Include every order line exactly once.";
  for (const line of lines) {
    const original = order.lines.find((l) => l.id === line.orderLineId);
    if (!original || original.deliveredUnits === null)
      return "Line does not belong to this confirmed delivery.";
    if (
      !Number.isInteger(line.receivedUnits) ||
      line.receivedUnits < 0 ||
      line.receivedUnits > original.deliveredUnits
    )
      return "Received units must be between zero and the delivered quantity.";
    if (
      !Number.isInteger(line.damageUnits) ||
      line.damageUnits < 0 ||
      line.damageUnits > line.receivedUnits
    )
      return "Damaged units cannot exceed received units.";
  }
  return null;
}

export function isDisputed(order: OrderDto, lines: ReceiptInput["lines"]) {
  return lines.some((l) => {
    const original = order.lines.find((o) => o.id === l.orderLineId)!;
    return (
      l.receivedUnits !== original.deliveredUnits ||
      l.receivedUnits !== original.orderedUnits ||
      l.damageUnits > 0 ||
      (original.deliveryDamagedUnits ?? 0) > 0
    );
  });
}
