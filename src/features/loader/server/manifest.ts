import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import { assertDepotScope, type SessionUser } from "@/server/auth/guards";
import { forbidden, notFound } from "@/server/http";
import { manifestInclude, toManifestDto, toTripSummaryDto } from "@/server/dto";
import { now } from "@/server/time";
import { loadingReadiness } from "../readiness";
import type { LoaderManifestDto, LoaderTripListItemDto } from "../types";

/** Manifest include plus the plan (status, revision, depot) and home depot name. */
export const loaderTripInclude = {
  ...manifestInclude,
  plan: { select: { status: true, revision: true, publishedAt: true, depotId: true } },
  depot: { select: { name: true } },
} satisfies Prisma.TripInclude;

export type LoaderTripRow = Prisma.TripGetPayload<{ include: typeof loaderTripInclude }>;

/** Plans a loader may see. Drafts are invisible until the dispatcher publishes them. */
export const VISIBLE_PLAN = ["PUBLISHED", "COMPLETED"] as const;

/**
 * Load one trip for the signed-in loader. Depot access comes from the trip's
 * own depot and its plan's depot, never from an id the browser sends.
 */
export async function loadLoaderTrip(tx: Tx, actor: SessionUser, tripId: string): Promise<LoaderTripRow> {
  const trip = await tx.trip.findUnique({ where: { id: tripId }, include: loaderTripInclude });
  if (!trip || !VISIBLE_PLAN.includes(trip.plan.status as (typeof VISIBLE_PLAN)[number])) {
    throw notFound("Trip not found");
  }
  assertDepotScope(actor, trip.depotId);
  if (trip.plan.depotId !== trip.depotId) throw forbidden("Trip and plan belong to different depots");
  return trip;
}

export function toLoaderManifestDto(t: LoaderTripRow): LoaderManifestDto {
  const m = toManifestDto(t);
  return {
    ...m,
    depotName: t.depot.name,
    planPublishedAt: t.plan.publishedAt?.toISOString() ?? null,
    loadingStartedAt: t.loadingStartedAt?.toISOString() ?? null,
    readyAt: t.readyAt?.toISOString() ?? null,
    departedAt: t.departedAt?.toISOString() ?? null,
    readiness: loadingReadiness(m),
    serverTime: now().toISOString(),
  };
}

export function toLoaderTripListItem(t: LoaderTripRow): LoaderTripListItemDto {
  return {
    ...toTripSummaryDto(t),
    planPublishedAt: t.plan.publishedAt?.toISOString() ?? null,
    readiness: loadingReadiness(toManifestDto(t)),
  };
}
