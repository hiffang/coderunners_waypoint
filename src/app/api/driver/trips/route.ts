import { z } from "zod";
import { handle, ok, parseQuery } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { addDays, localDate, now } from "@/server/time";
import { localDateSchema } from "@/shared/dto/common";
import { driverTripInclude, loadDepartureContext, readinessFor, toDriverTripListItem } from "@/features/driver/server/snapshot";
import type { DriverTripListDto } from "@/features/driver/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({ serviceDate: localDateSchema.optional() });

/**
 * Trips assigned to the signed-in driver in published plans. Without
 * ?serviceDate: every unfinished trip plus trips completed in the last 3 days.
 * Assignment comes from the session, never from a submitted user/vehicle id.
 */
export const GET = handle(async (req: Request) => {
  const user = await requireRole("DRIVER");
  const { serviceDate } = parseQuery(req, querySchema);
  const recent = addDays(localDate(now()), -3);

  const trips = await db.trip.findMany({
    where: {
      assignedDriverId: user.id,
      plan: { status: { in: ["PUBLISHED", "COMPLETED"] } },
      ...(serviceDate ? { serviceDate } : { OR: [{ state: { not: "COMPLETED" } }, { serviceDate: { gte: recent } }] }),
    },
    include: driverTripInclude,
    orderBy: [{ serviceDate: "desc" }, { tripNumber: "asc" }],
    take: 50,
  });

  const items = await Promise.all(
    trips.map(async (t) => toDriverTripListItem(t, readinessFor(t, user, await loadDepartureContext(db, t)))),
  );
  const body: DriverTripListDto = { items, serverTime: now().toISOString() };
  return ok(body);
});
