import "server-only";
import type { Tx } from "@/server/db";
import { assertDriverScope, type SessionUser } from "@/server/auth/guards";
import { conflict, constraintError, invalidTransition, notFound } from "@/server/http";
import { assertRevision, assertVersion, type AuditEntry } from "@/server/mutation";
import { now } from "@/server/time";
import { toNumber } from "@/server/decimal";
import type { DriverActionInput, StopOutcomeInput } from "@/shared/dto/manifest";
import type { DriverIssueInput } from "@/shared/dto/issue";
import { checkOutcome, derivedOrderStatus } from "../outcome-rules";
import { TERMINAL_STOP_STATES, type DriverMutationResult } from "../types";
import { driverTripInclude, loadDepartureContext, readinessFor } from "./snapshot";

/**
 * Driver write rules. Each function runs inside runMutation's serializable
 * transaction, after the idempotency check. Order of checks on every action:
 * scope (404/403) -> plan revision -> entity version -> state transition.
 * Stop actions use Stop.version; trip actions use Trip.version.
 */

type Ctx = { tx: Tx; actor: SessionUser; audit: (entry: AuditEntry) => Promise<void> };

const VISIBLE_PLAN = ["PUBLISHED", "COMPLETED"] as const;

async function loadStop(tx: Tx, actor: SessionUser, stopId: string) {
  const stop = await tx.stop.findUnique({
    where: { id: stopId },
    include: {
      trip: { include: { plan: { select: { status: true } } } },
      orders: { include: { order: { include: { lines: { orderBy: { lineNo: "asc" } } } } } },
    },
  });
  if (!stop || !VISIBLE_PLAN.includes(stop.trip.plan.status as (typeof VISIBLE_PLAN)[number])) {
    throw notFound("Stop not found");
  }
  assertDriverScope(actor, stop.trip.assignedDriverId);
  return stop;
}

export async function departTrip({ tx, actor, audit }: Ctx, tripId: string, input: DriverActionInput): Promise<DriverMutationResult> {
  const trip = await tx.trip.findUnique({ where: { id: tripId }, include: driverTripInclude });
  if (!trip || !VISIBLE_PLAN.includes(trip.plan.status as (typeof VISIBLE_PLAN)[number])) throw notFound("Trip not found");
  assertDriverScope(actor, trip.assignedDriverId);
  assertRevision(input.planRevision, trip.planRevision);
  assertVersion(input.expectedVersion, trip.version);

  const readiness = readinessFor(trip, actor, await loadDepartureContext(tx, trip));
  if (!readiness.canDepart) {
    throw invalidTransition(`Trip cannot depart: ${readiness.blockers.join("; ")}`, { blockers: readiness.blockers });
  }

  const at = now();
  const updated = await tx.trip.update({
    where: { id: trip.id, version: trip.version },
    data: { state: "IN_TRANSIT", departedAt: at, version: { increment: 1 } },
  });
  await audit({
    action: "trip.depart",
    entityType: "Trip",
    entityId: trip.id,
    before: { state: trip.state, version: trip.version },
    after: { state: updated.state, version: updated.version, departedAt: at.toISOString() },
    clientAt: input.clientAt,
    planRevision: trip.planRevision,
  });
  return { entityType: "Trip", entityId: trip.id, tripId: trip.id, version: updated.version, state: updated.state, serverAt: at.toISOString() };
}

export async function arriveAtStop({ tx, actor, audit }: Ctx, stopId: string, input: DriverActionInput): Promise<DriverMutationResult> {
  const stop = await loadStop(tx, actor, stopId);
  assertRevision(input.planRevision, stop.trip.planRevision);
  assertVersion(input.expectedVersion, stop.version);
  if (stop.trip.state !== "IN_TRANSIT") throw invalidTransition("Depart the trip before recording arrivals");
  if (stop.state !== "PENDING") throw invalidTransition(`Stop is already ${stop.state.toLowerCase()}`);

  const open = await tx.stop.findFirst({
    where: { tripId: stop.tripId, sequence: { lt: stop.sequence }, state: { notIn: [...TERMINAL_STOP_STATES] } },
    orderBy: { sequence: "asc" },
  });
  if (open) throw invalidTransition(`Finish stop ${open.sequence} before arriving at stop ${stop.sequence}`);

  const at = now();
  const updated = await tx.stop.update({
    where: { id: stop.id, version: stop.version },
    data: { state: "ARRIVED", actualArrivalAt: at, version: { increment: 1 } },
  });
  await audit({
    action: "stop.arrive",
    entityType: "Stop",
    entityId: stop.id,
    before: { state: stop.state, version: stop.version },
    after: { state: updated.state, version: updated.version, actualArrivalAt: at.toISOString() },
    clientAt: input.clientAt,
    planRevision: stop.trip.planRevision,
  });
  return { entityType: "Stop", entityId: stop.id, tripId: stop.tripId, version: updated.version, state: updated.state, serverAt: at.toISOString() };
}

export async function recordOutcome({ tx, actor, audit }: Ctx, stopId: string, input: StopOutcomeInput): Promise<DriverMutationResult> {
  const stop = await loadStop(tx, actor, stopId);
  assertRevision(input.planRevision, stop.trip.planRevision);
  assertVersion(input.expectedVersion, stop.version);
  if (stop.trip.state !== "IN_TRANSIT") throw invalidTransition("Trip is not on the road");
  if (stop.state !== "ARRIVED") {
    throw invalidTransition(stop.state === "PENDING" ? "Record arrival before the outcome" : `Stop is already ${stop.state.toLowerCase()}`);
  }

  const lineIds = stop.orders.flatMap((so) => so.order.lines.map((l) => l.id));
  const checks = await tx.loadingCheck.findMany({ where: { tripId: stop.tripId, orderLineId: { in: lineIds } } });
  const loaded = new Map(checks.map((c) => [c.orderLineId, c.loadedUnits]));
  const result = checkOutcome(
    input,
    stop.orders.flatMap((so) =>
      so.order.lines.map((l) => ({
        orderLineId: l.id,
        orderId: so.orderId,
        orderedUnits: l.orderedUnits,
        loadedUnits: loaded.get(l.id) ?? null,
      })),
    ),
  );
  if (!result.ok) throw constraintError(result.message, { fieldErrors: result.fieldErrors });

  // Evidence: provisional uploads by this driver, not yet linked anywhere.
  const fileIds = [...new Set(input.evidenceFileIds)];
  if (fileIds.length !== input.evidenceFileIds.length) {
    throw constraintError("Evidence listed twice", { fieldErrors: { evidenceFileIds: ["Duplicate file"] } });
  }
  if (fileIds.length > 0) {
    const files = await tx.attachment.findMany({ where: { id: { in: fileIds } } });
    const usable = files.filter((f) => f.uploadedById === actor.id && f.linkedAt === null && f.contentType.startsWith("image/"));
    if (usable.length !== fileIds.length) {
      throw constraintError("Evidence photo is missing, already used or not uploaded by you", {
        fieldErrors: { evidenceFileIds: ["Upload the photo again"] },
      });
    }
  }

  const at = now();
  const outcome = input.outcome;
  const proof = await tx.proofOfDelivery.create({
    data: {
      stopId: stop.id,
      outcome,
      recipientName: input.recipientName || null,
      note: input.note || null,
      failureReason: input.failureReason || null,
      capturedAt: new Date(input.clientAt), // device time, informational only
      submittedAt: at,
      recordedById: actor.id,
    },
  });
  await tx.deliveryLineOutcome.createMany({
    data: result.lines.map((l) => ({
      stopId: stop.id,
      orderLineId: l.orderLineId,
      loadedUnitsSnapshot: l.loadedUnitsSnapshot,
      deliveredUnits: l.deliveredUnits,
      damagedUnits: l.damagedUnits,
      createdAt: at,
    })),
  });
  if (fileIds.length > 0) {
    const linked = await tx.attachment.updateMany({
      where: { id: { in: fileIds }, uploadedById: actor.id, linkedAt: null },
      data: { proofId: proof.id, linkedAt: at },
    });
    if (linked.count !== fileIds.length) throw conflict("Evidence was linked by another request; retry");
  }

  const updated = await tx.stop.update({
    where: { id: stop.id, version: stop.version },
    data: { state: outcome, completedAt: at, version: { increment: 1 } },
  });

  // Parent orders follow their delivered lines, in the same transaction.
  for (const so of stop.orders) {
    const lines = result.lines.filter((l) => l.orderId === so.orderId);
    const status = derivedOrderStatus(lines);
    if (status !== so.order.status) {
      const order = await tx.order.update({
        where: { id: so.orderId, version: so.order.version },
        data: { status, version: { increment: 1 } },
      });
      await audit({
        action: "order.delivery",
        entityType: "Order",
        entityId: order.id,
        before: { status: so.order.status, version: so.order.version },
        after: { status: order.status, version: order.version, stopId: stop.id },
        clientAt: input.clientAt,
        planRevision: stop.trip.planRevision,
      });
    }
  }

  await audit({
    action: "stop.outcome",
    entityType: "Stop",
    entityId: stop.id,
    before: { state: stop.state, version: stop.version },
    after: {
      state: updated.state,
      version: updated.version,
      proofId: proof.id,
      recipientName: proof.recipientName,
      failureReason: proof.failureReason,
      evidence: fileIds,
      lines: result.lines.map((l) => ({ orderLineId: l.orderLineId, delivered: l.deliveredUnits, damaged: l.damagedUnits })),
    },
    clientAt: input.clientAt,
    planRevision: stop.trip.planRevision,
  });
  return {
    entityType: "Stop",
    entityId: stop.id,
    tripId: stop.tripId,
    version: updated.version,
    state: updated.state,
    serverAt: at.toISOString(),
    proofId: proof.id,
    attachmentIds: fileIds,
  };
}

export async function reportStopIssue({ tx, actor, audit }: Ctx, stopId: string, input: DriverIssueInput): Promise<DriverMutationResult> {
  const stop = await loadStop(tx, actor, stopId);
  assertRevision(input.planRevision, stop.trip.planRevision);
  assertVersion(input.expectedVersion, stop.version);
  if (stop.trip.state === "COMPLETED") throw invalidTransition("Trip is already completed");

  const at = now();
  const issue = await tx.issue.create({
    data: {
      type: input.type,
      severity: input.severity,
      blocking: false,
      tripId: stop.tripId,
      stopId: stop.id,
      orderId: stop.orders.length === 1 ? stop.orders[0].orderId : null,
      reporterId: actor.id,
      reporterRole: "DRIVER",
      text: input.text,
      clientAt: new Date(input.clientAt),
      createdAt: at,
    },
  });
  const updated = await tx.stop.update({
    where: { id: stop.id, version: stop.version },
    data: { version: { increment: 1 } },
  });
  await audit({
    action: "issue.create",
    entityType: "Issue",
    entityId: issue.id,
    after: { type: issue.type, severity: issue.severity, stopId: stop.id, tripId: stop.tripId },
    clientAt: input.clientAt,
    planRevision: stop.trip.planRevision,
  });
  return {
    entityType: "Stop",
    entityId: stop.id,
    tripId: stop.tripId,
    version: updated.version,
    state: updated.state,
    serverAt: at.toISOString(),
    issueId: issue.id,
  };
}

export async function returnTrip({ tx, actor, audit }: Ctx, tripId: string, input: DriverActionInput): Promise<DriverMutationResult> {
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    include: {
      plan: { select: { status: true } },
      stops: { select: { sequence: true, state: true }, orderBy: { sequence: "asc" } },
      fuelReservation: true,
    },
  });
  if (!trip || !VISIBLE_PLAN.includes(trip.plan.status as (typeof VISIBLE_PLAN)[number])) throw notFound("Trip not found");
  assertDriverScope(actor, trip.assignedDriverId);
  assertRevision(input.planRevision, trip.planRevision);
  assertVersion(input.expectedVersion, trip.version);
  if (trip.state !== "IN_TRANSIT") throw invalidTransition("Only a trip on the road can return");
  const open = trip.stops.filter((s) => !TERMINAL_STOP_STATES.includes(s.state));
  if (open.length > 0) {
    throw invalidTransition(`Stops ${open.map((s) => s.sequence).join(", ")} still need an outcome`, {
      openStops: open.map((s) => s.sequence),
    });
  }

  const at = now();
  const updated = await tx.trip.update({
    where: { id: trip.id, version: trip.version },
    data: { state: "COMPLETED", returnedAt: at, version: { increment: 1 } },
  });

  // Fuel: reserved -> consumed exactly once. The state guard makes a second
  // conversion impossible even outside the idempotency layer.
  let fuel: DriverMutationResult["fuel"] = null;
  const r = trip.fuelReservation;
  if (r && r.state === "RESERVED") {
    const moved = await tx.tripFuelReservation.updateMany({ where: { id: r.id, state: "RESERVED" }, data: { state: "CONSUMED" } });
    if (moved.count !== 1) throw conflict("Fuel reservation changed concurrently; retry");
    await tx.vehicleWeekFuel.update({
      where: { id: r.fuelWeekId },
      data: { reservedLiters: { decrement: r.liters }, consumedLiters: { increment: r.liters }, version: { increment: 1 } },
    });
    fuel = { liters: toNumber(r.liters) ?? 0, estimated: true, state: "CONSUMED" };
    await audit({
      action: "fuel.consume",
      entityType: "TripFuelReservation",
      entityId: r.id,
      before: { state: "RESERVED" },
      after: { state: "CONSUMED", liters: fuel.liters, basis: "planned liters used as estimated consumption (no telemetry)" },
      clientAt: input.clientAt,
      planRevision: trip.planRevision,
    });
  }

  await audit({
    action: "trip.return",
    entityType: "Trip",
    entityId: trip.id,
    before: { state: trip.state, version: trip.version },
    after: { state: updated.state, version: updated.version, returnedAt: at.toISOString() },
    clientAt: input.clientAt,
    planRevision: trip.planRevision,
  });
  return { entityType: "Trip", entityId: trip.id, tripId: trip.id, version: updated.version, state: updated.state, serverAt: at.toISOString(), fuel };
}
