import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { assertDepotScope, type SessionUser } from "@/server/auth/guards";
import { assertVersion, type runMutation } from "@/server/mutation";
import {
  conflict,
  constraintError,
  invalidTransition,
  notFound,
} from "@/server/http";
import {
  issueInclude,
  manifestInclude,
  orderInclude,
  toIssueDto,
  toManifestDto,
  toOrderDto,
  toTripSummaryDto,
} from "@/server/dto";
import {
  derivedDay,
  earliestEligibleDate,
  isoWeekOf,
  nextOperatingDay,
  type CalendarLookup,
} from "@/server/calendar";
import { addDays, formatHhMm, now, zonedInstant } from "@/server/time";
import type { PlanDto, PlanSummaryDto } from "@/shared/dto/plan";
import type { DeferOrderInput } from "@/shared/dto/order";
import type { ResolveIssueInput } from "@/shared/dto/issue";
import {
  allocate,
  priorityNote,
  validatePlan,
  type Decision,
  type PlanningInput,
} from "./planning/engine";

type Client = Tx | typeof db;
type Ctx = Parameters<Parameters<typeof runMutation>[0]["fn"]>[0];
const planInclude = {
  depot: true,
  decisions: {
    include: { order: { include: orderInclude }, trip: true, stop: true },
  },
  trips: { include: { ...manifestInclude, fuelReservation: true } },
} satisfies Prisma.PlanInclude;
type PlanRow = Prisma.PlanGetPayload<{ include: typeof planInclude }>;
export function depotScope(actor: SessionUser) {
  assertDepotScope(actor, actor.depotId ?? "");
  return actor.depotId!;
}
export async function calendar(
  tx: Client,
  date: string,
): Promise<CalendarLookup> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw constraintError("Choose a valid calendar date");
  const rows = await tx.calendarDay.findMany({
    where: { date: { gte: addDays(date, -7), lte: addDays(date, 65) } },
  });
  return (day) => {
    const r = rows.find((x) => x.date === day);
    return r ? { ...r, source: "supplied" as const } : derivedDay(day);
  };
}
export async function loadPlan(tx: Client, actor: SessionUser, id: string) {
  const plan = await tx.plan.findUnique({
    where: { id },
    include: planInclude,
  });
  if (!plan) throw notFound("Plan not found");
  assertDepotScope(actor, plan.depotId);
  return plan;
}
export async function queue(tx: Client, actor: SessionUser, date: string) {
  await calendar(tx, date);
  return tx.order.findMany({
    where: {
      depotId: depotScope(actor),
      eligibleServiceDate: { lte: date },
      status: { in: ["CONFIRMED", "DEFERRED"] },
    },
    include: orderInclude,
    orderBy: [{ eligibleServiceDate: "asc" }, { id: "asc" }],
  });
}
export async function planningInput(
  tx: Client,
  actor: SessionUser,
  plan: PlanRow,
): Promise<PlanningInput> {
  const week = isoWeekOf(plan.serviceDate);
  const [queued, vehicles, lookup] = await Promise.all([
    queue(tx, actor, plan.serviceDate),
    tx.vehicle.findMany({
      where: { depotId: plan.depotId },
      include: {
        driver: true,
        fuelWeek: { where: week },
        trips: {
          where: { serviceDate: plan.serviceDate, planId: { not: plan.id } },
        },
      },
    }),
    calendar(tx, plan.serviceDate),
  ]);
  const rows = [
    ...new Map(
      [...queued, ...plan.decisions.map((d) => d.order)].map((o) => [o.id, o]),
    ).values(),
  ];
  return {
    depotId: plan.depotId,
    depotName: plan.depot.name,
    serviceDate: plan.serviceDate,
    operating: lookup(plan.serviceDate).isOperating,
    orders: rows.map((o) => ({
      ...toOrderDto(o),
      outlet: {
        id: o.outlet.id,
        depotId: o.outlet.depotId,
        depotName: plan.depot.name,
        brand: o.outlet.brand,
        district: o.outlet.district,
        dockType: o.outlet.dockType,
        parkingConstraint: o.outlet.parkingConstraint,
        windowOpen: o.outlet.windowOpen,
        windowClose: o.outlet.windowClose,
        mallWindowOpen: o.outlet.mallWindowOpen,
        mallWindowClose: o.outlet.mallWindowClose,
      },
      alreadyServed: o.decisions.some(
        (d) =>
          d.planId !== plan.id &&
          d.decision === "SERVED" &&
          d.stop?.state !== "FAILED",
      ),
    })),
    vehicles: vehicles.map((v) => {
      const ledger = v.fuelWeek[0];
      const own = plan.trips
        .filter(
          (t) =>
            t.vehicleId === v.id && t.fuelReservation?.state === "RESERVED",
        )
        .reduce((n, t) => n + Number(t.fuelReservation!.liters), 0);
      return {
        ...v,
        weightCapKg: Number(v.weightCapKg),
        volumeCapM3: Number(v.volumeCapM3),
        fuelLitersPerKm: Number(v.fuelLitersPerKm),
        weeklyFuelQuotaLiters: Number(v.weeklyFuelQuotaLiters),
        driver: v.driver?.active
          ? { id: v.driver.id, name: v.driver.displayName }
          : null,
        usedFuel: ledger
          ? Number(ledger.reservedLiters) + Number(ledger.consumedLiters) - own
          : 0,
        fuelQuota: Number(ledger?.quotaLiters ?? v.weeklyFuelQuotaLiters),
        occupiedTrips: v.trips.map((t) => t.tripNumber),
      };
    }),
  };
}
export function decisionsOf(plan: PlanRow): Decision[] {
  return plan.decisions.map((d) => ({
    orderId: d.orderId,
    decision: d.decision,
    ...(d.trip
      ? {
          vehicleId: d.trip.vehicleId,
          tripNumber: d.trip.tripNumber as 1 | 2,
          stopSequence: d.stop?.sequence,
        }
      : {}),
    reasonCode: d.reasonCode ?? undefined,
    reasonText: d.reasonText ?? undefined,
  }));
}
export async function planDto(
  tx: Client,
  actor: SessionUser,
  plan: PlanRow,
): Promise<PlanDto> {
  const input = await planningInput(tx, actor, plan);
  const served = plan.decisions.filter((d) => d.decision === "SERVED").length;
  return {
    id: plan.id,
    depotId: plan.depotId,
    serviceDate: plan.serviceDate,
    status: plan.status,
    revision: plan.revision,
    version: plan.version,
    publishedAt: plan.publishedAt?.toISOString() ?? null,
    counts: {
      orders: input.orders.length,
      served,
      deferred: plan.decisions.length - served,
      undecided: input.orders.length - plan.decisions.length,
      trips: plan.trips.length,
    },
    decisions: plan.decisions.map((d) => ({
      orderId: d.orderId,
      orderRef: d.order.orderRef,
      decision: d.decision,
      tripId: d.tripId,
      stopId: d.stopId,
      reasonCode: d.reasonCode,
      reasonText: d.reasonText,
      nextEligibleDate: d.nextEligibleDate,
      priorityNote: d.priorityNote,
    })),
    trips: plan.trips.map(toTripSummaryDto),
    issues: plan.trips.flatMap((t) => t.issues.map(toIssueDto)),
    utilization: plan.trips.map((t) => {
      const m = toManifestDto(t);
      const v = input.vehicles.find((v) => v.id === t.vehicleId)!;
      return {
        tripId: t.id,
        ...m.load,
        ...m.capacity,
        fuelLiters: Number(t.reservedFuelLiters),
        weekFuelUsedLiters: v.usedFuel,
        weekFuelQuotaLiters: v.fuelQuota,
      };
    }),
  };
}
export async function planDetail(tx: Client, actor: SessionUser, id: string) {
  const plan = await loadPlan(tx, actor, id);
  return {
    ...(await planDto(tx, actor, plan)),
    orders: (await planningInput(tx, actor, plan)).orders,
    manifests: plan.trips.map(toManifestDto),
  };
}
export async function createPlan(
  ctx: Ctx,
  depotId: string,
  serviceDate: string,
) {
  assertDepotScope(ctx.actor, depotId);
  if (!(await calendar(ctx.tx, serviceDate))(serviceDate).isOperating)
    throw constraintError("Choose an operating service date");
  if (
    await ctx.tx.plan.findUnique({
      where: { depotId_serviceDate: { depotId, serviceDate } },
    })
  )
    throw conflict("A plan already exists for this depot and date");
  const plan = await ctx.tx.plan.create({
    data: { depotId, serviceDate, createdById: ctx.actor.id },
  });
  await ctx.audit({
    action: "plan.create",
    entityType: "Plan",
    entityId: plan.id,
    after: { serviceDate },
  });
  return planDto(ctx.tx, ctx.actor, await loadPlan(ctx.tx, ctx.actor, plan.id));
}
async function releaseFuel(tx: Tx, plan: PlanRow) {
  for (const t of plan.trips)
    if (t.fuelReservation?.state === "RESERVED") {
      await tx.vehicleWeekFuel.update({
        where: { id: t.fuelReservation.fuelWeekId },
        data: {
          reservedLiters: { decrement: t.fuelReservation.liters },
          version: { increment: 1 },
        },
      });
      await tx.tripFuelReservation.delete({ where: { tripId: t.id } });
    }
}
async function reserveFuel(tx: Tx, actor: SessionUser, id: string) {
  const plan = await loadPlan(tx, actor, id);
  const week = isoWeekOf(plan.serviceDate);
  for (const t of plan.trips) {
    const vehicle = await tx.vehicle.findUniqueOrThrow({
      where: { id: t.vehicleId },
    });
    const ledger = await tx.vehicleWeekFuel.upsert({
      where: { vehicleId_isoYear_isoWeek: { vehicleId: t.vehicleId, ...week } },
      create: {
        vehicleId: t.vehicleId,
        ...week,
        quotaLiters: vehicle.weeklyFuelQuotaLiters,
      },
      update: {},
    });
    if (
      ledger.reservedLiters
        .plus(ledger.consumedLiters)
        .plus(t.reservedFuelLiters)
        .greaterThan(ledger.quotaLiters)
    )
      throw constraintError(
        "Weekly fuel quota changed; refresh and revalidate",
      );
    await tx.vehicleWeekFuel.update({
      where: { id: ledger.id },
      data: {
        reservedLiters: { increment: t.reservedFuelLiters },
        version: { increment: 1 },
      },
    });
    await tx.tripFuelReservation.create({
      data: {
        tripId: t.id,
        fuelWeekId: ledger.id,
        liters: t.reservedFuelLiters,
      },
    });
  }
}
async function publishOrders(tx: Tx, planId: string) {
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
  const decisions = await tx.allocationDecision.findMany({ where: { planId } });
  for (const d of decisions)
    await tx.order.update({
      where: { id: d.orderId },
      data: {
        status: d.decision === "SERVED" ? "ALLOCATED" : "DEFERRED",
        eligibleServiceDate:
          d.decision === "DEFERRED" ? d.nextEligibleDate! : plan.serviceDate,
        version: { increment: 1 },
      },
    });
}
export async function saveDecisions(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  supplied?: Decision[],
) {
  const plan = await loadPlan(ctx.tx, ctx.actor, id);
  assertVersion(expectedVersion, plan.version);
  if (
    plan.status === "COMPLETED" ||
    plan.trips.some(
      (t) => t.departedAt || ["IN_TRANSIT", "COMPLETED"].includes(t.state),
    )
  )
    throw invalidTransition(
      "Departed plans are locked. Use issues to coordinate changes.",
    );
  if (!supplied && plan.status !== "DRAFT")
    throw invalidTransition("Assisted allocation is available for drafts only");
  const input = await planningInput(ctx.tx, ctx.actor, plan);
  // Previously published deferrals remain candidates for their original plan revision.
  if (plan.status === "PUBLISHED")
    for (const o of input.orders)
      if (plan.decisions.some((d) => d.orderId === o.id))
        o.eligibleServiceDate = plan.serviceDate;
  const decisions = supplied ?? allocate(input);
  const checked = validatePlan(input, decisions, plan.status === "PUBLISHED");
  if (!checked.valid)
    throw constraintError("Assignments are infeasible", {
      violations: checked.violations,
    });
  const lookup = await calendar(ctx.tx, plan.serviceDate);
  const next = nextOperatingDay(plan.serviceDate, lookup);
  const revision = plan.status === "PUBLISHED" ? plan.revision + 1 : 0;
  if (plan.status === "PUBLISHED") await releaseFuel(ctx.tx, plan);
  await ctx.tx.allocationDecision.deleteMany({ where: { planId: id } });
  // Keep trip IDs stable for loader clients and preserve issue history. Any rewrite
  // invalidates loading checks and readiness via revision and parent version.
  for (const t of plan.trips) {
    await ctx.tx.issue.updateMany({
      where: { tripId: t.id },
      data: { stopId: null },
    });
    await ctx.tx.loadingCheck.deleteMany({ where: { tripId: t.id } });
    await ctx.tx.stop.deleteMany({ where: { tripId: t.id } });
    if (
      !checked.trips.some(
        (x) => x.vehicleId === t.vehicleId && x.tripNumber === t.tripNumber,
      )
    ) {
      if (t.issues.some((i) => i.status !== "RESOLVED"))
        throw constraintError(
          "Resolve a trip's open issues before removing it",
        );
      await ctx.tx.issue.updateMany({
        where: { tripId: t.id },
        data: { tripId: null },
      });
      await ctx.tx.trip.delete({ where: { id: t.id } });
    }
  }
  const links = new Map<string, { tripId: string; stopId: string }>();
  for (const t of checked.trips) {
    const v = input.vehicles.find((v) => v.id === t.vehicleId)!;
    const data = {
      assignedDriverId: v.driver!.id,
      brand: t.orders[0].brand,
      district: t.orders[0].district,
      plannedDepartureAt: zonedInstant(
        plan.serviceDate,
        formatHhMm(t.departure),
      ),
      plannedReturnAt: zonedInstant(plan.serviceDate, formatHhMm(t.returned)),
      distanceKm: t.distance,
      reservedFuelLiters: t.fuel,
      planRevision: revision,
      state: "PLANNED" as const,
      loadingStartedAt: null,
      readyAt: null,
    };
    const existing = plan.trips.find(
      (x) => x.vehicleId === t.vehicleId && x.tripNumber === t.tripNumber,
    );
    const trip = existing
      ? await ctx.tx.trip.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await ctx.tx.trip.create({
          data: {
            ...data,
            planId: id,
            depotId: plan.depotId,
            serviceDate: plan.serviceDate,
            vehicleId: t.vehicleId,
            tripNumber: t.tripNumber,
          },
        });
    for (const s of t.stops) {
      const stop = await ctx.tx.stop.create({
        data: {
          tripId: trip.id,
          outletId: s.outletId,
          sequence: s.sequence,
          plannedArrivalAt: zonedInstant(
            plan.serviceDate,
            formatHhMm(s.arrival),
          ),
          plannedServiceMin: 15,
          orders: { create: s.orderIds.map((orderId) => ({ orderId })) },
        },
      });
      for (const orderId of s.orderIds)
        links.set(orderId, { tripId: trip.id, stopId: stop.id });
    }
  }
  for (const d of decisions)
    await ctx.tx.allocationDecision.create({
      data: {
        planId: id,
        orderId: d.orderId,
        decision: d.decision,
        ...(links.get(d.orderId) ?? {}),
        reasonCode: d.decision === "DEFERRED" ? d.reasonCode : null,
        reasonText: d.decision === "DEFERRED" ? d.reasonText : null,
        nextEligibleDate: d.decision === "DEFERRED" ? next : null,
        priorityNote: priorityNote(
          input.orders.find((o) => o.id === d.orderId)!,
        ),
      },
    });
  await ctx.tx.plan.update({
    where: { id },
    data: {
      version: { increment: 1 },
      revision,
      ...(plan.status === "PUBLISHED"
        ? { publishedAt: now(), publishedById: ctx.actor.id }
        : {}),
    },
  });
  if (plan.status === "PUBLISHED") {
    await reserveFuel(ctx.tx, ctx.actor, id);
    await publishOrders(ctx.tx, id);
  }
  await ctx.audit({
    action: plan.status === "PUBLISHED" ? "plan.revise" : "plan.decisions",
    entityType: "Plan",
    entityId: id,
    before: { version: plan.version },
    after: { decisions },
    planRevision: revision,
  });
  return planDetail(ctx.tx, ctx.actor, id);
}
export async function validateStored(
  tx: Client,
  actor: SessionUser,
  id: string,
  expectedVersion: number,
) {
  const plan = await loadPlan(tx, actor, id);
  assertVersion(expectedVersion, plan.version);
  const result = validatePlan(
    await planningInput(tx, actor, plan),
    decisionsOf(plan),
  );
  const { localDate } = await import("@/server/time");
  const lookup = await calendar(tx, localDate(now()));
  if (plan.serviceDate >= earliestEligibleDate(now(), lookup))
    result.violations.push({
      code: "NOT_ELIGIBLE",
      message:
        "The order queue is still open. Publication is allowed after the preceding operating day's 16:00 cutoff.",
    });
  for (const calculated of result.trips) {
    const stored = plan.trips.find(
      (t) =>
        t.vehicleId === calculated.vehicleId &&
        t.tripNumber === calculated.tripNumber,
    );
    if (
      !stored ||
      Number(stored.reservedFuelLiters) !== calculated.fuel ||
      stored.plannedReturnAt.getTime() !==
        zonedInstant(
          plan.serviceDate,
          formatHhMm(calculated.returned),
        ).getTime()
    )
      result.violations.push({
        code: "MISSING_INPUT",
        message:
          "Order or travel inputs changed. Save the assignments again to rebuild the manifest.",
        vehicleId: calculated.vehicleId,
      });
  }
  result.valid = result.violations.length === 0;
  return {
    planId: id,
    version: plan.version,
    valid: result.valid,
    violations: result.violations,
  };
}
export async function publishPlan(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
) {
  const plan = await loadPlan(ctx.tx, ctx.actor, id);
  assertVersion(expectedVersion, plan.version);
  if (plan.status !== "DRAFT")
    throw invalidTransition("Only a draft can be published");
  const checked = await validateStored(ctx.tx, ctx.actor, id, expectedVersion);
  if (!checked.valid)
    throw constraintError("Plan cannot be published", checked);
  await reserveFuel(ctx.tx, ctx.actor, id);
  await publishOrders(ctx.tx, id);
  await ctx.tx.trip.updateMany({
    where: { planId: id },
    data: { planRevision: 1, version: { increment: 1 } },
  });
  await ctx.tx.plan.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      revision: 1,
      version: { increment: 1 },
      publishedAt: now(),
      publishedById: ctx.actor.id,
    },
  });
  await ctx.audit({
    action: "plan.publish",
    entityType: "Plan",
    entityId: id,
    after: checked,
    planRevision: 1,
  });
  return planDetail(ctx.tx, ctx.actor, id);
}
export async function resolveIssue(
  ctx: Ctx,
  id: string,
  body: ResolveIssueInput,
) {
  const issue = await ctx.tx.issue.findUnique({
    where: { id },
    include: {
      trip: { include: manifestInclude },
      order: true,
      stop: { include: { trip: true } },
    },
  });
  if (!issue) throw notFound();
  const scopes = [
    issue.trip?.depotId,
    issue.order?.depotId,
    issue.stop?.trip.depotId,
  ].filter((x): x is string => !!x);
  if (!scopes.length) throw notFound();
  scopes.forEach((s) => assertDepotScope(ctx.actor, s));
  assertVersion(body.expectedVersion, issue.version);
  if (issue.status === "RESOLVED")
    throw invalidTransition("Issue is already resolved");
  if (body.action === "RESOLVE" && issue.blocking) {
    if (!issue.trip)
      throw constraintError("Blocking stock issues require a loading manifest");
    const lines = toManifestDto(issue.trip)
      .stops.flatMap((s) =>
        s.orders
          .filter((o) => !issue.orderId || o.orderId === issue.orderId)
          .flatMap((o) => o.lines),
      )
      .filter((l) => !issue.orderLineId || l.orderLineId === issue.orderLineId);
    if (
      !lines.length ||
      lines.some(
        (l) =>
          !l.check ||
          l.check.planRevision !== issue.trip!.planRevision ||
          l.check.loadedUnits !== l.expectedUnits ||
          l.check.damageUnits !== 0,
      )
    )
      throw constraintError(
        "Record corrected, complete and undamaged loading checks before resolving this issue",
      );
  }
  const updated = await ctx.tx.issue.update({
    where: { id },
    data: {
      status: body.action === "RESOLVE" ? "RESOLVED" : "ACKNOWLEDGED",
      resolution: body.resolution,
      acknowledgedAt: issue.acknowledgedAt ?? now(),
      ...(body.action === "RESOLVE"
        ? { resolvedAt: now(), resolvedById: ctx.actor.id }
        : {}),
      version: { increment: 1 },
    },
    include: issueInclude,
  });
  if (issue.tripId)
    await ctx.tx.trip.update({
      where: { id: issue.tripId },
      data: { version: { increment: 1 } },
    });
  await ctx.audit({
    action: `issue.${body.action.toLowerCase()}`,
    entityType: "Issue",
    entityId: id,
    after: { resolution: body.resolution },
  });
  return toIssueDto(updated);
}
export async function deferFailed(ctx: Ctx, id: string, body: DeferOrderInput) {
  const order = await ctx.tx.order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) throw notFound();
  assertDepotScope(ctx.actor, order.depotId);
  assertVersion(body.expectedVersion, order.version);
  const served = order.decisions.filter((d) => d.decision === "SERVED");
  if (
    order.status !== "ALLOCATED" ||
    !served.length ||
    served.some(
      (d) => d.stop?.state !== "FAILED" || d.stop.proof?.outcome !== "FAILED",
    )
  )
    throw invalidTransition(
      "Only a fully failed terminal delivery can be deferred; partial deliveries need a replacement order",
    );
  const latest = served.sort((a, b) =>
    b.plan.serviceDate.localeCompare(a.plan.serviceDate),
  )[0];
  const { localDate } = await import("@/server/time");
  const from = [localDate(now()), latest.plan.serviceDate].sort().at(-1)!;
  const next = nextOperatingDay(from, await calendar(ctx.tx, from));
  const updated = await ctx.tx.order.update({
    where: { id },
    data: {
      status: "DEFERRED",
      eligibleServiceDate: next,
      version: { increment: 1 },
    },
    include: orderInclude,
  });
  await ctx.tx.issue.create({
    data: {
      orderId: id,
      reporterId: ctx.actor.id,
      reporterRole: "DISPATCHER",
      type: "OTHER",
      severity: "MEDIUM",
      text: `Delivery recovery: ${body.reasonText}. Requeued for ${next}. Original delivery evidence retained.`,
    },
  });
  await ctx.audit({
    action: "order.defer_failed",
    entityType: "Order",
    entityId: id,
    after: { ...body, nextEligibleDate: next },
  });
  return toOrderDto(updated);
}
export async function listPlans(
  actor: SessionUser,
  date: string,
): Promise<PlanSummaryDto[]> {
  const plans = await db.plan.findMany({
    where: { depotId: depotScope(actor), serviceDate: date },
    include: planInclude,
  });
  return Promise.all(plans.map((p) => planDto(db, actor, p)));
}
export async function monitor(actor: SessionUser, date: string) {
  const depotId = depotScope(actor);
  const [trips, orders, issues] = await Promise.all([
    db.trip.findMany({
      where: { depotId, serviceDate: date, plan: { status: { not: "DRAFT" } } },
      include: manifestInclude,
      orderBy: [{ vehicleId: "asc" }, { tripNumber: "asc" }],
    }),
    db.order.findMany({
      where: {
        depotId,
        OR: [
          {
            eligibleServiceDate: { lte: date },
            status: { in: ["CONFIRMED", "DEFERRED"] },
          },
          {
            decisions: {
              some: { plan: { serviceDate: date, status: { not: "DRAFT" } } },
            },
          },
        ],
      },
      include: orderInclude,
    }),
    db.issue.findMany({
      where: {
        OR: [
          { trip: { depotId } },
          { order: { depotId } },
          { stop: { trip: { depotId } } },
        ],
        status: { not: "RESOLVED" },
      },
      include: issueInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    serverTime: now().toISOString(),
    trips: trips.map(toManifestDto),
    orders: orders.map(toOrderDto),
    issues: issues.map(toIssueDto),
  };
}
