import { z } from "zod";
import { forbidden, handle, ok, parseQuery } from "@/server/http";
import { requireRole } from "@/server/auth/guards";
import { db } from "@/server/db";
import { localDate, now } from "@/server/time";
import { localDateSchema } from "@/shared/dto/common";
import { loaderTripInclude, toLoaderTripListItem } from "@/features/loader/server/manifest";
import type { LoaderTripListDto } from "@/features/loader/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({ serviceDate: localDateSchema.optional() });

/**
 * Published trips of the signed-in loader's depot. Without ?serviceDate: every
 * trip not yet departed plus everything from today on. The depot comes from
 * the session, never from a submitted id.
 */
export const GET = handle(async (req: Request) => {
  const user = await requireRole("LOADER");
  if (!user.depotId) throw forbidden("Account has no depot");
  const { serviceDate } = parseQuery(req, querySchema);
  const today = localDate(now());

  const trips = await db.trip.findMany({
    where: {
      depotId: user.depotId,
      plan: { depotId: user.depotId, status: { in: ["PUBLISHED", "COMPLETED"] } },
      ...(serviceDate
        ? { serviceDate }
        : { OR: [{ state: { in: ["PLANNED", "LOADING", "READY"] } }, { serviceDate: { gte: today } }] }),
    },
    include: loaderTripInclude,
    orderBy: [{ serviceDate: "desc" }, { plannedDepartureAt: "asc" }, { tripNumber: "asc" }],
    take: 60,
  });

  const body: LoaderTripListDto = { items: trips.map(toLoaderTripListItem), serverTime: now().toISOString() };
  return ok(body);
});
