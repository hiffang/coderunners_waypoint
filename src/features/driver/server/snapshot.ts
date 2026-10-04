import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import type { SessionUser } from "@/server/auth/guards";
import { manifestInclude, toAttachmentDto, toManifestDto, toTripSummaryDto } from "@/server/dto";
import { now } from "@/server/time";
import type { DriverStopEventsDto } from "@/shared/dto/manifest";
import { departureReadiness } from "../readiness";
import type { DepartureReadiness, DriverTripListItemDto, DriverTripSnapshotDto } from "../types";
import { TERMINAL_STOP_STATES } from "../types";

/** Manifest include plus actual delivery events, plan status and home depot. */
export const driverTripInclude = {
  ...manifestInclude,
  vehicle: { select: { type: true, refrigerated: true, weightCapKg: true, volumeCapM3: true, status: true } },
  plan: { select: { status: true, revision: true } },
  depot: { select: { name: true } },
  stops: {
    orderBy: { sequence: "asc" },
    include: {
      ...manifestInclude.stops.include,
      proof: { include: { attachments: { orderBy: { createdAt: "asc" } } } },
      lineOutcomes: true,
    },
  },
} satisfies Prisma.TripInclude;

export type DriverTripRow = Prisma.TripGetPayload<{ include: typeof driverTripInclude }>;

/** Same-vehicle trips that gate departure: earlier trips that day and any trip still on the road. */
export async function loadDepartureContext(db: Tx, trip: { id: string; vehicleId: string; serviceDate: string; tripNumber: number }) {
  // Sequential: may run on a transaction client, which must not get concurrent queries.
  const earlierTrips = await db.trip.findMany({
    where: {
      vehicleId: trip.vehicleId,
      serviceDate: trip.serviceDate,
      tripNumber: { lt: trip.tripNumber },
      plan: { status: { in: ["PUBLISHED", "COMPLETED"] } },
    },
    select: { tripNumber: true, state: true, returnedAt: true },
  });
  const busy = await db.trip.count({ where: { vehicleId: trip.vehicleId, state: "IN_TRANSIT", id: { not: trip.id } } });
  return { earlierTrips, vehicleBusyElsewhere: busy > 0 };
}

export function readinessFor(
  t: DriverTripRow,
  actor: SessionUser,
  ctx: Awaited<ReturnType<typeof loadDepartureContext>>,
): DepartureReadiness {
  return departureReadiness({
    state: t.state,
    tripNumber: t.tripNumber,
    planStatus: t.plan.status,
    vehicleStatus: t.vehicle.status,
    assignedToActor: t.assignedDriverId === actor.id,
    openBlockingIssues: t._count.issues,
    planRevision: t.planRevision,
    lineIds: t.stops.flatMap((s) => s.orders.flatMap((o) => o.order.lines.map((l) => l.id))),
    checks: t.loadingChecks,
    earlierTrips: ctx.earlierTrips,
    vehicleBusyElsewhere: ctx.vehicleBusyElsewhere,
  });
}

export function toDriverSnapshotDto(t: DriverTripRow, departure: DepartureReadiness): DriverTripSnapshotDto {
  const stopEvents: Record<string, DriverStopEventsDto> = {};
  for (const s of t.stops) {
    stopEvents[s.id] = {
      actualArrivalAt: s.actualArrivalAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      proof: s.proof
        ? {
            outcome: s.proof.outcome,
            recipientName: s.proof.recipientName,
            note: s.proof.note,
            failureReason: s.proof.failureReason,
            capturedAt: s.proof.capturedAt.toISOString(),
            submittedAt: s.proof.submittedAt.toISOString(),
            attachments: s.proof.attachments.map(toAttachmentDto),
          }
        : null,
      lineOutcomes: s.lineOutcomes.map((o) => ({
        orderLineId: o.orderLineId,
        loadedUnitsSnapshot: o.loadedUnitsSnapshot,
        deliveredUnits: o.deliveredUnits,
        damagedUnits: o.damagedUnits,
      })),
    };
  }
  return {
    ...toManifestDto(t),
    departedAt: t.departedAt?.toISOString() ?? null,
    returnedAt: t.returnedAt?.toISOString() ?? null,
    stopEvents,
    snapshotAt: now().toISOString(),
    depotName: t.depot.name,
    departure,
  };
}

export function toDriverTripListItem(t: DriverTripRow, departure: DepartureReadiness): DriverTripListItemDto {
  return {
    ...toTripSummaryDto(t),
    departedAt: t.departedAt?.toISOString() ?? null,
    returnedAt: t.returnedAt?.toISOString() ?? null,
    terminalStops: t.stops.filter((s) => TERMINAL_STOP_STATES.includes(s.state)).length,
    departure,
  };
}
