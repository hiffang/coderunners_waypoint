import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { assertOutletScope, type SessionUser } from "@/server/auth/guards";
import {
  constraintError,
  invalidTransition,
  notFound,
  forbidden,
  HttpError,
} from "@/server/http";
import { assertVersion, type AuditEntry } from "@/server/mutation";
import {
  orderInclude,
  issueInclude,
  toOrderDto,
  toIssueDto,
} from "@/server/dto";
import {
  loadCalendar,
  earliestEligibleDate,
  ORDER_CUTOFF,
  type CalendarLookup,
} from "@/server/calendar";
import { now, localDate, addDays, isBeforeCutoff } from "@/server/time";
import { BRAND_TEMPS } from "@/shared/dto/enums";
import type {
  CreateOrderInput,
  UpdateOrderInput,
  CancelOrderInput,
  ReceiptInput,
} from "@/shared/dto/order";
import type { StoreIssueInput } from "@/shared/dto/issue";
import { canReceive, isDisputed, receiptProblem } from "../rules";

type Context = {
  tx: Tx;
  actor: SessionUser;
  audit: (entry: AuditEntry) => Promise<void>;
};

export async function loadOrder(
  client: Pick<Tx, "order">,
  actor: SessionUser,
  id: string,
) {
  const row = await client.order.findFirst({
    where: { id, outletId: actor.outletId ?? "__none__" },
    include: orderInclude,
  });
  if (!row) throw notFound("Order not found for your outlet");
  assertOutletScope(actor, row.outletId);
  return row;
}

export async function calendarFor(requested: string) {
  if (
    !Number.isFinite(Date.parse(requested)) ||
    new Date(`${requested}T00:00:00Z`).toISOString().slice(0, 10) !== requested
  )
    throw constraintError("Choose a valid calendar date");
  const today = localDate(now());
  const days = Math.max(
    60,
    Math.ceil((Date.parse(requested) - Date.parse(today)) / 86400000) + 7,
  );
  return loadCalendar(
    addDays(today < requested ? today : requested, -60),
    days + 120,
  );
}

export function validateDate(requested: string, lookup: CalendarLookup) {
  if (
    !Number.isFinite(Date.parse(requested)) ||
    new Date(`${requested}T00:00:00Z`).toISOString().slice(0, 10) !== requested
  )
    throw constraintError("Choose a valid calendar date");
  const earliest = earliestEligibleDate(now(), lookup);
  if (requested < earliest)
    throw constraintError(
      `Cutoff or calendar has changed. Earliest eligible run is ${earliest}. Choose that date or a later operating day.`,
      { earliestEligibleDate: earliest },
    );
  if (!lookup(requested).isOperating)
    throw constraintError("The selected date is not an operating day");
}

export function beforeOrderCutoff(serviceDate: string, lookup: CalendarLookup) {
  let previous = addDays(serviceDate, -1);
  for (let i = 0; i < 60; i++, previous = addDays(previous, -1)) {
    if (lookup(previous).isOperating)
      return isBeforeCutoff(previous, ORDER_CUTOFF, now());
  }
  return false;
}

function lineData(lines: CreateOrderInput["lines"]) {
  // Match database precision before calculating authoritative totals.
  const data = lines.map((l, i) => ({
    lineNo: i + 1,
    description: l.description,
    orderedUnits: l.orderedUnits,
    unitWeightKg: new Prisma.Decimal(l.unitWeightKg).toDecimalPlaces(3),
    unitVolumeM3: new Prisma.Decimal(l.unitVolumeM3).toDecimalPlaces(4),
  }));
  const totals = data.reduce(
    (t, l) => ({
      totalUnits: t.totalUnits + l.orderedUnits,
      totalWeightKg: t.totalWeightKg.plus(l.unitWeightKg.times(l.orderedUnits)),
      totalVolumeM3: t.totalVolumeM3.plus(l.unitVolumeM3.times(l.orderedUnits)),
    }),
    {
      totalUnits: 0,
      totalWeightKg: new Prisma.Decimal(0),
      totalVolumeM3: new Prisma.Decimal(0),
    },
  );
  totals.totalWeightKg = totals.totalWeightKg.toDecimalPlaces(2);
  totals.totalVolumeM3 = totals.totalVolumeM3.toDecimalPlaces(3);
  if (totals.totalWeightKg.gte(100000000) || totals.totalVolumeM3.gte(10000000))
    throw constraintError("Order measurements exceed the supported totals");
  return { data, totals };
}

export async function createOrder(
  { tx, actor, audit }: Context,
  input: CreateOrderInput,
  lookup: CalendarLookup,
) {
  const outlet = actor.outletId
    ? await tx.outlet.findUnique({ where: { id: actor.outletId } })
    : null;
  if (!outlet) throw forbidden("Account has no authorized outlet");
  assertOutletScope(actor, outlet.id);
  validateDate(input.requestedDate, lookup);
  if (!BRAND_TEMPS[outlet.brand].includes(input.temp))
    throw constraintError("Temperature is not permitted for your brand");
  const { data, totals } = lineData(input.lines);
  const row = await tx.order.create({
    data: {
      id: randomUUID(),
      orderRef: `ORD-${localDate(now()).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      outletId: outlet.id,
      depotId: outlet.depotId,
      createdById: actor.id,
      brand: outlet.brand,
      temp: input.temp,
      requestedDate: input.requestedDate,
      eligibleServiceDate: input.requestedDate,
      submittedAt: now(),
      status: "CONFIRMED",
      ...totals,
      lines: { create: data },
    },
    include: orderInclude,
  });
  await audit({
    action: "order.submit",
    entityType: "Order",
    entityId: row.id,
    after: {
      orderRef: row.orderRef,
      eligibleServiceDate: row.eligibleServiceDate,
      totals,
    },
  });
  return toOrderDto(row);
}

async function assertEditable(
  tx: Tx,
  row: Awaited<ReturnType<typeof loadOrder>>,
  lookup: CalendarLookup,
) {
  if (
    !["DRAFT", "CONFIRMED"].includes(row.status) ||
    row.decisions.length ||
    !beforeOrderCutoff(row.eligibleServiceDate, lookup)
  )
    throw invalidTransition(
      "Order is locked by cutoff or published allocation",
    );
  // Never delete lines that a manifest or loading check has already snapshotted.
  if (
    (await tx.stopOrder.count({ where: { orderId: row.id } })) ||
    row.lines.some((l) => l.loadingChecks.length || l.deliveryOutcome.length)
  )
    throw invalidTransition("Order already appears on a manifest");
}

export async function updateOrder(
  ctx: Context,
  id: string,
  input: UpdateOrderInput,
  lookup: CalendarLookup,
) {
  const row = await loadOrder(ctx.tx, ctx.actor, id);
  assertVersion(input.expectedVersion, row.version);
  await assertEditable(ctx.tx, row, lookup);
  const date = input.requestedDate ?? row.requestedDate;
  validateDate(date, lookup);
  const temp = input.temp ?? row.temp;
  if (!BRAND_TEMPS[row.brand].includes(temp))
    throw constraintError("Temperature is not permitted for your brand");
  const replacement = input.lines ? lineData(input.lines) : null;
  if (replacement)
    await ctx.tx.orderLine.deleteMany({ where: { orderId: id } });
  const updated = await ctx.tx.order.update({
    where: { id, version: row.version },
    data: {
      requestedDate: date,
      eligibleServiceDate: date,
      temp,
      version: { increment: 1 },
      ...(replacement
        ? { ...replacement.totals, lines: { create: replacement.data } }
        : {}),
    },
    include: orderInclude,
  });
  await ctx.audit({
    action: "order.edit",
    entityType: "Order",
    entityId: id,
    before: toOrderDto(row),
    after: toOrderDto(updated),
  });
  return toOrderDto(updated);
}

export async function cancelOrder(
  ctx: Context,
  id: string,
  input: CancelOrderInput,
  lookup: CalendarLookup,
) {
  const row = await loadOrder(ctx.tx, ctx.actor, id);
  assertVersion(input.expectedVersion, row.version);
  await assertEditable(ctx.tx, row, lookup);
  const updated = await ctx.tx.order.update({
    where: { id, version: row.version },
    data: {
      status: "CANCELLED",
      cancelledAt: now(),
      cancelReason: input.reason,
      version: { increment: 1 },
    },
    include: orderInclude,
  });
  await ctx.audit({
    action: "order.cancel",
    entityType: "Order",
    entityId: id,
    before: { status: row.status },
    after: { status: updated.status, reason: input.reason },
  });
  return toOrderDto(updated);
}

async function linkAttachments(
  tx: Tx,
  actor: SessionUser,
  ids: string[],
  link: { receiptId: string } | { issueId: string },
) {
  if (new Set(ids).size !== ids.length)
    throw constraintError("Duplicate attachment");
  const files = await tx.attachment.findMany({
    where: { id: { in: ids }, uploadedById: actor.id, linkedAt: null },
  });
  if (files.length !== ids.length)
    throw forbidden("Attachment is unavailable or outside your scope");
  if (ids.length)
    await tx.attachment.updateMany({
      where: { id: { in: ids }, uploadedById: actor.id, linkedAt: null },
      data: { ...link, linkedAt: now() },
    });
}

export async function receiveOrder(
  ctx: Context,
  id: string,
  input: ReceiptInput,
) {
  const row = await loadOrder(ctx.tx, ctx.actor, id);
  assertVersion(input.expectedVersion, row.version);
  const order = toOrderDto(row);
  if (!canReceive(order))
    throw invalidTransition(
      "Receipt requires a synchronized delivery and no existing receipt",
    );
  const problem = receiptProblem(order, input.lines);
  if (problem) throw constraintError(problem);
  const disputed = isDisputed(order, input.lines);
  const receipt = await ctx.tx.receipt.create({
    data: {
      orderId: id,
      storeUserId: ctx.actor.id,
      receivedAt: now(),
      status: disputed ? "DISPUTED" : "CONFIRMED",
      note: input.note,
      lines: { create: input.lines },
    },
  });
  await linkAttachments(ctx.tx, ctx.actor, input.attachmentIds, {
    receiptId: receipt.id,
  });
  if (disputed) {
    const differences = input.lines
      .map((l) => {
        const original = order.lines.find((o) => o.id === l.orderLineId)!;
        return `${original.description}: ordered ${original.orderedUnits}, delivered ${original.deliveredUnits}, received ${l.receivedUnits}, damaged ${l.damageUnits}`;
      })
      .join("; ");
    const issue = await ctx.tx.issue.create({
      data: {
        orderId: id,
        type: "RECEIPT",
        severity: "HIGH",
        reporterId: ctx.actor.id,
        reporterRole: "STORE",
        text: `Receipt discrepancy: ${differences}. ${input.note ?? ""}`,
        createdAt: now(),
      },
    });
    await ctx.audit({
      action: "issue.report",
      entityType: "Issue",
      entityId: issue.id,
      after: { orderId: id, receiptId: receipt.id },
    });
  }
  const updated = await ctx.tx.order.update({
    where: { id, version: row.version },
    data: {
      version: { increment: 1 },
      ...(!disputed ? { status: "RECEIVED" as const } : {}),
    },
    include: orderInclude,
  });
  await ctx.audit({
    action: "order.receive",
    entityType: "Order",
    entityId: id,
    after: {
      receiptId: receipt.id,
      status: receipt.status,
      lines: input.lines,
    },
  });
  return toOrderDto(updated);
}

export async function reportIssue(
  ctx: Context,
  id: string,
  input: StoreIssueInput,
) {
  const row = await loadOrder(ctx.tx, ctx.actor, id);
  assertVersion(input.expectedVersion, row.version);
  const issue = await ctx.tx.issue.create({
    data: {
      orderId: id,
      type: input.type,
      severity: input.severity,
      text: input.text,
      reporterId: ctx.actor.id,
      reporterRole: "STORE",
      createdAt: now(),
    },
  });
  await linkAttachments(ctx.tx, ctx.actor, input.attachmentIds, {
    issueId: issue.id,
  });
  await ctx.tx.order.update({
    where: { id, version: row.version },
    data: { version: { increment: 1 } },
  });
  await ctx.audit({
    action: "issue.report",
    entityType: "Issue",
    entityId: issue.id,
    after: { orderId: id, text: input.text },
  });
  return toIssueDto(
    await ctx.tx.issue.findUniqueOrThrow({
      where: { id: issue.id },
      include: issueInclude,
    }),
  );
}

export async function readOrder(actor: SessionUser, id: string) {
  const row = await loadOrder(db, actor, id);
  const lookup = await calendarFor(row.eligibleServiceDate);
  let editable = false;
  try {
    await assertEditable(db, row, lookup);
    editable = true;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
  const issues = await db.issue.findMany({
    where: { orderId: id },
    include: issueInclude,
    orderBy: { createdAt: "desc" },
  });
  return {
    order: toOrderDto(row),
    editable,
    issues: issues.map(toIssueDto),
    serverTime: now().toISOString(),
  };
}
