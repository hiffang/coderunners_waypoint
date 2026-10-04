import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { toNumber } from "@/server/decimal";
import { outletLabel } from "@/shared/dto/reference";
import type { AttachmentDto } from "@/shared/dto/files";
import type { IssueDto } from "@/shared/dto/issue";
import type { OrderDto } from "@/shared/dto/order";
import type { ManifestDto, ManifestStopDto, TripSummaryDto } from "@/shared/dto/manifest";

/**
 * Shared Prisma -> DTO mappers. Every portal returns these shapes so the
 * store, dispatcher, loader and driver never depend on another portal's UI.
 * Load with the matching `*Include` and pass the row.
 */

const num = (v: Prisma.Decimal | number | null | undefined) => toNumber(v) ?? 0;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ---------------------------------------------------------------- attachments & issues

type AttachmentRow = Prisma.AttachmentGetPayload<object>;

export function toAttachmentDto(a: AttachmentRow): AttachmentDto {
  return {
    id: a.id,
    clientFileId: a.clientFileId,
    contentType: a.contentType,
    size: a.size,
    url: `/api/shared/files/${a.id}`,
    createdAt: a.createdAt.toISOString(),
    linked: a.linkedAt !== null,
  };
}

export const issueInclude = {
  reporter: { select: { id: true, displayName: true } },
  resolvedBy: { select: { id: true, displayName: true } },
  order: { select: { orderRef: true } },
  attachments: true,
} satisfies Prisma.IssueInclude;

export function toIssueDto(i: Prisma.IssueGetPayload<{ include: typeof issueInclude }>): IssueDto {
  return {
    id: i.id,
    type: i.type,
    severity: i.severity,
    blocking: i.blocking,
    status: i.status,
    text: i.text,
    orderId: i.orderId,
    orderRef: i.order?.orderRef ?? null,
    tripId: i.tripId,
    stopId: i.stopId,
    orderLineId: i.orderLineId,
    reporter: { id: i.reporter.id, name: i.reporter.displayName, role: i.reporterRole },
    resolution: i.resolution,
    resolvedBy: i.resolvedBy ? { id: i.resolvedBy.id, name: i.resolvedBy.displayName } : null,
    createdAt: i.createdAt.toISOString(),
    acknowledgedAt: iso(i.acknowledgedAt),
    resolvedAt: iso(i.resolvedAt),
    version: i.version,
    attachments: i.attachments.map(toAttachmentDto),
  };
}

// ---------------------------------------------------------------- orders

export const orderInclude = {
  outlet: true,
  lines: {
    orderBy: { lineNo: "asc" },
    include: { loadingChecks: true, deliveryOutcome: true, receiptLines: true },
  },
  decisions: {
    where: { plan: { status: { in: ["PUBLISHED", "COMPLETED"] } } },
    include: {
      plan: { select: { id: true, serviceDate: true, revision: true } },
      trip: { select: { id: true, tripNumber: true, vehicleId: true } },
      stop: {
        include: { proof: { include: { attachments: true } } },
      },
    },
  },
  receipt: true,
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderDto(o: OrderRow): OrderDto {
  const byDate = [...o.decisions].sort((a, b) => b.plan.serviceDate.localeCompare(a.plan.serviceDate));
  const served = byDate.find((d) => d.decision === "SERVED" && d.trip && d.stop);
  const deferred = byDate.find((d) => d.decision === "DEFERRED");
  // A deferral is current only if no later served decision exists.
  const currentDeferral =
    deferred && (!served || deferred.plan.serviceDate > served.plan.serviceDate) ? deferred : null;
  const stop = served?.stop ?? null;
  const proof = stop?.proof ?? null;

  return {
    id: o.id,
    orderRef: o.orderRef,
    outletId: o.outletId,
    outletLabel: outletLabel(o.outlet),
    district: o.outlet.district,
    depotId: o.depotId,
    brand: o.brand,
    temp: o.temp,
    requestedDate: o.requestedDate,
    eligibleServiceDate: o.eligibleServiceDate,
    submittedAt: iso(o.submittedAt),
    status: o.status,
    version: o.version,
    totals: { units: o.totalUnits, weightKg: num(o.totalWeightKg), volumeM3: num(o.totalVolumeM3) },
    lines: o.lines.map((l) => {
      // Only the checks/outcomes from the current served trip/stop count.
      const check = served ? l.loadingChecks.find((c) => c.tripId === served.tripId) : undefined;
      const outcome = stop ? l.deliveryOutcome.find((d) => d.stopId === stop.id) : undefined;
      const receipt = l.receiptLines[0];
      return {
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        orderedUnits: l.orderedUnits,
        unitWeightKg: num(l.unitWeightKg),
        unitVolumeM3: num(l.unitVolumeM3),
        loadedUnits: check?.loadedUnits ?? null,
        deliveredUnits: outcome?.deliveredUnits ?? null,
        deliveryDamagedUnits: outcome?.damagedUnits ?? null,
        receivedUnits: receipt?.receivedUnits ?? null,
        receiptDamageUnits: receipt?.damageUnits ?? null,
      };
    }),
    allocation:
      served && served.trip && stop
        ? {
            planId: served.plan.id,
            planRevision: served.plan.revision,
            serviceDate: served.plan.serviceDate,
            tripId: served.trip.id,
            tripNumber: served.trip.tripNumber,
            vehicleId: served.trip.vehicleId,
            stopId: stop.id,
            stopSequence: stop.sequence,
            plannedArrivalAt: stop.plannedArrivalAt.toISOString(),
            etaAt: iso(stop.etaAt),
          }
        : null,
    deferral:
      currentDeferral && currentDeferral.reasonCode
        ? {
            planId: currentDeferral.plan.id,
            serviceDate: currentDeferral.plan.serviceDate,
            reasonCode: currentDeferral.reasonCode,
            reasonText: currentDeferral.reasonText ?? "",
            nextEligibleDate: currentDeferral.nextEligibleDate ?? o.eligibleServiceDate,
          }
        : null,
    priorDeferrals: [
      ...new Map(
        byDate
          .filter((d) => d.decision === "DEFERRED" && d.reasonCode)
          .map((d) => [d.plan.serviceDate, { serviceDate: d.plan.serviceDate, reasonCode: d.reasonCode! }]),
      ).values(),
    ],
    delivery: stop
      ? {
          stopId: stop.id,
          stopState: stop.state,
          arrivedAt: iso(stop.actualArrivalAt),
          outcome: proof?.outcome ?? null,
          recipientName: proof?.recipientName ?? null,
          failureReason: proof?.failureReason ?? null,
          submittedAt: iso(proof?.submittedAt),
          evidence: proof?.attachments.map(toAttachmentDto) ?? [],
        }
      : null,
    receipt: o.receipt
      ? {
          id: o.receipt.id,
          status: o.receipt.status,
          receivedAt: o.receipt.receivedAt.toISOString(),
          note: o.receipt.note,
          version: o.receipt.version,
        }
      : null,
    followUpOfId: o.followUpOfId,
  };
}

// ---------------------------------------------------------------- trips & manifests

export const tripSummaryInclude = {
  vehicle: { select: { type: true, refrigerated: true, weightCapKg: true, volumeCapM3: true } },
  assignedDriver: { select: { id: true, displayName: true } },
  _count: { select: { stops: true, issues: { where: { blocking: true, status: { not: "RESOLVED" } } } } },
} satisfies Prisma.TripInclude;

export function toTripSummaryDto(t: Prisma.TripGetPayload<{ include: typeof tripSummaryInclude }>): TripSummaryDto {
  return {
    id: t.id,
    planId: t.planId,
    serviceDate: t.serviceDate,
    depotId: t.depotId,
    vehicleId: t.vehicleId,
    vehicleType: t.vehicle.type,
    refrigerated: t.vehicle.refrigerated,
    tripNumber: t.tripNumber,
    brand: t.brand,
    district: t.district,
    driver: t.assignedDriver ? { id: t.assignedDriver.id, name: t.assignedDriver.displayName } : null,
    state: t.state,
    planRevision: t.planRevision,
    version: t.version,
    plannedDepartureAt: t.plannedDepartureAt.toISOString(),
    plannedReturnAt: t.plannedReturnAt.toISOString(),
    distanceKm: num(t.distanceKm),
    reservedFuelLiters: num(t.reservedFuelLiters),
    stopCount: t._count.stops,
    openBlockingIssues: t._count.issues,
  };
}

export const manifestInclude = {
  ...tripSummaryInclude,
  stops: {
    orderBy: { sequence: "asc" },
    include: {
      outlet: true,
      orders: { include: { order: { include: { lines: { orderBy: { lineNo: "asc" } } } } } },
    },
  },
  loadingChecks: { include: { checkedBy: { select: { id: true, displayName: true } } } },
  issues: { include: issueInclude, orderBy: { createdAt: "desc" } },
} satisfies Prisma.TripInclude;

export type ManifestRow = Prisma.TripGetPayload<{ include: typeof manifestInclude }>;

export function toManifestDto(t: ManifestRow): ManifestDto {
  const checks = new Map(t.loadingChecks.map((c) => [c.orderLineId, c]));
  let weight = new Prisma.Decimal(0);
  let volume = new Prisma.Decimal(0);
  const stops: ManifestStopDto[] = t.stops.map((s) => ({
    stopId: s.id,
    sequence: s.sequence,
    loadingSequence: t.stops.length - s.sequence + 1,
    outletId: s.outletId,
    outletLabel: outletLabel(s.outlet),
    district: s.outlet.district,
    parkingConstraint: s.outlet.parkingConstraint,
    windowOpen: s.outlet.windowOpen,
    windowClose: s.outlet.windowClose,
    mallWindowOpen: s.outlet.mallWindowOpen,
    mallWindowClose: s.outlet.mallWindowClose,
    plannedArrivalAt: s.plannedArrivalAt.toISOString(),
    etaAt: iso(s.etaAt),
    plannedServiceMin: s.plannedServiceMin,
    state: s.state,
    version: s.version,
    orders: s.orders.map(({ order: o }) => {
      weight = weight.plus(o.totalWeightKg);
      volume = volume.plus(o.totalVolumeM3);
      return {
        orderId: o.id,
        orderRef: o.orderRef,
        temp: o.temp,
        totals: { units: o.totalUnits, weightKg: num(o.totalWeightKg), volumeM3: num(o.totalVolumeM3) },
        lines: o.lines.map((l) => {
          const c = checks.get(l.id);
          return {
            orderLineId: l.id,
            lineNo: l.lineNo,
            description: l.description,
            expectedUnits: l.orderedUnits,
            unitWeightKg: num(l.unitWeightKg),
            unitVolumeM3: num(l.unitVolumeM3),
            check: c
              ? {
                  orderLineId: c.orderLineId,
                  expectedUnits: c.expectedUnits,
                  loadedUnits: c.loadedUnits,
                  damageUnits: c.damageUnits,
                  note: c.note,
                  planRevision: c.planRevision,
                  checkedAt: c.checkedAt.toISOString(),
                  checkedBy: { id: c.checkedBy.id, name: c.checkedBy.displayName },
                }
              : null,
          };
        }),
      };
    }),
  }));
  return {
    ...toTripSummaryDto(t),
    capacity: { weightCapKg: num(t.vehicle.weightCapKg), volumeCapM3: num(t.vehicle.volumeCapM3) },
    load: { weightKg: weight.toNumber(), volumeM3: volume.toNumber() },
    stops,
    issues: t.issues.map(toIssueDto),
  };
}
