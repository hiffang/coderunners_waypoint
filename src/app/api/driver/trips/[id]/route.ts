import { handle, notFound, ok } from "@/server/http";
import { assertDriverScope, requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { driverTripInclude, loadDepartureContext, readinessFor, toDriverSnapshotDto } from "@/features/driver/server/snapshot";

export const dynamic = "force-dynamic";

/** Complete versioned snapshot of one assigned trip. Safe to cache offline for this driver only. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/driver/trips/[id]">) => {
  const user = await requireRole("DRIVER");
  const { id } = await ctx.params;
  const trip = await db.trip.findUnique({ where: { id }, include: driverTripInclude });
  if (!trip || (trip.plan.status !== "PUBLISHED" && trip.plan.status !== "COMPLETED")) throw notFound("Trip not found");
  assertDriverScope(user, trip.assignedDriverId);
  return ok(toDriverSnapshotDto(trip, readinessFor(trip, user, await loadDepartureContext(db, trip))));
});
