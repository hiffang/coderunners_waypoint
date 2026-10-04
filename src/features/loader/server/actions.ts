import "server-only";
import type { Tx } from "@/server/db";
import type { SessionUser } from "@/server/auth/guards";
import { constraintError, invalidTransition, notFound } from "@/server/http";
import { assertRevision, assertVersion, type AuditEntry } from "@/server/mutation";
import { now } from "@/server/time";
import type { LoaderIssueInput } from "@/shared/dto/issue";
import type { LoaderTripActionInput, LoadingChecksInput } from "@/shared/dto/manifest";
import { lineStatus, loadingReadiness } from "../readiness";
import type { LoaderMutationResult, LoaderResolveIssueInput } from "../types";
import { loadLoaderTrip, type LoaderTripRow } from "./manifest";
import { toManifestDto } from "@/server/dto";

/**
 * Loader write rules. Each function runs inside runMutation's serializable
 * transaction, after the idempotency check. Order of checks on every action:
 * scope (404/403) -> plan revision -> Trip.version -> state transition -> payload.
 * Every accepted action bumps Trip.version exactly once.
 */

type Ctx = { tx: Tx; actor: SessionUser; audit: (entry: AuditEntry) => Promise<void> };

const DEPARTED = ["IN_TRANSIT", "COMPLETED"] as const;

async function loadForWrite(ctx: Ctx, tripId: string, input: { expectedVersion: number; planRevision: number }) {
  const trip = await loadLoaderTrip(ctx.tx, ctx.actor, tripId);
  assertRevision(input.planRevision, trip.planRevision);
  assertVersion(input.expectedVersion, trip.version);
  return trip;
}

function assertNotDeparted(trip: LoaderTripRow) {
  if ((DEPARTED as readonly string[]).includes(trip.state)) {
    throw invalidTransition("Trip has already departed; loading can no longer change");
  }
}

/** Every order line planned on the trip, keyed by id. */
function tripLines(trip: LoaderTripRow) {
  const lines = new Map<string, { id: string; orderId: string; orderRef: string; orderedUnits: number; lineNo: number }>();
  for (const s of trip.stops) {
    for (const { order } of s.orders) {
      for (const l of order.lines) {
        lines.set(l.id, { id: l.id, orderId: order.id, orderRef: order.orderRef, orderedUnits: l.orderedUnits, lineNo: l.lineNo });
      }
    }
  }
  return lines;
}

function result(trip: { id: string; version: number; planRevision: number; state: LoaderTripRow["state"] }, extra: Partial<LoaderMutationResult> = {}): LoaderMutationResult {
  return { tripId: trip.id, version: trip.version, planRevision: trip.planRevision, state: trip.state, serverAt: now().toISOString(), ...extra };
}

/** planned -> loading. Requires the published current revision. */
export async function startLoading(ctx: Ctx, tripId: string, input: LoaderTripActionInput): Promise<LoaderMutationResult> {
  const trip = await loadForWrite(ctx, tripId, input);
  if (trip.plan.status !== "PUBLISHED") throw invalidTransition("Plan is no longer open for loading");
  if (trip.state !== "PLANNED") throw invalidTransition(`Loading cannot start: trip is ${trip.state.toLowerCase()}`);

  const at = now();
  const updated = await ctx.tx.trip.update({
    where: { id: trip.id, version: trip.version },
    data: { state: "LOADING", loadingStartedAt: at, version: { increment: 1 } },
  });
  await ctx.audit({
    action: "trip.loading_start",
    entityType: "Trip",
    entityId: trip.id,
    before: { state: trip.state, version: trip.version },
    after: { state: updated.state, version: updated.version },
    planRevision: trip.planRevision,
  });
  return result(updated);
}

/**
 * Atomic batch of line checks. Each line must belong to the trip; loaded <=
 * expected, damaged <= loaded. A check on a released trip sends it back to
 * loading (its readiness no longer holds).
 */
export async function recordChecks(ctx: Ctx, tripId: string, input: LoadingChecksInput): Promise<LoaderMutationResult> {
  const trip = await loadForWrite(ctx, tripId, input);
  assertNotDeparted(trip);
  if (trip.state === "PLANNED") throw invalidTransition("Start loading before recording checks");

  const lines = tripLines(trip);
  const fieldErrors: Record<string, string[]> = {};
  const seen = new Set<string>();
  input.checks.forEach((c, i) => {
    const line = lines.get(c.orderLineId);
    const err = (msg: string) => (fieldErrors[`checks.${i}`] ??= []).push(msg);
    if (!line) return err("Order line is not on this trip");
    if (seen.has(c.orderLineId)) err("Line appears twice in this batch");
    seen.add(c.orderLineId);
    if (c.loadedUnits > line.orderedUnits) err(`Loaded ${c.loadedUnits} exceeds expected ${line.orderedUnits}`);
    if (c.damageUnits > c.loadedUnits) err(`Damaged ${c.damageUnits} exceeds loaded ${c.loadedUnits}`);
  });
  if (Object.keys(fieldErrors).length > 0) throw constraintError("Some checks are not valid", { fieldErrors });

  const at = now();
  const before = new Map(trip.loadingChecks.map((c) => [c.orderLineId, c]));
  for (const c of input.checks) {
    const data = {
      expectedUnits: lines.get(c.orderLineId)!.orderedUnits,
      loadedUnits: c.loadedUnits,
      damageUnits: c.damageUnits,
      note: c.note || null,
      planRevision: trip.planRevision,
      checkedById: ctx.actor.id,
      checkedAt: at,
    };
    await ctx.tx.loadingCheck.upsert({
      where: { tripId_orderLineId: { tripId: trip.id, orderLineId: c.orderLineId } },
      create: { tripId: trip.id, orderLineId: c.orderLineId, ...data },
      update: data,
    });
  }

  const reopened = trip.state === "READY";
  const updated = await ctx.tx.trip.update({
    where: { id: trip.id, version: trip.version },
    data: { version: { increment: 1 }, ...(reopened ? { state: "LOADING", readyAt: null } : {}) },
  });
  await ctx.audit({
    action: "trip.loading_checks",
    entityType: "Trip",
    entityId: trip.id,
    before: {
      version: trip.version,
      state: trip.state,
      checks: input.checks.map((c) => {
        const b = before.get(c.orderLineId);
        return b ? { orderLineId: b.orderLineId, loadedUnits: b.loadedUnits, damageUnits: b.damageUnits, planRevision: b.planRevision } : { orderLineId: c.orderLineId, unchecked: true };
      }),
    },
    after: { version: updated.version, state: updated.state, checks: input.checks },
    planRevision: trip.planRevision,
  });
  return result(updated, { checkedLines: input.checks.length });
}

/** Shortfall/damage opens a blocking Issue the dispatcher sees; OTHER is informational. */
export async function reportIssue(ctx: Ctx, tripId: string, input: LoaderIssueInput): Promise<LoaderMutationResult> {
  const trip = await loadForWrite(ctx, tripId, input);
  assertNotDeparted(trip);

  const lines = tripLines(trip);
  let orderId = input.orderId ?? null;
  if (input.orderLineId) {
    const line = lines.get(input.orderLineId);
    if (!line) throw constraintError("Order line is not on this trip", { fieldErrors: { orderLineId: ["Not on this trip"] } });
    if (orderId && orderId !== line.orderId) {
      throw constraintError("Line does not belong to that order", { fieldErrors: { orderLineId: ["Belongs to another order"] } });
    }
    orderId = line.orderId;
  }
  if (orderId && ![...lines.values()].some((l) => l.orderId === orderId)) {
    throw constraintError("Order is not on this trip", { fieldErrors: { orderId: ["Not on this trip"] } });
  }
  if (input.type !== "OTHER" && !orderId) {
    throw constraintError("Shortfall and damage reports must name the order", { fieldErrors: { orderId: ["Required"] } });
  }

  const blocking = input.type === "SHORTFALL" || input.type === "DAMAGE";
  const issue = await ctx.tx.issue.create({
    data: {
      type: input.type,
      severity: input.severity,
      blocking,
      orderId,
      orderLineId: input.orderLineId ?? null,
      tripId: trip.id,
      reporterId: ctx.actor.id,
      reporterRole: "LOADER",
      text: input.text,
    },
  });
  const reopened = blocking && trip.state === "READY";
  const updated = await ctx.tx.trip.update({
    where: { id: trip.id, version: trip.version },
    data: { version: { increment: 1 }, ...(reopened ? { state: "LOADING", readyAt: null } : {}) },
  });
  await ctx.audit({
    action: "issue.create",
    entityType: "Issue",
    entityId: issue.id,
    after: { type: issue.type, severity: issue.severity, blocking, orderId, orderLineId: issue.orderLineId, tripId: trip.id, tripVersion: updated.version },
    planRevision: trip.planRevision,
  });
  return result(updated, { issueId: issue.id });
}

/**
 * Close a blocking shortfall/damage issue after corrective checks. The server
 * verifies the affected lines (the named line, else the named order, else the
 * whole trip) are now fully loaded and undamaged at the current revision.
 */
export async function resolveIssue(ctx: Ctx, tripId: string, issueId: string, input: LoaderResolveIssueInput): Promise<LoaderMutationResult> {
  const trip = await loadForWrite(ctx, tripId, input);
  assertNotDeparted(trip);
  const issue = await ctx.tx.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.tripId !== trip.id) throw notFound("Issue not found on this trip");
  if (!issue.blocking) throw invalidTransition("Only shortfall/damage issues are resolved here");
  if (issue.status === "RESOLVED") throw invalidTransition("Issue is already resolved");
  assertVersion(input.issueVersion, issue.version);

  const manifest = toManifestDto(trip);
  const lines = manifest.stops.flatMap((s) =>
    s.orders.flatMap((o) => o.lines.map((l) => ({ ...l, orderId: o.orderId, orderRef: o.orderRef }))),
  );
  const affected = lines.filter((l) =>
    issue.orderLineId ? l.orderLineId === issue.orderLineId : issue.orderId ? l.orderId === issue.orderId : true,
  );
  const unverified = affected.filter((l) => lineStatus(l, trip.planRevision) !== "ok");
  if (unverified.length > 0) {
    throw constraintError("Record corrective checks first: the affected goods are not fully loaded undamaged", {
      lines: unverified.map((l) => ({ orderLineId: l.orderLineId, orderRef: l.orderRef, lineNo: l.lineNo, status: lineStatus(l, trip.planRevision) })),
    });
  }

  const at = now();
  await ctx.tx.issue.update({
    where: { id: issue.id, version: issue.version },
    data: {
      status: "RESOLVED",
      resolution: input.resolution,
      resolvedById: ctx.actor.id,
      resolvedAt: at,
      acknowledgedAt: issue.acknowledgedAt ?? at,
      version: { increment: 1 },
    },
  });
  const updated = await ctx.tx.trip.update({ where: { id: trip.id, version: trip.version }, data: { version: { increment: 1 } } });
  await ctx.audit({
    action: "issue.resolve",
    entityType: "Issue",
    entityId: issue.id,
    before: { status: issue.status, version: issue.version },
    after: { status: "RESOLVED", resolution: input.resolution, verifiedLines: affected.map((l) => l.orderLineId), tripVersion: updated.version },
    planRevision: trip.planRevision,
  });
  return result(updated, { issueId: issue.id });
}

/** loading -> ready. Online only; every release condition is re-evaluated here. */
export async function releaseTrip(ctx: Ctx, tripId: string, input: LoaderTripActionInput): Promise<LoaderMutationResult> {
  const trip = await loadForWrite(ctx, tripId, input);
  if (trip.plan.status !== "PUBLISHED") throw invalidTransition("Plan is no longer open for loading");
  if (trip.state !== "LOADING") throw invalidTransition(`Trip cannot be released: it is ${trip.state.toLowerCase()}`);
  const readiness = loadingReadiness(toManifestDto(trip));
  if (!readiness.canRelease) {
    throw invalidTransition(`Trip cannot be released: ${readiness.blockers.join("; ")}`, { blockers: readiness.blockers });
  }

  const at = now();
  const updated = await ctx.tx.trip.update({
    where: { id: trip.id, version: trip.version },
    data: { state: "READY", readyAt: at, version: { increment: 1 } },
  });
  await ctx.audit({
    action: "trip.ready",
    entityType: "Trip",
    entityId: trip.id,
    before: { state: trip.state, version: trip.version },
    after: { state: updated.state, version: updated.version, readyAt: at.toISOString() },
    planRevision: trip.planRevision,
  });
  return result(updated);
}
